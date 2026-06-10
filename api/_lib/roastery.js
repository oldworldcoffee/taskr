import { httpError } from './taskr.js';

const ROASTERY_FUNCTIONS = new Set(['roasteryExtractInvoice']);

export function isRoasteryFunction(name) {
  return ROASTERY_FUNCTIONS.has(name);
}

function requireRoasteryAccess(user) {
  if (!user?.company_id || !['admin', 'manager', 'super_admin'].includes(user.role)) {
    throw httpError(403, 'Roastery access requires a company admin or manager.');
  }
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseSupabaseStorageUrl(fileUrl) {
  try {
    const url = new URL(fileUrl);
    const match = url.pathname.match(/\/storage\/v1\/object\/(?:public\/)?([^/]+)\/(.+)$/);
    if (!match) return null;
    return {
      bucket: decodeURIComponent(match[1]),
      path: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

function guessContentType(fileUrl) {
  const lower = String(fileUrl || '').toLowerCase();
  if (lower.includes('.png')) return 'image/png';
  if (lower.includes('.webp')) return 'image/webp';
  if (lower.includes('.gif')) return 'image/gif';
  if (lower.includes('.pdf')) return 'application/pdf';
  return 'image/jpeg';
}

async function fileUrlToDataUrl(fileUrl, client) {
  if (String(fileUrl || '').startsWith('data:')) return fileUrl;

  try {
    const response = await fetch(fileUrl);
    if (response.ok) {
      const contentType = response.headers.get('content-type') || guessContentType(fileUrl);
      const buffer = Buffer.from(await response.arrayBuffer());
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    }
  } catch {
    // Fall back to service-role storage download below when available.
  }

  const object = parseSupabaseStorageUrl(fileUrl);
  if (object?.bucket && object?.path && client?.storage) {
    const { data, error } = await client.storage.from(object.bucket).download(object.path);
    if (!error && data) {
      const contentType = data.type || guessContentType(fileUrl);
      const buffer = Buffer.from(await data.arrayBuffer());
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    }
  }

  throw httpError(400, 'The uploaded invoice file could not be read from storage.');
}

function parseJsonObject(content) {
  try {
    const parsed = JSON.parse(String(content || ''));
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // fall through
  }
  throw httpError(502, 'Invoice extraction returned unreadable data.');
}

async function roasteryExtractInvoice(client, user, body) {
  requireRoasteryAccess(user);

  const fileUrl = String(body.file_url || body.fileUrl || body.file_urls?.[0] || '').trim();
  if (!fileUrl) throw httpError(400, 'Invoice file is required.');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      supplier_name: '',
      invoice_number: '',
      invoice_date: null,
      total_amount: 0,
      freight_total: 0,
      tariff_total: 0,
      storage_fee_total: 0,
      confidence: 0,
      notes: 'AI invoice parsing is not configured yet. Enter the invoice details manually.',
      line_items: [],
    };
  }

  const { data: coffees, error: coffeesError } = await client
    .from('roastery_green_coffees')
    .select('id, name, country, region, variety, process')
    .eq('company_id', user.company_id)
    .neq('is_active', false);
  if (coffeesError) throw coffeesError;

  const coffeeCatalog = (coffees || []).slice(0, 400).map((coffee) => ({
    id: coffee.id,
    name: coffee.name,
    country: coffee.country || '',
    region: coffee.region || '',
    variety: coffee.variety || '',
    process: coffee.process || '',
  }));

  const model = process.env.OPENAI_INVOICE_MODEL || process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
  const imageUrl = await fileUrlToDataUrl(fileUrl, client);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You analyze green coffee invoices from importers and extract structured data.',
            'Return JSON only with supplier_name, invoice_number, invoice_date, total_amount, freight_total, tariff_total, storage_fee_total, confidence, notes, and line_items.',
            'For each coffee line item return coffee_name, number_of_bags, lbs_per_bag, total_lbs, cost_per_lb, line_total, tariff_cost, storage_fee, and matched_green_coffee_id.',
            'Look for per-line-item charges such as tariff/duty and storage/carry costs. These may appear as separate charges per coffee (carry cost, storage fee, duty, tariff). Put per-line dollar totals in tariff_cost and storage_fee on the line item.',
            'If a charge is a single invoice-level amount instead of per line, put it in the top-level freight_total, tariff_total, or storage_fee_total.',
            'Match each line item to the best entry in the provided coffee library using fuzzy/partial matching. Invoice names often include lot numbers, bag types, and warehouse codes that are not in library names; match on meaningful words such as origin, region, variety, and process.',
            'Set matched_green_coffee_id to the id of the best match, or null if there is no reasonable match. Only use ids from the provided library.',
            'confidence is a 0-1 score for the overall extraction. notes is a short caveat string for the reviewer.',
            'Read invoice numbers, dates, weights, costs, and totals exactly as printed.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                'Our green coffee library for matching:',
                JSON.stringify(coffeeCatalog),
                '',
                'Extract this green coffee invoice. Return all coffee line items and all visible totals.',
              ].join('\n'),
            },
            {
              type: 'image_url',
              image_url: { url: imageUrl, detail: 'high' },
            },
          ],
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw httpError(response.status, payload.error?.message || 'Invoice extraction failed.');
  }

  const parsed = parseJsonObject(payload.choices?.[0]?.message?.content);
  const validCoffeeIds = new Set(coffeeCatalog.map((coffee) => coffee.id));
  const lineItems = (Array.isArray(parsed.line_items) ? parsed.line_items : []).map((item) => ({
    coffee_name: String(item.coffee_name || '').trim(),
    number_of_bags: toNumber(item.number_of_bags, null),
    lbs_per_bag: toNumber(item.lbs_per_bag, null),
    total_lbs: toNumber(item.total_lbs, null),
    cost_per_lb: toNumber(item.cost_per_lb, null),
    line_total: toNumber(item.line_total, null),
    tariff_cost: toNumber(item.tariff_cost, 0),
    storage_fee: toNumber(item.storage_fee, 0),
    matched_green_coffee_id: validCoffeeIds.has(item.matched_green_coffee_id)
      ? item.matched_green_coffee_id
      : null,
  }));

  return {
    supplier_name: String(parsed.supplier_name || '').trim(),
    invoice_number: String(parsed.invoice_number || '').trim(),
    invoice_date: normalizeDate(parsed.invoice_date),
    total_amount: toNumber(parsed.total_amount, 0),
    freight_total: toNumber(parsed.freight_total, 0),
    tariff_total: toNumber(parsed.tariff_total, 0),
    storage_fee_total: toNumber(parsed.storage_fee_total, 0),
    confidence: toNumber(parsed.confidence, 0),
    notes: String(parsed.notes || '').trim(),
    line_items: lineItems,
  };
}

export async function handleRoasteryFunction(name, req, client, user, body) {
  switch (name) {
    case 'roasteryExtractInvoice':
      return roasteryExtractInvoice(client, user, body);
    default:
      throw httpError(404, `Unknown function: ${name}`);
  }
}
