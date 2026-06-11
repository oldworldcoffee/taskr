import { createHmac, timingSafeEqual } from 'node:crypto';
import { httpError, originFor } from './taskr.js';

const INVENTORY_FUNCTIONS = new Set([
  'inventoryDownloadCatalogTemplate',
  'inventoryExtractInvoiceImage',
  'inventoryImportCatalog',
  'inventoryImportCatalogCsv',
  'inventoryExportCatalog',
  'inventoryExportCatalogPDF',
  'inventoryMergeDuplicateItems',
  'inventoryManageProductGroups',
  'inventorySubmitInventoryCount',
  'inventorySendVendorOrderEmail',
  'inventoryCancelVendorOrderEmail',
  'inventoryReviewOrderBeforeSend',
  'inventoryReviewCatalog',
  'inventoryAiPrepareCatalogImport',
  'inventoryAiCommitCatalogImport',
  'inventoryCalculateSmartParsAfterCount',
  'inventoryFulfillCommissaryOrder',
  'inventoryScrapeProductImage',
  'inventoryCreateDailySnapshot',
  'inventoryValidateVendorToken',
]);

const INVENTORY_ALIASES = {
  downloadCatalogTemplate: 'inventoryDownloadCatalogTemplate',
  extractInvoiceImage: 'inventoryExtractInvoiceImage',
  importCatalog: 'inventoryImportCatalog',
  importCatalogCsv: 'inventoryImportCatalogCsv',
  exportCatalog: 'inventoryExportCatalog',
  exportCatalogPDF: 'inventoryExportCatalogPDF',
  mergeDuplicateItems: 'inventoryMergeDuplicateItems',
  manageProductGroups: 'inventoryManageProductGroups',
  submitInventoryCount: 'inventorySubmitInventoryCount',
  sendVendorOrderEmail: 'inventorySendVendorOrderEmail',
  cancelVendorOrderEmail: 'inventoryCancelVendorOrderEmail',
  reviewOrderBeforeSend: 'inventoryReviewOrderBeforeSend',
  reviewCatalog: 'inventoryReviewCatalog',
  aiPrepareCatalogImport: 'inventoryAiPrepareCatalogImport',
  aiCommitCatalogImport: 'inventoryAiCommitCatalogImport',
  calculateSmartParsAfterCount: 'inventoryCalculateSmartParsAfterCount',
  fulfillCommissaryOrder: 'inventoryFulfillCommissaryOrder',
  scrapeProductImage: 'inventoryScrapeProductImage',
  createDailySnapshot: 'inventoryCreateDailySnapshot',
  validateVendorToken: 'inventoryValidateVendorToken',
};

const nowIso = () => new Date().toISOString();

function normalizeInventoryFunction(name) {
  return INVENTORY_ALIASES[name] || name;
}

export function isInventoryFunction(name) {
  return INVENTORY_FUNCTIONS.has(normalizeInventoryFunction(name));
}

export function isPublicInventoryFunction(name) {
  return normalizeInventoryFunction(name) === 'inventoryValidateVendorToken';
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  row.push(field);
  rows.push(row);
  const headers = rows.shift()?.map((header) => header.trim()) || [];
  return rows
    .filter((cells) => cells.some((cell) => String(cell || '').trim()))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
}

function getColumn(row, names, fallback = '') {
  for (const name of names) {
    if (row[name] != null && row[name] !== '') return row[name];
  }
  return fallback;
}

function toNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ['yes', 'true', '1', 'y', 'active'].includes(normalized);
}

function parseJsonObject(text, errorMessage = 'OpenAI returned unreadable data.') {
  const raw = String(text || '').trim();
  const withoutFence = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(withoutFence.slice(start, end + 1));
    throw httpError(502, errorMessage);
  }
}

function inventoryAiModel(kind = 'inventory') {
  if (kind === 'order_review') {
    return process.env.OPENAI_ORDERING_MODEL || process.env.OPENAI_INVENTORY_MODEL || 'gpt-4o-mini';
  }
  if (kind === 'smart_pars') {
    return process.env.OPENAI_PARS_MODEL || process.env.OPENAI_INVENTORY_MODEL || 'gpt-4o-mini';
  }
  return process.env.OPENAI_INVENTORY_MODEL || 'gpt-4o-mini';
}

async function requestOpenAiJson({ apiKey, model, messages, errorMessage }) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw httpError(response.status, payload.error?.message || errorMessage);
  }

  return parseJsonObject(payload.choices?.[0]?.message?.content, errorMessage);
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const numeric = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (numeric) {
    const [, month, day, year] = numeric;
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${fullYear.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\bchoc\b/g, 'chocolate')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCode(value) {
  return normalizeMatchText(value).replace(/\s+/g, '');
}

const VENDOR_ENTITY_WORDS = new Set([
  'the',
  'inc',
  'incorporated',
  'llc',
  'ltd',
  'limited',
  'corp',
  'corporation',
  'company',
  'co',
  'llp',
  'lp',
]);

function normalizeVendorText(value) {
  return normalizeMatchText(value)
    .split(' ')
    .filter((word) => word && !VENDOR_ENTITY_WORDS.has(word))
    .join(' ');
}

function vendorNameValues(vendor = {}) {
  const aliases = Array.isArray(vendor.aliases) ? vendor.aliases : [];
  return [
    vendor.name,
    vendor.legal_name,
    vendor.display_name,
    vendor.dba,
    vendor.dba_name,
    ...aliases,
  ].map((value) => String(value || '').trim()).filter(Boolean);
}

function vendorMatchScore(candidate, vendorName) {
  const candidateText = normalizeVendorText(candidate);
  const vendorText = normalizeVendorText(vendorName);
  if (!candidateText || !vendorText) return 0;
  if (candidateText === vendorText) return 100;

  const shorterLength = Math.min(candidateText.length, vendorText.length);
  if (shorterLength >= 6 && (candidateText.includes(vendorText) || vendorText.includes(candidateText))) {
    return 94;
  }

  const candidateWords = new Set(candidateText.split(' ').filter((word) => word.length > 1));
  const vendorWords = vendorText.split(' ').filter((word) => word.length > 1);
  if (!candidateWords.size || !vendorWords.length) return 0;

  const shared = vendorWords.filter((word) => candidateWords.has(word));
  const vendorCoverage = shared.length / vendorWords.length;
  const candidateCoverage = shared.length / candidateWords.size;
  if (shared.length >= 2 && vendorCoverage >= 0.67 && candidateCoverage >= 0.4) {
    return 82 + Math.round(Math.min(vendorCoverage, candidateCoverage) * 10);
  }

  return 0;
}

function findKnownVendor(candidate, vendors = []) {
  const candidateText = String(candidate || '').trim();
  if (!candidateText) return null;

  let best = null;
  for (const vendor of vendors) {
    if (vendor.is_active === false) continue;
    for (const name of vendorNameValues(vendor)) {
      const score = vendorMatchScore(candidateText, name);
      if (score > (best?.score || 0)) {
        best = { vendor, name: vendor.name || name, score };
      }
    }
  }

  return best?.score >= 82 ? best : null;
}

function invoiceVendorCandidateValues(parsed = {}) {
  return [
    parsed.supplier_name,
    parsed.seller_name,
    parsed.remit_to_name,
    parsed.remit_to_company,
    parsed.from_name,
    parsed.from_company,
    parsed.header_name,
    parsed.header_vendor_name,
    parsed.logo_name,
    parsed.invoice_from,
    parsed.vendor_name,
  ].map((value) => String(value || '').trim()).filter(Boolean);
}

function vendorFromMatchedPurchaseOptions(items = [], vendors = []) {
  const scores = new Map();
  for (const item of items) {
    if (!item.purchase_option_matched) continue;
    const rawName = String(item.purchase_option_vendor_name || '').trim();
    if (!rawName) continue;

    const known = findKnownVendor(rawName, vendors);
    const name = known?.vendor?.name || rawName;
    const key = normalizeVendorText(name);
    if (!key) continue;

    const current = scores.get(key) || { name, vendor: known?.vendor || null, score: 0 };
    current.score += 1 + Math.min(Number(item.match_score || 0), 100) / 100;
    scores.set(key, current);
  }

  return [...scores.values()].sort((a, b) => b.score - a.score)[0] || null;
}

function resolveInvoiceVendorName(parsed = {}, vendors = [], items = []) {
  const optionVendor = vendorFromMatchedPurchaseOptions(items, vendors);
  if (optionVendor?.name) return optionVendor.name;

  const known = invoiceVendorCandidateValues(parsed)
    .map((candidate) => findKnownVendor(candidate, vendors))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)[0];
  if (known?.vendor?.name) return known.vendor.name;

  return String(parsed.vendor_name || '').trim();
}

function compactPromptObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === undefined || entry === null || entry === '') return false;
      if (Array.isArray(entry) && entry.length === 0) return false;
      return true;
    })
  );
}

function compactInvoicePromptCatalog(catalogItems = [], maxChars = 35000) {
  const promptItems = [];
  let approxChars = 2;

  for (const item of catalogItems) {
    const options = [];
    for (const option of item.purchase_options || []) {
      const code = option.product_code
        || option.vendor_sku
        || option.item_code
        || option.vendor_item_number
        || option.supplier_item_number
        || option.supplier_sku
        || option.catalog_number
        || option.sku
        || option.upc
        || '';
      const optionRow = compactPromptObject({
        vendor: option.vendor_name,
        product: option.product_name,
        code,
      });
      if (Object.keys(optionRow).length) options.push(optionRow);
      if (options.length >= 3) break;
    }

    const row = compactPromptObject({
      id: item.id,
      name: item.name,
      sku: item.sku,
      uom: item.unit_of_measure,
      options,
    });
    const serialized = JSON.stringify(row);
    if (promptItems.length && approxChars + serialized.length > maxChars) break;
    promptItems.push(row);
    approxChars += serialized.length + 1;
  }

  return promptItems;
}

function meaningfulWords(value) {
  const stop = new Set(['the', 'and', 'with', 'blend', 'barista', 'califia', 'case', 'cs', 'pl', 'plt', 'milk']);
  return normalizeMatchText(value).split(' ').filter((word) => word.length > 1 && !stop.has(word));
}

function invoiceCodeValues(source = {}) {
  return [
    source.vendor_sku,
    source.vendor_item_number,
    source.vendor_item_no,
    source.item_number,
    source.item_no,
    source.item_num,
    source.item_code,
    source.product_code,
    source.product_number,
    source.product_no,
    source.supplier_item_number,
    source.supplier_item_no,
    source.supplier_sku,
    source.vendor_code,
    source.catalog_number,
    source.catalog_no,
    source.code,
    source.sku,
    source.upc,
  ].map((value) => String(value || '').trim()).filter(Boolean);
}

function candidateInvoiceCodes(extracted) {
  return invoiceCodeValues(extracted).map(normalizeCode).filter(Boolean);
}

function optionCodes(option = {}) {
  return [
    option.product_code,
    option.vendor_sku,
    option.vendor_item_number,
    option.vendor_item_no,
    option.item_number,
    option.item_no,
    option.item_code,
    option.product_number,
    option.product_no,
    option.supplier_item_number,
    option.supplier_item_no,
    option.supplier_sku,
    option.vendor_code,
    option.catalog_number,
    option.catalog_no,
    option.code,
    option.sku,
    option.upc,
  ].map(normalizeCode).filter(Boolean);
}

function optionNames(option = {}) {
  return [
    option.product_name,
    option.name,
  ].map(normalizeMatchText).filter(Boolean);
}

function purchaseOptionMatch(extracted, catalogItems = []) {
  const codes = candidateInvoiceCodes(extracted);
  const invoiceName = normalizeMatchText(extracted.item_name || extracted.name || extracted.description);

  for (const item of catalogItems) {
    for (const option of item.purchase_options || []) {
      const exactCodeMatch = codes.length > 0 && optionCodes(option).some((code) => codes.includes(code));
      if (exactCodeMatch) {
        return { item, option, score: 100, reason: 'purchase_option_code' };
      }
      if (codes.length > 0) continue;

      if (invoiceName) {
        for (const optionName of optionNames(option)) {
          if (!optionName) continue;
          if (optionName === invoiceName) return { item, option, score: 96, reason: 'purchase_option_name' };
          if (invoiceName.includes(optionName) || optionName.includes(invoiceName)) {
            const sharedLength = Math.min(invoiceName.length, optionName.length);
            if (sharedLength >= 8) return { item, option, score: 90, reason: 'purchase_option_name' };
          }
        }
      }
    }
  }

  return null;
}

function itemNameMatch(extracted, catalogItems = []) {
  const invoiceName = normalizeMatchText(extracted.item_name || extracted.name || extracted.description);
  const invoiceWords = new Set(meaningfulWords(invoiceName));
  if (!invoiceName && invoiceWords.size === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const item of catalogItems) {
    const itemName = normalizeMatchText(item.name);
    const itemWords = meaningfulWords(item.name);
    let score = 0;

    if (itemName && invoiceName === itemName) score = 100;
    else if (itemName && (invoiceName.includes(itemName) || itemName.includes(invoiceName))) {
      score = Math.min(invoiceName.length, itemName.length) >= 7 ? 92 : 70;
    }

    if (itemWords.length) {
      const matchedWords = itemWords.filter((word) => invoiceWords.has(word));
      const coverage = matchedWords.length / itemWords.length;
      const overlapScore = coverage * 90 + Math.min(matchedWords.length, 4) * 2;
      score = Math.max(score, overlapScore);
    }

    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  return bestScore >= 72 ? { item: best, score: bestScore, reason: 'item_name' } : null;
}

function matchCatalogItem(extracted, catalogItems = []) {
  const explicitId = String(extracted.item_id || extracted.itemId || '').trim();
  if (explicitId) {
    const explicitItem = catalogItems.find((item) => item.id === explicitId);
    if (explicitItem) {
      const existingPurchaseOption = purchaseOptionMatch(extracted, [explicitItem]);
      return {
        item_id: explicitItem.id,
        match_type: existingPurchaseOption ? existingPurchaseOption.reason : 'catalog_item',
        purchase_option_matched: Boolean(existingPurchaseOption),
        purchase_option_missing: !existingPurchaseOption,
        purchase_option_vendor_id: existingPurchaseOption?.option?.vendor_id || null,
        purchase_option_vendor_name: existingPurchaseOption?.option?.vendor_name || '',
        match_score: existingPurchaseOption?.score || 90,
      };
    }
  }

  const purchaseMatch = purchaseOptionMatch(extracted, catalogItems);
  if (purchaseMatch) {
    return {
      item_id: purchaseMatch.item.id,
      match_type: purchaseMatch.reason,
      purchase_option_matched: true,
      purchase_option_missing: false,
      purchase_option_vendor_id: purchaseMatch.option?.vendor_id || null,
      purchase_option_vendor_name: purchaseMatch.option?.vendor_name || '',
      match_score: purchaseMatch.score,
    };
  }

  const itemMatch = itemNameMatch(extracted, catalogItems);
  if (!itemMatch) return null;
  return {
    item_id: itemMatch.item.id,
    match_type: itemMatch.reason,
    purchase_option_matched: false,
    purchase_option_missing: true,
    purchase_option_vendor_id: null,
    purchase_option_vendor_name: '',
    match_score: itemMatch.score,
  };
}

// Fee/surcharge lines (fuel, freight, delivery fees, deposits) are kept on the
// invoice for the record but never matched to catalog items, received as stock,
// or used in costing.
const FEE_LINE_PATTERN = /\b(fuel|freight|shipping|surcharge|handling)\b|\b(delivery|service|truck|energy|environmental)\s*(charge|fee)s?\b|\bbottle\s*deposit\b/i;

function isFeeLineName(name) {
  return FEE_LINE_PATTERN.test(String(name || ''));
}

function normalizeExtractedItems(rawItems = [], catalogItems = []) {
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((item) => {
      const itemName = String(item.item_name || item.name || item.description || '').trim();
      if (!itemName) return null;

      const match = matchCatalogItem(item, catalogItems);
      let itemId = match?.item_id || null;
      const isFee = item.is_fee === true || (!itemId && isFeeLineName(itemName));
      if (isFee) itemId = null;
      const quantity = toNumber(item.quantity ?? item.qty ?? item.shipped_quantity ?? item.ordered_quantity, 0);
      const totalCost = toNumber(item.total_cost ?? item.line_total ?? item.extended_price ?? item.extended_cost ?? item.total, 0);
      const unitCost = toNumber(item.unit_cost ?? item.unit_price ?? item.price ?? item.cost, quantity > 0 && totalCost > 0 ? totalCost / quantity : 0);
      const unitOfMeasure = String(item.unit_of_measure || item.uom || '').trim();

      return {
        item_name: itemName,
        item_id: itemId,
        is_fee: isFee,
        vendor_sku: invoiceCodeValues(item)[0] || '',
        pack_size: String(item.pack_size || item.pack || '').trim(),
        match_type: isFee ? null : match?.match_type || null,
        match_score: isFee ? 0 : match?.match_score || 0,
        purchase_option_matched: !isFee && match?.purchase_option_matched === true,
        purchase_option_missing: !isFee && match?.purchase_option_missing === true,
        purchase_option_vendor_id: isFee ? null : match?.purchase_option_vendor_id || null,
        purchase_option_vendor_name: isFee ? '' : match?.purchase_option_vendor_name || '',
        quantity,
        unit_cost: unitCost,
        unit_of_measure: unitOfMeasure,
        total_cost: totalCost || quantity * unitCost,
        matched: Boolean(itemId),
      };
    })
    .filter(Boolean);
}

function guessContentType(fileUrl) {
  const clean = String(fileUrl || '').split('?')[0].toLowerCase();
  if (clean.endsWith('.pdf')) return 'application/pdf';
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function parseSupabaseStorageUrl(fileUrl) {
  try {
    const parsed = new URL(fileUrl);
    const match = parsed.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
    if (!match) return null;
    return {
      bucket: decodeURIComponent(match[1]),
      path: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

async function blobToDataUrl(blob, fallbackContentType) {
  const contentType = blob.type || fallbackContentType || 'application/octet-stream';
  const buffer = Buffer.from(await blob.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}

async function imageUrlToDataUrl(fileUrl, client) {
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
    if (!error && data) return blobToDataUrl(data, guessContentType(fileUrl));
  }

  throw httpError(400, 'The uploaded invoice image could not be read from storage.');
}

function isCommissaryLocation(location, settings = []) {
  const setting = settings.find((row) => row.location_id === location?.id);
  return (setting?.type || location?.type) === 'commissary';
}

function inventorySnapshotUnitCost(item, location, settings = []) {
  const commissaryPrice = Number(item?.commissary_price || 0);
  if (item?.is_commissary_item && !isCommissaryLocation(location, settings) && commissaryPrice > 0) {
    return commissaryPrice;
  }

  const options = item?.purchase_options || [];
  const preferred = options.find((option) => option.is_preferred) || options[0] || null;
  const packUnits = Number(preferred?.inner_pack_units || item?.inner_pack_units || 1);
  const packsPerCase = Number(preferred?.packs_per_case || item?.packs_per_case || 0);
  const unitCost = Number(preferred?.unit_cost || item?.unit_cost || 0);

  if (packsPerCase && packUnits) return unitCost / (packUnits * packsPerCase);
  if (packUnits > 1) return unitCost / packUnits;
  return unitCost;
}

function makePdf(title, lines) {
  const escapePdf = (value) => String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const visibleLines = [title, `Generated: ${new Date().toLocaleDateString()}`, '', ...lines].slice(0, 42);
  const content = `BT /F1 11 Tf 50 760 Td ${visibleLines.map((line, index) => `${index ? 'T* ' : ''}(${escapePdf(line)}) Tj`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

function hasInventoryGrant(user) {
  const grant = (user?.feature_permissions || {}).inventory;
  return grant === true || (grant && typeof grant === 'object' && grant.enabled === true);
}

async function requireInventoryAccess(client, user) {
  const allowed = ['admin', 'manager'].includes(user?.role) || hasInventoryGrant(user);
  if (!user?.company_id || !allowed) {
    throw httpError(403, 'Inventory access requires a company admin, manager, or granted user.');
  }

  const { data: company, error } = await client
    .from('companies')
    .select('id, enabled_features')
    .eq('id', user.company_id)
    .single();
  if (error) throw error;
  if (!company?.enabled_features?.includes('inventory')) {
    throw httpError(403, 'Inventory is not enabled for this company.');
  }
}

async function fetchCompanyRows(client, table, companyId) {
  const { data, error } = await client.from(table).select('*').eq('company_id', companyId);
  if (error) throw error;
  return data || [];
}

async function getRecord(client, table, id, companyId) {
  const { data, error } = await client
    .from(table)
    .select('*')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function createRecord(client, table, payload) {
  const { data, error } = await client.from(table).insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

async function updateRecord(client, table, id, companyId, patch) {
  const { data, error } = await client
    .from(table)
    .update(patch)
    .eq('id', id)
    .eq('company_id', companyId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

function numericQuantity(value) {
  const quantity = Number(value || 0);
  return Number.isFinite(quantity) ? quantity : 0;
}

function stockQuantityForLine(item, quantity, orderedQuantity) {
  const multiplier = numericQuantity(item.order_unit_multiplier);
  if (multiplier > 0) return quantity * multiplier;

  const orderedStockQuantity = numericQuantity(item.stock_quantity_ordered);
  if (orderedStockQuantity > 0 && orderedQuantity > 0) {
    return (orderedStockQuantity / orderedQuantity) * quantity;
  }

  return quantity;
}

function commissaryOrderLine(item, quantity, orderedQuantity, fulfilledQuantity = 0) {
  const unitCost = numericQuantity(item.unit_cost);
  const stockQuantityOrdered = stockQuantityForLine(item, quantity, orderedQuantity);
  const stockQuantityFulfilled = stockQuantityForLine(item, fulfilledQuantity, orderedQuantity);

  return {
    ...item,
    variant_quantities: null,
    quantity_ordered: quantity,
    quantity_fulfilled: fulfilledQuantity,
    quantity_received: fulfilledQuantity,
    stock_quantity_ordered: stockQuantityOrdered,
    stock_quantity_fulfilled: stockQuantityFulfilled,
    stock_quantity_received: stockQuantityFulfilled,
    unit_cost: unitCost,
    total_cost: quantity * unitCost,
  };
}

function appendNote(existingNotes, note) {
  return [existingNotes, note].filter(Boolean).join('\n\n');
}

async function deleteRecord(client, table, id, companyId) {
  const { error } = await client.from(table).delete().eq('id', id).eq('company_id', companyId);
  if (error) throw error;
}

async function importCatalogRows(client, user, rows) {
  const companyId = user.company_id;
  const results = {
    items: { created: 0, updated: 0, errors: [] },
    vendors: { created: 0, updated: 0, errors: [] },
  };

  const [vendors, items] = await Promise.all([
    fetchCompanyRows(client, 'inventory_vendors', companyId),
    fetchCompanyRows(client, 'inventory_items', companyId),
  ]);
  const vendorByName = new Map(vendors.map((vendor) => [String(vendor.name || '').toLowerCase(), vendor]));
  const itemByName = new Map(items.map((item) => [String(item.name || '').toLowerCase(), item]));
  const grouped = new Map();

  for (const row of rows) {
    const itemName = getColumn(row, ['Item Name', 'Inventory item', 'Inventory Item', 'Name']);
    if (!itemName) continue;
    if (!grouped.has(itemName)) grouped.set(itemName, []);
    grouped.get(itemName).push(row);
  }

  for (const [itemName, itemRows] of grouped) {
    try {
      const first = itemRows[0];
      const purchaseOptions = [];

      for (const row of itemRows) {
        const vendorName = getColumn(row, ['Vendor Name', 'Supplier', 'Vendor']);
        if (!vendorName) continue;
        let vendor = vendorByName.get(vendorName.toLowerCase());
        if (!vendor) {
          vendor = await createRecord(client, 'inventory_vendors', {
            company_id: companyId,
            name: vendorName,
            email: getColumn(row, ['Vendor Email', 'Supplier Email']),
            is_active: true,
            notes: 'Auto-created during catalog import',
          });
          vendorByName.set(vendorName.toLowerCase(), vendor);
          results.vendors.created += 1;
        }
        purchaseOptions.push({
          vendor_id: vendor.id,
          vendor_name: vendor.name,
          product_name: getColumn(row, ['Product Name', 'Purchase options', 'Purchase Options'], itemName),
          product_code: getColumn(row, ['Product Code', 'SKU']),
          pack_size: getColumn(row, ['Pack Size']),
          unit_cost: toNumber(getColumn(row, ['Unit Cost', 'Price after discount', 'Price'])),
          unit_of_measure: getColumn(row, ['Unit of Measure', 'UOM'], 'EA'),
          inner_pack_units: toNumber(getColumn(row, ['Inner Pack Units', 'Inner pack quantity']), null),
          inner_pack_name: getColumn(row, ['Inner Pack Name', 'Pack nickname']),
          packs_per_case: toNumber(getColumn(row, ['Packs Per Case', 'Packs per case']), null),
          is_preferred: purchaseOptions.length === 0,
          location_ids: null,
          notes: '',
        });
      }

      const costs = purchaseOptions.map((option) => Number(option.unit_cost || 0)).filter(Number.isFinite);
      const bestCost = costs.length ? Math.min(...costs) : toNumber(getColumn(first, ['Unit Cost', 'Price after discount', 'Price']));
      const itemData = {
        company_id: companyId,
        name: itemName,
        sku: getColumn(first, ['SKU', 'Product Code']),
        category: getColumn(first, ['Category']),
        unit_of_measure: getColumn(first, ['Unit of Measure', 'UOM'], 'EA'),
        unit_cost: Number.isFinite(bestCost) ? bestCost : 0,
        is_commissary_item: toBool(getColumn(first, ['Is Commissary Item']), false),
        commissary_price: toNumber(getColumn(first, ['Commissary Price']), null),
        description: getColumn(first, ['Description']),
        is_active: toBool(getColumn(first, ['Is Active', 'Ordering enabled'], 'Yes'), true),
        purchase_options: purchaseOptions,
        ai_suggested_par: toNumber(getColumn(first, ['AI Suggested Par', 'Par level']), null),
        minimum_reorder_volume: toNumber(getColumn(first, ['Minimum Reorder Volume', 'Min On Hand', 'Min order quantity']), null),
      };

      const existing = itemByName.get(itemName.toLowerCase());
      if (existing) {
        const existingVendors = new Set((existing.purchase_options || []).map((option) => String(option.vendor_name || '').toLowerCase()));
        const newOptions = purchaseOptions.filter((option) => !existingVendors.has(String(option.vendor_name || '').toLowerCase()));
        await updateRecord(client, 'inventory_items', existing.id, companyId, {
          ...itemData,
          purchase_options: [...(existing.purchase_options || []), ...newOptions],
        });
        results.items.updated += 1;
      } else {
        const created = await createRecord(client, 'inventory_items', itemData);
        itemByName.set(itemName.toLowerCase(), created);
        results.items.created += 1;
      }
    } catch (error) {
      results.items.errors.push(`${itemName}: ${error.message}`);
    }
  }

  return { success: true, results };
}

async function importCatalog(client, user, fileUrl) {
  if (!fileUrl) throw httpError(400, 'Catalog file is required.');
  const response = await fetch(fileUrl);
  if (!response.ok) throw httpError(400, `Unable to download catalog file (${response.status})`);

  return importCatalogRows(client, user, parseCsv(await response.text()));
}

async function importCatalogCsv(client, user, csvText) {
  if (!String(csvText || '').trim()) throw httpError(400, 'Catalog CSV is required.');
  return importCatalogRows(client, user, parseCsv(csvText));
}

function exportCatalog(format, items = []) {
  const headers = ['Item Name', 'SKU', 'Category', 'Unit of Measure', 'Unit Cost', 'Is Commissary Item', 'Commissary Price', 'Vendor', 'Is Active'];
  const rows = [
    headers.map(csvEscape).join(','),
    ...items.map((item) => {
      const preferred = (item.purchase_options || []).find((option) => option.is_preferred) || (item.purchase_options || [])[0];
      return [
        item.name,
        item.sku,
        item.category,
        item.unit_of_measure,
        Number(preferred?.unit_cost || item.unit_cost || 0).toFixed(2),
        item.is_commissary_item ? 'Yes' : 'No',
        Number(item.commissary_price || 0).toFixed(2),
        preferred?.vendor_name || '',
        item.is_active === false ? 'No' : 'Yes',
      ].map(csvEscape).join(',');
    }),
  ];

  if (format !== 'pdf') return rows.join('\n');
  return makePdf('Master Catalog', items.map((item) => {
    const preferred = (item.purchase_options || []).find((option) => option.is_preferred) || (item.purchase_options || [])[0];
    return `${item.name || ''} | ${item.category || ''} | ${item.unit_of_measure || ''} | $${Number(preferred?.unit_cost || item.unit_cost || 0).toFixed(2)}`;
  }));
}

function vendorTokenSecret() {
  return process.env.VENDOR_ORDER_TOKEN_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_KEY
    || 'taskr-local-vendor-order-token';
}

function signVendorOrderToken(orderId, timestamp = Date.now().toString()) {
  const message = `${orderId}:${timestamp}`;
  const signature = createHmac('sha256', vendorTokenSecret()).update(message).digest('hex');
  return `${orderId}:${timestamp}:${signature}`;
}

function verifyVendorOrderToken(token) {
  const parts = String(token || '').split(':');
  if (parts.length !== 3) throw httpError(400, 'Invalid token format');
  const [orderId, timestamp, signature] = parts;
  const expected = createHmac('sha256', vendorTokenSecret()).update(`${orderId}:${timestamp}`).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(signature, 'hex');
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw httpError(401, 'Invalid token signature');
  }
  return { orderId, timestamp };
}

function withVendorOrderLink(req, payload) {
  if (!payload.orderId || !payload.htmlBody) return payload;
  const token = signVendorOrderToken(payload.orderId);
  const appUrl = payload.appUrl || originFor(req);
  const viewOrderUrl = `${appUrl}/vendor/order?token=${encodeURIComponent(token)}`;
  const button = `
    <div style="margin:30px 0;text-align:center;">
      <a href="${viewOrderUrl}" style="display:inline-block;padding:14px 32px;background-color:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:16px;">
        View Order Details
      </a>
      <p style="margin-top:12px;font-size:13px;color:#6b7280;">Click above to view your order details online</p>
    </div>
  `;
  const htmlBody = payload.htmlBody.includes('TRACKING_PLACEHOLDER_CONFIRM')
    ? payload.htmlBody.replace('TRACKING_PLACEHOLDER_CONFIRM', button)
    : `${payload.htmlBody}${button}`;
  return { ...payload, htmlBody };
}

async function sendEmail(client, companyId, payload) {
  const to = String(payload.toEmail || '').split(',').map((email) => email.trim()).filter(Boolean);
  const cc = String(payload.ccEmail || '').split(',').map((email) => email.trim()).filter(Boolean);
  const emailRecord = {
    company_id: companyId,
    order_id: payload.orderId || null,
    to_emails: to,
    cc_emails: cc,
    subject: payload.subject || '',
    html: payload.htmlBody || '',
    status: 'logged',
    provider: 'local-log',
  };

  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM && to.length > 0) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to,
        cc: cc.length ? cc : undefined,
        subject: emailRecord.subject,
        html: emailRecord.html,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || `Email provider returned ${response.status}`);
    emailRecord.status = 'sent';
    emailRecord.provider = 'resend';
    emailRecord.provider_id = result.id;
  }

  return createRecord(client, 'inventory_email_logs', emailRecord);
}

function asInventoryArray(value) {
  return Array.isArray(value) ? value : [];
}

function average(numbers = []) {
  return numbers.length ? numbers.reduce((sum, number) => sum + number, 0) / numbers.length : 0;
}

function median(numbers = []) {
  if (!numbers.length) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function stockQuantityFromOrderLine(line = {}) {
  return toNumber(line.stock_quantity_ordered ?? line.quantity_ordered, 0);
}

function itemHistory(locationOrders = [], itemId) {
  return locationOrders
    .flatMap((order) => asInventoryArray(order.items).map((line) => ({
      date: order.created_date || order.sent_at || order.fulfilled_at || '',
      quantity: stockQuantityFromOrderLine(line),
      item_id: line.item_id,
    })))
    .filter((line) => line.item_id === itemId && line.quantity > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function historySummary(locationOrders, itemId) {
  const history = itemHistory(locationOrders, itemId);
  const quantities = history.map((row) => row.quantity);
  return {
    count: quantities.length,
    average: average(quantities),
    median: median(quantities),
    max: quantities.length ? Math.max(...quantities) : 0,
    recent: history.slice(-8).map((row) => row.quantity),
  };
}

function orderReviewContext(orderItem, item, stock, locationOrders) {
  const itemId = orderItem.item_id;
  const history = historySummary(locationOrders, itemId);
  return {
    item_id: itemId,
    item_name: orderItem.item_name || item?.name || 'Unnamed item',
    category: orderItem.category || item?.category || '',
    order_quantity: toNumber(orderItem.quantity_ordered ?? orderItem.qty, 0),
    order_unit_of_measure: orderItem.order_unit_label || orderItem.unit_of_measure || '',
    stock_quantity_ordered: stockQuantityFromOrderLine(orderItem),
    base_unit_of_measure: orderItem.base_unit_of_measure || item?.unit_of_measure || '',
    on_hand: toNumber(stock?.on_hand_quantity, 0),
    current_location_par: toNumber(stock?.par_level, 0),
    reorder_point: toNumber(stock?.reorder_point, 0),
    ai_suggested_par: toNumber(item?.ai_suggested_par, 0),
    minimum_reorder_volume: toNumber(item?.minimum_reorder_volume, 0),
    historical_order_count: history.count,
    avg_historical_order: history.average,
    median_historical_order: history.median,
    max_historical_order: history.max,
    recent_historical_orders: history.recent,
  };
}

function fallbackOrderReview(context) {
  const aiPar = context.ai_suggested_par || context.current_location_par || 0;
  const abovePar = aiPar > 0 && (context.on_hand + context.stock_quantity_ordered) > aiPar * 1.5;
  const highComparedToHistory = context.avg_historical_order > 0 && context.stock_quantity_ordered > context.avg_historical_order * 1.75;
  const belowMinimum = context.minimum_reorder_volume > 0 && context.stock_quantity_ordered < context.minimum_reorder_volume;
  const status = highComparedToHistory || abovePar || belowMinimum
    ? 'warning'
    : context.historical_order_count === 0
      ? 'question'
      : 'ok';

  let message = 'Order quantity looks reasonable.';
  let recommendation = '';
  if (status === 'question') {
    message = 'No order history yet for this item.';
    recommendation = 'Review the quantity against current need before sending.';
  } else if (belowMinimum) {
    message = 'This order is below the item minimum reorder volume.';
    recommendation = 'Increase the quantity or confirm the supplier can fulfill a smaller order.';
  } else if (status === 'warning') {
    message = 'This quantity is higher than recent patterns or current par levels.';
    recommendation = 'Double-check the quantity before sending.';
  }

  return {
    item_id: context.item_id,
    item_name: context.item_name,
    order_quantity: context.order_quantity,
    on_hand: context.on_hand,
    ai_par: aiPar,
    avg_historical_order: context.avg_historical_order,
    status,
    message,
    recommendation,
  };
}

function cleanShortText(value, maxLength = 280) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeOrderReview(aiReview, contexts) {
  const rows = asInventoryArray(aiReview);
  const byItemId = new Map(rows.map((row) => [String(row.item_id || ''), row]));
  const validStatuses = new Set(['ok', 'warning', 'question']);

  return contexts.map((context, index) => {
    const fallback = fallbackOrderReview(context);
    const raw = byItemId.get(String(context.item_id || '')) || rows[index] || {};
    const status = validStatuses.has(raw.status) ? raw.status : fallback.status;
    return {
      ...fallback,
      order_quantity: toNumber(raw.order_quantity ?? raw.quantity_ordered, fallback.order_quantity),
      on_hand: toNumber(raw.on_hand, fallback.on_hand),
      ai_par: toNumber(raw.ai_par ?? raw.suggested_par, fallback.ai_par),
      avg_historical_order: toNumber(raw.avg_historical_order, fallback.avg_historical_order),
      status,
      message: cleanShortText(raw.message) || fallback.message,
      recommendation: cleanShortText(raw.recommendation),
    };
  });
}

async function reviewOrderBeforeSend(client, companyId, body) {
  const [locInv, items, previousOrders] = await Promise.all([
    fetchCompanyRows(client, 'inventory_location_stock', companyId),
    fetchCompanyRows(client, 'inventory_items', companyId),
    fetchCompanyRows(client, 'inventory_orders', companyId),
  ]);
  const locationOrders = previousOrders.filter((order) => order.location_id === body.location_id);
  const contexts = asInventoryArray(body.order_items).map((orderItem) => {
    const item = items.find((row) => row.id === orderItem.item_id);
    const stock = locInv.find((row) => row.location_id === body.location_id && row.item_id === orderItem.item_id);
    return orderReviewContext(orderItem, item, stock, locationOrders);
  });

  if (!contexts.length) return { success: true, review: [] };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      success: true,
      ai_source: 'history_fallback',
      warning: 'OpenAI is not configured yet, so Taskr used the built-in order review fallback.',
      review: contexts.map(fallbackOrderReview),
    };
  }

  const model = inventoryAiModel('order_review');
  const parsed = await requestOpenAiJson({
    apiKey,
    model,
    errorMessage: 'OpenAI order review returned unreadable data.',
    messages: [
      {
        role: 'system',
        content: [
          'You are Taskr inventory ordering AI for restaurants, coffee shops, and retail operators.',
          'Review pending purchase order lines against on-hand stock, location par, item AI par, reorder minimums, and recent order history.',
          'Return JSON only: {"review":[{"item_id":"","status":"ok|warning|question","message":"","recommendation":"","ai_par":0,"avg_historical_order":0,"on_hand":0,"order_quantity":0}]}',
          'Use warning for likely over-ordering, below-minimum orders, or quantities that conflict with par or history.',
          'Use question when data is too sparse. Keep messages concise and operational.',
          'Use only item_id values provided by the user.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          location_id: body.location_id,
          items: contexts,
        }),
      },
    ],
  });

  return {
    success: true,
    ai_source: 'openai',
    model,
    review: normalizeOrderReview(parsed.review, contexts),
  };
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function smartParContext(item, stock, locationOrders) {
  const history = historySummary(locationOrders, item.id);
  return {
    item_id: item.id,
    item_name: item.name || 'Unnamed item',
    category: item.category || '',
    unit_of_measure: item.unit_of_measure || '',
    unit_cost: toNumber(item.unit_cost, 0),
    current_on_hand: toNumber(stock?.on_hand_quantity, 0),
    current_location_par: toNumber(stock?.par_level, 0),
    current_reorder_point: toNumber(stock?.reorder_point, 0),
    existing_ai_suggested_par: toNumber(item.ai_suggested_par, 0),
    existing_minimum_reorder_volume: toNumber(item.minimum_reorder_volume, 0),
    history_count: history.count,
    avg_order_quantity: history.average,
    median_order_quantity: history.median,
    max_order_quantity: history.max,
    recent_order_quantities: history.recent,
  };
}

function fallbackSmartParResult(context) {
  const suggested = Math.max(1, Math.ceil(context.avg_order_quantity * 1.25));
  const minimum = Math.max(1, Math.floor(suggested * 0.35));
  return {
    item_id: context.item_id,
    item_name: context.item_name,
    status: 'updated',
    suggested_par: suggested,
    minimum_reorder_volume: minimum,
    confidence: context.history_count >= 4 ? 'medium' : 'low',
    reason: context.history_count >= 4
      ? 'Based on recent order history with a modest buffer.'
      : 'Based on limited order history with a conservative buffer.',
  };
}

function noHistorySmartParResult(item) {
  return {
    item_id: item.id,
    item_name: item.name || 'Unnamed item',
    status: 'no_history',
  };
}

function normalizeSmartParResult(raw, context) {
  const fallback = fallbackSmartParResult(context);
  const suggested = Math.max(1, Math.ceil(toNumber(raw.suggested_par ?? raw.par_level ?? raw.ai_suggested_par, fallback.suggested_par)));
  let minimum = Math.max(1, Math.ceil(toNumber(raw.minimum_reorder_volume ?? raw.minimum_order ?? raw.reorder_point, fallback.minimum_reorder_volume)));
  if (minimum > suggested) minimum = Math.max(1, Math.floor(suggested * 0.5));

  return {
    ...fallback,
    suggested_par: suggested,
    minimum_reorder_volume: minimum,
    confidence: ['low', 'medium', 'high'].includes(raw.confidence) ? raw.confidence : fallback.confidence,
    reason: cleanShortText(raw.reason, 220) || fallback.reason,
  };
}

async function openAiSmartParBatch(apiKey, model, batch) {
  const parsed = await requestOpenAiJson({
    apiKey,
    model,
    errorMessage: 'OpenAI smart par calculation returned unreadable data.',
    messages: [
      {
        role: 'system',
        content: [
          'You calculate AI suggested par levels for inventory ordering.',
          'Use base stock units from the provided unit_of_measure and recent order quantities.',
          'Recommend a par that covers normal order demand with a practical buffer, without overstocking expensive or slow-moving items.',
          'minimum_reorder_volume should be lower than or equal to suggested_par and represent a practical minimum order trigger.',
          'Return JSON only: {"results":[{"item_id":"","suggested_par":0,"minimum_reorder_volume":0,"confidence":"low|medium|high","reason":""}]}',
          'Use only item_id values provided by the user. Do not include items without history.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({ items: batch }),
      },
    ],
  });
  return asInventoryArray(parsed.results);
}

async function calculateSmartParsAfterCount(client, companyId, body) {
  const locationId = body.location_id;
  const [items, orders, locInv] = await Promise.all([
    fetchCompanyRows(client, 'inventory_items', companyId),
    fetchCompanyRows(client, 'inventory_orders', companyId),
    fetchCompanyRows(client, 'inventory_location_stock', companyId),
  ]);
  const activeItems = items.filter((item) => item.is_active !== false);
  const locationOrders = orders.filter((order) => order.location_id === locationId);
  const contexts = activeItems.map((item) => smartParContext(
    item,
    locInv.find((row) => row.location_id === locationId && row.item_id === item.id),
    locationOrders
  ));
  const contextsWithHistory = contexts.filter((context) => context.history_count > 0);
  const resultsByItemId = new Map();
  const apiKey = process.env.OPENAI_API_KEY;
  const model = inventoryAiModel('smart_pars');

  if (apiKey && contextsWithHistory.length > 0) {
    for (const batch of chunkArray(contextsWithHistory, 40)) {
      const aiRows = await openAiSmartParBatch(apiKey, model, batch);
      const aiRowsByItemId = new Map(aiRows.map((row) => [String(row.item_id || ''), row]));
      for (const context of batch) {
        resultsByItemId.set(
          context.item_id,
          normalizeSmartParResult(aiRowsByItemId.get(String(context.item_id)) || {}, context)
        );
      }
    }
  } else {
    for (const context of contextsWithHistory) {
      resultsByItemId.set(context.item_id, fallbackSmartParResult(context));
    }
  }

  const results = activeItems.map((item) => resultsByItemId.get(item.id) || noHistorySmartParResult(item));
  const now = nowIso();
  await Promise.all(results
    .filter((row) => row.status === 'updated')
    .map((row) => updateRecord(client, 'inventory_items', row.item_id, companyId, {
      ai_suggested_par: row.suggested_par,
      minimum_reorder_volume: row.minimum_reorder_volume,
      last_par_calculation_date: now,
    })));

  return {
    success: true,
    ai_source: apiKey ? 'openai' : 'history_fallback',
    model: apiKey ? model : undefined,
    warning: apiKey ? '' : 'OpenAI is not configured yet, so Taskr used the built-in smart par fallback.',
    items_processed: activeItems.length,
    items_updated: results.filter((row) => row.status === 'updated').length,
    results,
  };
}

const CATALOG_VALID_UOMS = ['EA', 'fl-oz', 'ml', 'L', 'Pt', 'Qt', 'gal', 'oz', 'lb', 'g', 'kg'];

const CATALOG_UOM_FAMILIES = {
  'fl-oz': 'volume',
  ml: 'volume',
  L: 'volume',
  Pt: 'volume',
  Qt: 'volume',
  gal: 'volume',
  oz: 'weight',
  lb: 'weight',
  g: 'weight',
  gr: 'weight',
  kg: 'weight',
  EA: 'count',
};

function catalogIssue(item, type, severity, message, fix = null) {
  return {
    item_id: item.id,
    item_name: item.name || 'Unnamed item',
    type,
    severity,
    message,
    fix,
  };
}

function auditCatalogItem(item) {
  const issues = [];
  const options = Array.isArray(item.purchase_options) ? item.purchase_options : [];
  const uom = String(item.unit_of_measure || '').trim();

  if (!uom) {
    issues.push(catalogIssue(item, 'missing_uom', 'error', 'No unit of measure is set, so counts and pricing cannot be calculated.'));
  } else if (!CATALOG_VALID_UOMS.includes(uom)) {
    issues.push(catalogIssue(item, 'invalid_uom', 'error', `"${uom}" is not a supported unit of measure.`));
  }

  if (!String(item.category || '').trim()) {
    issues.push(catalogIssue(item, 'missing_category', 'warning', 'No subcategory is set, so the item is hard to find in filters and reports.'));
  }

  if (!options.length) {
    issues.push(catalogIssue(item, 'missing_purchase_options', 'error', 'No purchase options are set, so this item cannot be ordered from a vendor.'));
  }

  options.forEach((option, index) => {
    const label = option.vendor_name || option.product_name || `Option ${index + 1}`;
    if (!option.vendor_id && !String(option.vendor_name || '').trim()) {
      issues.push(catalogIssue(item, 'option_missing_vendor', 'warning', `Purchase option ${index + 1} has no vendor assigned.`));
    }
    if (!toNumber(option.unit_cost, 0)) {
      issues.push(catalogIssue(item, 'option_missing_cost', 'warning', `Purchase option "${label}" has no unit cost, so price comparisons skip it.`));
    }
    const orderingUom = String(option.unit_of_measure || '').trim();
    if (orderingUom.toLowerCase() === 'case' && (!toNumber(option.inner_pack_units, 0) || !toNumber(option.packs_per_case, 0))) {
      issues.push(catalogIssue(item, 'option_missing_pack_size', 'warning', `Purchase option "${label}" is ordered by the case but is missing pack size details, so per-unit pricing cannot be calculated.`));
    }
    const packUom = String(option.inner_pack_uom || '').trim();
    if (uom && packUom && CATALOG_UOM_FAMILIES[packUom] && CATALOG_UOM_FAMILIES[uom] && CATALOG_UOM_FAMILIES[packUom] !== CATALOG_UOM_FAMILIES[uom]) {
      issues.push(catalogIssue(item, 'option_uom_mismatch', 'warning', `Purchase option "${label}" packs are measured in ${packUom} (${CATALOG_UOM_FAMILIES[packUom]}), which cannot convert to the item unit ${uom} (${CATALOG_UOM_FAMILIES[uom]}).`));
    }
  });

  if (Array.isArray(item.count_units) && !item.count_units.length) {
    issues.push(catalogIssue(
      item,
      'no_count_units',
      'suggestion',
      'No counting units are selected in the item editor, so inventory counts fall back to the default units derived from purchase options.',
      { field: 'count_units', label: 'Reset to the default counting units', value: null }
    ));
  }

  return issues;
}

function catalogReviewContext(item) {
  const options = Array.isArray(item.purchase_options) ? item.purchase_options : [];
  return {
    item_id: item.id,
    item_name: item.name || '',
    description: item.description || '',
    category: item.category || '',
    unit_of_measure: item.unit_of_measure || '',
    purchase_options: options.map((option) => ({
      vendor: option.vendor_name || '',
      product: option.product_name || '',
      ordering_uom: option.unit_of_measure || '',
      inner_pack_uom: option.inner_pack_uom || '',
      inner_pack_units: toNumber(option.inner_pack_units, 0),
      packs_per_case: toNumber(option.packs_per_case, 0),
    })),
  };
}

async function openAiCatalogReviewBatch(apiKey, model, batch, categories) {
  const parsed = await requestOpenAiJson({
    apiKey,
    model,
    errorMessage: 'OpenAI catalog review returned unreadable data.',
    messages: [
      {
        role: 'system',
        content: [
          'You audit inventory catalogs for restaurants, coffee shops, and retail operators.',
          `Supported units of measure: ${CATALOG_VALID_UOMS.join(', ')}. EA means each/count, oz is dry weight, fl-oz is fluid volume.`,
          'For each item judge whether the unit of measure fits how the item is realistically stocked and counted (liquids in volume units, bulk dry goods in weight units, packaged or discrete goods in EA), and whether the category fits the item.',
          'When an item has no unit of measure or no category, treat it as not ok and suggest the best value.',
          'Otherwise only flag clear mistakes; when in doubt mark the item ok.',
          'When you flag a unit, suggest the best supported unit. When you flag a category, suggest one from available_categories only.',
          'Return JSON only: {"results":[{"item_id":"","uom_ok":true,"suggested_uom":"","uom_reason":"","category_ok":true,"suggested_category":"","category_reason":""}]}',
          'Use only item_id values provided by the user.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({ available_categories: categories, items: batch }),
      },
    ],
  });
  return asInventoryArray(parsed.results);
}

async function reviewCatalog(client, companyId) {
  const [items, categoryRows] = await Promise.all([
    fetchCompanyRows(client, 'inventory_items', companyId),
    fetchCompanyRows(client, 'inventory_categories', companyId).catch(() => []),
  ]);
  const activeItems = items.filter((item) => item.is_active !== false);
  const issues = activeItems.flatMap(auditCatalogItem);

  const apiKey = process.env.OPENAI_API_KEY;
  const model = inventoryAiModel();

  if (apiKey && activeItems.length) {
    const categoryNames = [...new Set(
      [
        ...categoryRows.filter((category) => category.is_active !== false).map((category) => category.name),
        ...activeItems.map((item) => item.category),
      ].map((name) => String(name || '').trim()).filter(Boolean)
    )].sort();
    const itemsById = new Map(activeItems.map((item) => [String(item.id), item]));

    // Rule-based issues for the same field absorb the AI suggestion instead of
    // becoming a duplicate row (e.g. "missing category" + the suggested category).
    const issueByField = new Map();
    for (const issue of issues) {
      if (issue.type === 'missing_uom' || issue.type === 'invalid_uom') issueByField.set(`${issue.item_id}:unit_of_measure`, issue);
      if (issue.type === 'missing_category') issueByField.set(`${issue.item_id}:category`, issue);
    }
    const addSuggestion = (item, field, type, message, label, value) => {
      const existing = issueByField.get(`${item.id}:${field}`);
      const fix = { field, label, value };
      if (existing && !existing.fix) {
        existing.fix = fix;
        existing.message = `${existing.message} ${message}`;
      } else {
        issues.push(catalogIssue(item, type, 'suggestion', message, fix));
      }
    };

    const batches = chunkArray(activeItems.map(catalogReviewContext), 40);
    const batchResults = await Promise.all(
      batches.map((batch) => openAiCatalogReviewBatch(apiKey, model, batch, categoryNames))
    );
    for (const rows of batchResults) {
      for (const row of rows) {
        const item = itemsById.get(String(row.item_id || ''));
        if (!item) continue;

        const suggestedUom = String(row.suggested_uom || '').trim();
        if (row.uom_ok === false && CATALOG_VALID_UOMS.includes(suggestedUom) && suggestedUom !== (item.unit_of_measure || '')) {
          addSuggestion(
            item,
            'unit_of_measure',
            'uom_suggestion',
            cleanShortText(row.uom_reason) || `The unit "${item.unit_of_measure || 'none'}" looks wrong for this item.`,
            `Change unit of measure to ${suggestedUom}`,
            suggestedUom
          );
        }

        const suggestedCategory = cleanShortText(row.suggested_category, 80);
        if (row.category_ok === false && suggestedCategory && categoryNames.includes(suggestedCategory) && suggestedCategory !== (item.category || '')) {
          addSuggestion(
            item,
            'category',
            'category_suggestion',
            cleanShortText(row.category_reason) || `The category "${item.category || 'none'}" looks wrong for this item.`,
            `Change category to ${suggestedCategory}`,
            suggestedCategory
          );
        }
      }
    }
  }

  return {
    success: true,
    ai_source: apiKey ? 'openai' : 'rules_only',
    model: apiKey ? model : undefined,
    warning: apiKey ? '' : 'OpenAI is not configured yet, so Taskr ran the built-in catalog checks without AI suggestions.',
    items_reviewed: activeItems.length,
    issues,
  };
}

const AI_IMPORT_FIELDS = [
  'item_name', 'sku', 'category', 'unit_of_measure', 'unit_cost', 'description',
  'is_commissary_item', 'commissary_price', 'is_active',
  'vendor_name', 'vendor_email', 'product_name', 'product_code', 'pack_size',
  'inner_pack_units', 'inner_pack_name', 'packs_per_case',
];

async function openAiImportColumnMap(apiKey, model, headers, sampleRows) {
  const parsed = await requestOpenAiJson({
    apiKey,
    model,
    errorMessage: 'OpenAI could not read the file structure.',
    messages: [
      {
        role: 'system',
        content: [
          'You map spreadsheet columns for an inventory catalog import in a restaurant/coffee shop app.',
          `Target fields: ${AI_IMPORT_FIELDS.join(', ')}.`,
          'item_name is the inventory item name (required). product_name and product_code describe the vendor-specific purchase option. unit_cost is the purchase price. vendor_name is the supplier.',
          'Match on meaning, not exact wording (e.g. "Supplier" -> vendor_name, "Price" -> unit_cost, "Qty per pack" -> inner_pack_units).',
          'Use each source column for at most one target field; use null when nothing matches.',
          'Return JSON only: {"column_map":{"<target field>":"<exact source column name or null>"}}',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({ columns: headers, sample_rows: sampleRows }),
      },
    ],
  });
  return parsed.column_map || {};
}

async function openAiImportValues(apiKey, model, payload) {
  const parsed = await requestOpenAiJson({
    apiKey,
    model,
    errorMessage: 'OpenAI could not normalize the file values.',
    messages: [
      {
        role: 'system',
        content: [
          'You assist an inventory catalog import for a restaurant/coffee shop app.',
          `Supported units of measure: ${CATALOG_VALID_UOMS.join(', ')} (EA = each/count, oz = dry weight, fl-oz = fluid volume).`,
          'Map each provided unit value to the closest supported unit, or null when unclear.',
          'Map each provided category value to one of existing_categories when it clearly means the same thing, otherwise null.',
          'List import_item_names that almost certainly refer to the same product as an existing_item_names entry (same product with different spelling, abbreviations, or formatting) as duplicate pairs. Do not pair items that are merely similar products.',
          'Return JSON only: {"uom_map":{"<value>":"<supported unit or null>"},"category_map":{"<value>":"<existing category or null>"},"duplicates":[{"import_name":"","existing_name":""}]}',
        ].join(' '),
      },
      { role: 'user', content: JSON.stringify(payload) },
    ],
  });
  return parsed;
}

async function aiPrepareCatalogImport(client, user, body) {
  const companyId = user.company_id;
  let csvText = String(body.csv_text || '').trim();
  if (!csvText && body.file_url) {
    const response = await fetch(body.file_url);
    if (!response.ok) throw httpError(400, `Unable to download catalog file (${response.status})`);
    csvText = (await response.text()).trim();
  }
  if (!csvText) throw httpError(400, 'Catalog file is required.');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw httpError(400, 'OpenAI is not configured, so AI import is unavailable. Use the template import instead.');

  const rows = parseCsv(csvText);
  if (!rows.length) throw httpError(400, 'No data rows found in the file.');
  const headers = Object.keys(rows[0] || {}).filter(Boolean);

  const model = inventoryAiModel();
  const rawColumnMap = await openAiImportColumnMap(apiKey, model, headers, rows.slice(0, 8));
  const columnMap = {};
  for (const field of AI_IMPORT_FIELDS) {
    const column = rawColumnMap[field];
    columnMap[field] = headers.includes(column) ? column : null;
  }
  if (!columnMap.item_name) throw httpError(422, 'Could not identify an item name column in this file.');

  const valueOf = (row, field) => (columnMap[field] ? String(row[columnMap[field]] ?? '').trim() : '');

  const [existingItems, categoryRows] = await Promise.all([
    fetchCompanyRows(client, 'inventory_items', companyId),
    fetchCompanyRows(client, 'inventory_categories', companyId).catch(() => []),
  ]);
  const existingByNorm = new Map(existingItems.map((item) => [normalizeMatchText(item.name), item]));
  const categoryNames = [...new Set(
    [
      ...categoryRows.filter((category) => category.is_active !== false).map((category) => category.name),
      ...existingItems.map((item) => item.category),
    ].map((name) => String(name || '').trim()).filter(Boolean)
  )].sort();

  // Group file rows into items (one item may span several rows = purchase options).
  const grouped = new Map();
  let rowsSkipped = 0;
  for (const row of rows) {
    const name = valueOf(row, 'item_name');
    if (!name) {
      rowsSkipped += 1;
      continue;
    }
    if (!grouped.has(name)) grouped.set(name, []);
    grouped.get(name).push(row);
  }
  if (!grouped.size) throw httpError(422, 'No rows with an item name were found in this file.');

  // Collect values that need AI normalization, plus names for fuzzy duplicate detection.
  const uomValues = new Set();
  const categoryValues = new Set();
  for (const itemRows of grouped.values()) {
    for (const row of itemRows) {
      const uom = valueOf(row, 'unit_of_measure');
      if (uom && !CATALOG_VALID_UOMS.includes(uom)) uomValues.add(uom);
      const category = valueOf(row, 'category');
      if (category && !categoryNames.includes(category)) categoryValues.add(category);
    }
  }
  const namesForDupeCheck = [...grouped.keys()]
    .filter((name) => !existingByNorm.has(normalizeMatchText(name)))
    .slice(0, 300);

  let uomMap = {};
  let categoryMap = {};
  const aiDupeByNorm = new Map();
  if (uomValues.size || categoryValues.size || (namesForDupeCheck.length && existingItems.length)) {
    const values = await openAiImportValues(apiKey, model, {
      uom_values: [...uomValues].slice(0, 40),
      category_values: [...categoryValues].slice(0, 40),
      existing_categories: categoryNames,
      import_item_names: namesForDupeCheck,
      existing_item_names: existingItems.map((item) => item.name).filter(Boolean).slice(0, 500),
    });
    uomMap = values.uom_map || {};
    categoryMap = values.category_map || {};
    for (const pair of asInventoryArray(values.duplicates)) {
      const match = existingByNorm.get(normalizeMatchText(pair.existing_name));
      if (match && pair.import_name) aiDupeByNorm.set(normalizeMatchText(pair.import_name), match);
    }
  }

  const normalizeUomValue = (raw) => {
    if (!raw) return '';
    if (CATALOG_VALID_UOMS.includes(raw)) return raw;
    const mapped = uomMap[raw];
    return CATALOG_VALID_UOMS.includes(mapped) ? mapped : '';
  };

  const items = [];
  for (const [name, itemRows] of grouped) {
    const first = itemRows[0];
    const warnings = [];

    const rawUom = valueOf(first, 'unit_of_measure');
    const uom = normalizeUomValue(rawUom);
    if (rawUom && !uom) warnings.push(`Unit "${rawUom}" is not supported and could not be translated — defaults to EA.`);
    if (!rawUom) warnings.push('No unit of measure in the file — defaults to EA.');

    const rawCategory = valueOf(first, 'category');
    let category = rawCategory;
    if (rawCategory && !categoryNames.includes(rawCategory)) {
      const mapped = String(categoryMap[rawCategory] || '').trim();
      if (mapped && categoryNames.includes(mapped)) {
        category = mapped;
        warnings.push(`Category "${rawCategory}" matched to your existing "${mapped}".`);
      } else {
        warnings.push(`"${rawCategory}" is a new subcategory.`);
      }
    }

    const purchaseOptions = [];
    for (const row of itemRows) {
      const vendorName = valueOf(row, 'vendor_name');
      if (!vendorName) continue;
      purchaseOptions.push({
        vendor_name: vendorName,
        vendor_email: valueOf(row, 'vendor_email'),
        product_name: valueOf(row, 'product_name') || name,
        product_code: valueOf(row, 'product_code') || valueOf(row, 'sku'),
        pack_size: valueOf(row, 'pack_size'),
        unit_cost: toNumber(valueOf(row, 'unit_cost')),
        unit_of_measure: normalizeUomValue(valueOf(row, 'unit_of_measure')) || uom || 'EA',
        inner_pack_units: toNumber(valueOf(row, 'inner_pack_units'), null),
        inner_pack_name: valueOf(row, 'inner_pack_name'),
        packs_per_case: toNumber(valueOf(row, 'packs_per_case'), null),
      });
    }
    if (!purchaseOptions.length) warnings.push('No vendor found in the file — the item will have no purchase options.');
    if (purchaseOptions.some((option) => !option.unit_cost)) warnings.push('One or more purchase options have no unit cost.');

    const costs = purchaseOptions.map((option) => option.unit_cost).filter((cost) => cost > 0);
    const match = existingByNorm.get(normalizeMatchText(name)) || aiDupeByNorm.get(normalizeMatchText(name));
    const isExact = !!existingByNorm.get(normalizeMatchText(name));
    const status = match ? (isExact ? 'duplicate' : 'possible_duplicate') : 'new';

    items.push({
      name,
      sku: valueOf(first, 'sku'),
      category,
      unit_of_measure: uom || 'EA',
      unit_cost: costs.length ? Math.min(...costs) : toNumber(valueOf(first, 'unit_cost')),
      description: valueOf(first, 'description'),
      is_commissary_item: toBool(valueOf(first, 'is_commissary_item'), false),
      commissary_price: toNumber(valueOf(first, 'commissary_price'), null),
      is_active: toBool(valueOf(first, 'is_active'), true),
      purchase_options: purchaseOptions,
      status,
      match_item_id: match?.id || null,
      match_item_name: match?.name || null,
      warnings,
      default_action: status === 'new' ? 'create' : 'skip',
    });
  }

  const mappedColumns = new Set(Object.values(columnMap).filter(Boolean));
  return {
    success: true,
    ai_source: 'openai',
    model,
    column_map: columnMap,
    unmapped_columns: headers.filter((header) => !mappedColumns.has(header)),
    rows_total: rows.length,
    rows_skipped: rowsSkipped,
    stats: {
      new: items.filter((item) => item.status === 'new').length,
      duplicates: items.filter((item) => item.status === 'duplicate').length,
      possible_duplicates: items.filter((item) => item.status === 'possible_duplicate').length,
    },
    items,
  };
}

async function aiCommitCatalogImport(client, user, body) {
  const companyId = user.company_id;
  const decisions = asInventoryArray(body.items);
  const actionable = decisions.filter((decision) => decision?.item?.name && (decision.action === 'create' || decision.action === 'merge'));

  const [vendors, existingItems] = await Promise.all([
    fetchCompanyRows(client, 'inventory_vendors', companyId),
    fetchCompanyRows(client, 'inventory_items', companyId),
  ]);
  const vendorByName = new Map(vendors.map((vendor) => [String(vendor.name || '').toLowerCase(), vendor]));
  const itemById = new Map(existingItems.map((item) => [item.id, item]));
  const itemByNorm = new Map(existingItems.map((item) => [normalizeMatchText(item.name), item]));

  const results = {
    created: 0,
    merged: 0,
    skipped: decisions.length - actionable.length,
    vendors_created: 0,
    errors: [],
  };

  for (const decision of actionable) {
    const raw = decision.item;
    const name = cleanShortText(raw.name, 200);
    try {
      const purchaseOptions = [];
      for (const option of asInventoryArray(raw.purchase_options)) {
        const vendorName = cleanShortText(option.vendor_name, 120);
        if (!vendorName) continue;
        let vendor = vendorByName.get(vendorName.toLowerCase());
        if (!vendor) {
          vendor = await createRecord(client, 'inventory_vendors', {
            company_id: companyId,
            name: vendorName,
            email: cleanShortText(option.vendor_email, 200),
            is_active: true,
            notes: 'Auto-created during AI catalog import',
          });
          vendorByName.set(vendorName.toLowerCase(), vendor);
          results.vendors_created += 1;
        }
        purchaseOptions.push({
          vendor_id: vendor.id,
          vendor_name: vendor.name,
          product_name: cleanShortText(option.product_name, 200) || name,
          product_code: cleanShortText(option.product_code, 120),
          pack_size: cleanShortText(option.pack_size, 120),
          unit_cost: toNumber(option.unit_cost),
          unit_of_measure: CATALOG_VALID_UOMS.includes(option.unit_of_measure) ? option.unit_of_measure : (raw.unit_of_measure || 'EA'),
          inner_pack_units: toNumber(option.inner_pack_units, null),
          inner_pack_name: cleanShortText(option.inner_pack_name, 120) || null,
          packs_per_case: toNumber(option.packs_per_case, null),
          is_preferred: purchaseOptions.length === 0,
          location_ids: null,
          notes: '',
        });
      }

      const costs = purchaseOptions.map((option) => option.unit_cost).filter((cost) => cost > 0);
      const itemData = {
        company_id: companyId,
        name,
        sku: cleanShortText(raw.sku, 120),
        category: cleanShortText(raw.category, 120),
        unit_of_measure: CATALOG_VALID_UOMS.includes(raw.unit_of_measure) ? raw.unit_of_measure : 'EA',
        unit_cost: costs.length ? Math.min(...costs) : toNumber(raw.unit_cost),
        is_commissary_item: !!raw.is_commissary_item,
        commissary_price: toNumber(raw.commissary_price, null),
        description: cleanShortText(raw.description, 500),
        is_active: raw.is_active !== false,
        purchase_options: purchaseOptions,
      };

      if (decision.action === 'merge') {
        const target = itemById.get(raw.match_item_id) || itemByNorm.get(normalizeMatchText(name));
        if (!target) throw new Error('No existing item found to merge into');
        const targetOptions = target.purchase_options || [];
        const existingVendorNames = new Set(targetOptions.map((option) => String(option.vendor_name || '').toLowerCase()));
        const newOptions = purchaseOptions
          .filter((option) => !existingVendorNames.has(String(option.vendor_name || '').toLowerCase()))
          .map((option) => ({ ...option, is_preferred: targetOptions.length === 0 && option.is_preferred }));
        // Merging only adds purchase options and fills blanks — it never
        // overwrites data already on the existing item.
        await updateRecord(client, 'inventory_items', target.id, companyId, {
          purchase_options: [...targetOptions, ...newOptions],
          sku: target.sku || itemData.sku,
          category: target.category || itemData.category,
          unit_of_measure: target.unit_of_measure || itemData.unit_of_measure,
          description: target.description || itemData.description,
        });
        results.merged += 1;
      } else {
        if (itemByNorm.has(normalizeMatchText(name))) {
          throw new Error('an item with this name already exists — merge or skip it instead');
        }
        const created = await createRecord(client, 'inventory_items', itemData);
        itemByNorm.set(normalizeMatchText(name), created);
        results.created += 1;
      }
    } catch (error) {
      results.errors.push(`${name || 'row'}: ${error.message}`);
    }
  }

  return { success: true, results };
}

async function fulfillCommissaryOrder(client, user, body) {
  const companyId = user.company_id;
  const order = await getRecord(client, 'inventory_orders', body.order_id, companyId);
  if (!order) throw httpError(404, 'Order not found');
  const requestedItems = body.fulfillment_items || [];
  const fulfilledItems = [];
  const remainingItems = [];

  for (const item of requestedItems) {
    const orderedQuantity = numericQuantity(item.quantity_ordered);
    const fulfilledQuantity = Math.min(
      orderedQuantity,
      Math.max(0, numericQuantity(item.quantity_fulfilled))
    );
    const remainingQuantity = Math.max(0, orderedQuantity - fulfilledQuantity);

    if (fulfilledQuantity > 0) {
      fulfilledItems.push(commissaryOrderLine(item, fulfilledQuantity, orderedQuantity, fulfilledQuantity));
    }

    if (remainingQuantity > 0) {
      remainingItems.push(commissaryOrderLine(item, remainingQuantity, orderedQuantity, 0));
    }
  }

  if (fulfilledItems.length === 0) {
    throw httpError(400, 'At least one item quantity must be fulfilled.');
  }

  const splitRequested = body.split_option === 'split' && remainingItems.length > 0;
  const allFulfilled = remainingItems.length === 0;
  const totalAmount = fulfilledItems.reduce((sum, item) => sum + Number(item.total_cost || 0), 0);
  const remainingAmount = remainingItems.reduce((sum, item) => sum + Number(item.total_cost || 0), 0);
  const fulfilledAt = nowIso();
  const orderNumber = order.order_number || `CO-${Date.now().toString().slice(-6)}`;
  let splitOrder = null;

  if (splitRequested) {
    const splitOrderNumber = `${orderNumber} - Split`;
    splitOrder = await createRecord(client, 'inventory_orders', {
      company_id: companyId,
      type: order.type || 'commissary',
      status: 'viewed',
      location_id: order.location_id,
      vendor_id: order.vendor_id,
      order_number: splitOrderNumber,
      items: remainingItems,
      total_amount: remainingAmount,
      notes: appendNote(order.notes, `Split from ${orderNumber}`),
      viewed_at: fulfilledAt,
      sent_at: order.sent_at || fulfilledAt,
    });
  }

  const fulfillment = await createRecord(client, 'inventory_commissary_fulfillments', {
    company_id: companyId,
    order_id: order.id,
    order_number: orderNumber,
    retail_location_id: order.location_id,
    commissary_location_id: body.commissary_location_id,
    items: fulfilledItems,
    notes: body.notes || '',
    status: allFulfilled || splitRequested ? 'fulfilled' : 'partial',
    fulfillment_date: fulfilledAt,
    total_amount: totalAmount,
  });
  const invoice = await createRecord(client, 'inventory_invoices', {
    company_id: companyId,
    order_id: order.id,
    location_id: order.location_id,
    vendor_name: 'Commissary',
    invoice_number: `CI-${Date.now().toString().slice(-6)}`,
    invoice_date: new Date().toISOString().slice(0, 10),
    status: 'pending_review',
    extracted_items: fulfilledItems.map((item) => ({
      item_id: item.item_id,
      item_name: item.item_name,
      quantity: Number(item.quantity_fulfilled || 0),
      unit_cost: Number(item.unit_cost || 0),
      total_cost: Number(item.total_cost || 0),
      matched: true,
    })),
    total_amount: totalAmount,
  });

  const nextOrderPatch = splitRequested || allFulfilled
    ? {
        status: 'fulfilled',
        fulfilled_at: fulfilledAt,
        items: fulfilledItems,
        total_amount: totalAmount,
      }
    : {
        status: 'partial',
        fulfilled_at: fulfilledAt,
        items: remainingItems,
        total_amount: remainingAmount,
      };

  if (splitRequested) {
    nextOrderPatch.notes = appendNote(order.notes, `Remaining items moved to ${splitOrder.order_number}`);
  }

  await updateRecord(client, 'inventory_orders', order.id, companyId, nextOrderPatch);
  return { success: true, fulfillment, invoice, split_order: splitOrder };
}

async function extractInvoiceImage(client, user, body) {
  const fileUrl = String(body.file_url || body.fileUrl || body.file_urls?.[0] || '').trim();
  if (!fileUrl) throw httpError(400, 'Invoice image is required.');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      vendor_name: '',
      invoice_number: '',
      invoice_date: null,
      total_amount: 0,
      items: [],
      warning: 'Scanned invoice parsing is not configured yet. The image was uploaded, and you can add lines manually.',
    };
  }

  const [catalogItems, vendors] = await Promise.all([
    fetchCompanyRows(client, 'inventory_items', user.company_id),
    fetchCompanyRows(client, 'inventory_vendors', user.company_id).catch(() => []),
  ]);
  const activeCatalogItems = catalogItems
    .filter((item) => item.is_active !== false)
    .map((item) => ({
      id: item.id,
      name: item.name,
      sku: item.sku || '',
      category: item.category || '',
      unit_of_measure: item.unit_of_measure || '',
      purchase_options: (item.purchase_options || []).map((option) => ({
        vendor_id: option.vendor_id || '',
        vendor_name: option.vendor_name || '',
        product_name: option.product_name || '',
        product_code: option.product_code || option.vendor_sku || '',
        vendor_sku: option.vendor_sku || option.product_code || '',
        item_code: option.item_code || option.vendor_item_number || option.supplier_item_number || '',
        vendor_item_number: option.vendor_item_number || '',
        product_number: option.product_number || '',
        supplier_item_number: option.supplier_item_number || '',
        supplier_sku: option.supplier_sku || '',
        vendor_code: option.vendor_code || '',
        catalog_number: option.catalog_number || '',
        sku: option.sku || '',
        upc: option.upc || '',
        unit_of_measure: option.unit_of_measure || '',
      })),
    }))
    .slice(0, 600);
  const promptCatalogItems = compactInvoicePromptCatalog(activeCatalogItems);
  const activeVendorNames = vendors
    .filter((vendor) => vendor.is_active !== false)
    .map((vendor) => String(vendor.name || '').trim())
    .filter(Boolean)
    .slice(0, 200);

  const model = process.env.OPENAI_INVOICE_MODEL || process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
  const imageUrl = await imageUrlToDataUrl(fileUrl, client);
  const isPdf = imageUrl.startsWith('data:application/pdf');
  const invoiceContentPart = isPdf
    ? { type: 'file', file: { filename: 'invoice.pdf', file_data: imageUrl } }
    : { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } };
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
            'You extract structured data from food, beverage, retail, and supplier invoices.',
            'Return JSON only with vendor_name, supplier_name, seller_name, remit_to_name, bill_to_name, ship_to_name, customer_name, invoice_number, invoice_date, subtotal_amount, tax_amount, freight_amount, total_amount, and items.',
            'vendor_name means the company issuing the invoice: the supplier/seller/remit-to company, usually shown in the logo/header, "from", "remit to", "mail payments to", or seller area.',
            'bill_to_name, ship_to_name, sold_to_name, customer_name, customer number, customer PO, delivery address, and buyer account names identify the buyer/recipient, not the vendor.',
            'Never use bill-to, sold-to, ship-to, customer, customer number, customer PO, delivery address, or buyer account names as vendor_name.',
            'If an invoice has both a supplier header and sold-to/bill-to/customer block, choose the supplier header/remit-to company.',
            'If a known vendor appears in the supplier/header/remit-to area, vendor_name must be the exact known vendor name from the provided list.',
            'For Chefs Warehouse / Greenleaf invoices, vendor_name should be Chefs Warehouse or The Chefs Warehouse West Coast LLC, not the Old World Coffee or Old World Coffee Roasters customer name.',
            'Extract every product/service row in the invoice line-item table. Do not omit rows just because there is no catalog match.',
            'For items, return item_name, vendor_sku, item_code, vendor_item_number, product_code, pack_size, quantity, unit_cost, unit_of_measure, total_cost, item_id, matched, and is_fee.',
            'Set is_fee to true for non-product charge lines such as fuel charges, freight, delivery fees, truck charges, shipping, surcharges, service fees, handling, and bottle deposits. Fee lines must have item_id null and still appear in items.',
            'Put any printed item/catalog/product/SKU/supplier code into vendor_sku when possible, even if the invoice labels it item code, product code, catalog number, or vendor item number.',
            'pack_size must be the exact printed pack-size line when present, such as "12/32 OZ CS" or "160/2 OZ CS"; do not rewrite or summarize it.',
            'A pack size like "160/2 OZ CS" means 160 individual pieces per case, each piece is 2 oz. Do not treat that as 160 oz or 2 cases.',
            'A pack size like "12/32 OZ CS" means 12 inner units per case, each inner unit is 32 oz.',
            'Match by existing purchase option product_code/vendor SKU/item code first.',
            'If no purchase option matches, match by inventory item name or close product-name overlap and still return that item_id.',
            'For example, vendor text like OAT MILK BARISTA BLEND should match an Oat Milk inventory item; COOKIE DOUGH CHOC CHIP COOKIE should match a Chocolate Chip Cookie item when present.',
            'Use shipped quantity when both ordered and shipped quantities are visible.',
            'Use the invoice UOM column for unit_of_measure, for example CS, EA, LB, OZ, or GAL.',
            'Only use item_id values from the provided catalog. Use null when no confident catalog match exists.',
            'Read invoice numbers, dates, line totals, subtotal, fees, tax, and final total exactly as printed.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                'Compact catalog hints for matching. The app will do final matching after extraction:',
                JSON.stringify(promptCatalogItems),
                '',
                'Known vendors for this company:',
                JSON.stringify(activeVendorNames),
                '',
                'Extract the invoice from the image. Return all rows in the line-item table and all visible totals.',
                'If a catalog item is not in the compact hints, return null for item_id and still extract the line item name and codes exactly.',
                'Use known vendors as supplier matches. If the invoice supplier matches a known vendor, return the exact known vendor name as vendor_name.',
                'If the printed invoice supplier is not in that list, still return the printed supplier.',
                'If Old World Coffee or Old World Coffee Roasters appears under bill-to, sold-to, ship-to, customer, or delivery fields, do not use it as vendor_name.',
                'If the invoice has fees like fuel, freight, bottle deposit, or surcharge, include them in total_amount and as line items with is_fee true.',
              ].join('\n'),
            },
            invoiceContentPart,
          ],
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw httpError(response.status, payload.error?.message || 'Invoice image extraction failed.');
  }

  const content = payload.choices?.[0]?.message?.content;
  const parsed = parseJsonObject(content, 'Invoice extraction returned unreadable data.');
  const items = normalizeExtractedItems(parsed.items, activeCatalogItems);
  const vendorName = resolveInvoiceVendorName(parsed, vendors, items);

  return {
    vendor_name: vendorName,
    invoice_number: String(parsed.invoice_number || '').trim(),
    invoice_date: normalizeDate(parsed.invoice_date),
    subtotal_amount: toNumber(parsed.subtotal_amount, 0),
    tax_amount: toNumber(parsed.tax_amount, 0),
    freight_amount: toNumber(parsed.freight_amount ?? parsed.fuel_amount ?? parsed.delivery_fee, 0),
    total_amount: toNumber(parsed.total_amount ?? parsed.invoice_total ?? parsed.amount_due, 0),
    items,
    warning: items.length === 0 ? 'AI did not find any line items. Add lines manually or try a clearer photo.' : '',
  };
}

async function scrapeProductImage(body) {
  if (!body.productUrl) return { image_url: null, price: null };
  try {
    const response = await fetch(body.productUrl, { headers: { 'User-Agent': 'TaskrInventory/1.0' } });
    const html = await response.text();
    const image = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1]
      || html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i)?.[1]
      || null;
    const price = html.match(/\$([0-9]+(?:\.[0-9]{2})?)/)?.[1] || null;
    return { image_url: image, price: price ? Number(price) : null };
  } catch {
    return { image_url: null, price: null };
  }
}

export const DEFAULT_SNAPSHOT_TIMEZONE = 'UTC';
// Local hours 0-5 count as "just after end of day": the hourly cron snapshots
// yesterday during this window, so a missed midnight run self-heals.
export const SNAPSHOT_CATCHUP_WINDOW_HOURS = 6;

export function zonedDateParts(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value;
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      hour: Number(get('hour')) % 24,
    };
  } catch {
    return null;
  }
}

export function previousLocalDate(localDate) {
  const [year, month, day] = localDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function snapshotCompanyLocations(client, companyId, { onlyDuringCatchupWindow = false, now = new Date() } = {}) {
  const [locations, settings, items] = await Promise.all([
    fetchCompanyRows(client, 'locations', companyId),
    fetchCompanyRows(client, 'inventory_location_settings', companyId),
    fetchCompanyRows(client, 'inventory_items', companyId),
  ]);

  const activeItems = items.filter((row) => row.is_active !== false);
  let created = 0;

  for (const location of locations.filter((row) => row.is_active !== false)) {
    const zone = location.timezone || DEFAULT_SNAPSHOT_TIMEZONE;
    const local = zonedDateParts(now, zone) || zonedDateParts(now, DEFAULT_SNAPSHOT_TIMEZONE);
    if (onlyDuringCatchupWindow && local.hour >= SNAPSHOT_CATCHUP_WINDOW_HOURS) continue;
    const date = previousLocalDate(local.date);

    const { data: existingRows, error: existingError } = await client
      .from('inventory_snapshots')
      .select('item_id')
      .eq('snapshot_date', date)
      .eq('location_id', location.id);
    if (existingError) throw existingError;
    const existing = new Set((existingRows || []).map((row) => row.item_id));

    // Day-end (and day-start) quantities come from the movements ledger as of
    // the snapshot date, so backdated activity is reflected correctly. Items
    // with no ledger movements default to 0.
    const { data: qtyRows, error: qtyError } = await client.rpc('inventory_ledger_quantities', {
      p_company_id: companyId,
      p_location_id: location.id,
      p_date: date,
    });
    if (qtyError) throw qtyError;
    const qtyByItem = new Map(
      (qtyRows || []).map((row) => [row.item_id, {
        end: Number(row.day_end_qty || 0),
        start: Number(row.day_start_qty || 0),
      }])
    );

    const rows = activeItems
      .filter((item) => !existing.has(item.id))
      .map((item) => {
        const qty = qtyByItem.get(item.id) || { end: 0, start: 0 };
        const unitCost = inventorySnapshotUnitCost(item, location, settings);
        return {
          company_id: companyId,
          snapshot_date: date,
          location_id: location.id,
          item_id: item.id,
          quantity_on_hand: qty.end,
          unit_cost: unitCost,
          day_start_quantity: qty.start,
          day_end_quantity: qty.end,
          day_start_value: qty.start * unitCost,
          day_end_value: qty.end * unitCost,
        };
      });

    if (rows.length) {
      const { error: insertError } = await client.from('inventory_snapshots').insert(rows);
      if (insertError) throw insertError;
      created += rows.length;
    }
  }

  return created;
}

async function createDailySnapshot(client, user) {
  const created = await snapshotCompanyLocations(client, user.company_id);
  return { success: true, created };
}

export async function runDailySnapshots(client) {
  const { data: companies, error } = await client
    .from('companies')
    .select('id, enabled_features')
    .eq('is_active', true);
  if (error) throw error;

  const results = {};
  for (const company of companies || []) {
    const features = Array.isArray(company.enabled_features) ? company.enabled_features : [];
    if (!features.includes('inventory')) continue;
    try {
      results[company.id] = await snapshotCompanyLocations(client, company.id, {
        onlyDuringCatchupWindow: true,
      });
    } catch (companyError) {
      results[company.id] = `error: ${companyError.message}`;
    }
  }
  return { success: true, results };
}

async function manageProductGroups(client, user, body) {
  const companyId = user.company_id;
  const { action, groupId, name, description, itemIds, sortOrder } = body;

  if (action === 'create') {
    if (!name) throw httpError(400, 'Group name is required');
    const group = await createRecord(client, 'inventory_product_groups', {
      company_id: companyId,
      name,
      description: description || '',
      sort_order: sortOrder || 0,
      is_active: true,
    });
    return { success: true, group };
  }

  if (action === 'update') {
    if (!groupId) throw httpError(400, 'Group ID is required');
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description;
    if (sortOrder !== undefined) patch.sort_order = sortOrder;
    const group = await updateRecord(client, 'inventory_product_groups', groupId, companyId, patch);
    return { success: true, group };
  }

  if (action === 'delete') {
    if (!groupId) throw httpError(400, 'Group ID is required');
    const { error: ungroupError } = await client
      .from('inventory_items')
      .update({ product_group_id: null })
      .eq('company_id', companyId)
      .eq('product_group_id', groupId);
    if (ungroupError) throw ungroupError;
    await deleteRecord(client, 'inventory_product_groups', groupId, companyId);
    return { success: true };
  }

  if (action === 'add_items') {
    if (!groupId || !Array.isArray(itemIds)) throw httpError(400, 'Group ID and item IDs are required');
    const { error } = await client
      .from('inventory_items')
      .update({ product_group_id: groupId })
      .eq('company_id', companyId)
      .in('id', itemIds);
    if (error) throw error;
    return { success: true };
  }

  if (action === 'remove_items') {
    if (!Array.isArray(itemIds)) throw httpError(400, 'Item IDs are required');
    const { error } = await client
      .from('inventory_items')
      .update({ product_group_id: null })
      .eq('company_id', companyId)
      .in('id', itemIds);
    if (error) throw error;
    return { success: true };
  }

  throw httpError(400, 'Invalid product group action');
}

async function submitInventoryCount(client, user, body) {
  const companyId = user.company_id;
  const { countId, locationId, itemQtyMap, locInvMap = {} } = body;
  if (!countId || !locationId || !itemQtyMap) {
    throw httpError(400, 'Missing required count submission fields');
  }

  // Effective count date. A count asserts "actual on-hand = X as of this date".
  // Clamp to today (no future counts); a past date backdates the reconciliation.
  const today = nowIso().slice(0, 10);
  const countDate = (typeof body.countDate === 'string' && body.countDate && body.countDate <= today)
    ? body.countDate
    : today;
  const isBackdated = countDate < today;

  // Current on-hand + item cost so each counted item records a count_reconcile
  // movement in the ledger.
  const [stockResult, itemResult] = await Promise.all([
    client
      .from('inventory_location_stock')
      .select('item_id, on_hand_quantity')
      .eq('company_id', companyId)
      .eq('location_id', locationId),
    client
      .from('inventory_items')
      .select('id, unit_cost')
      .eq('company_id', companyId),
  ]);
  if (stockResult.error) throw stockResult.error;
  if (itemResult.error) throw itemResult.error;
  const prevQtyByItem = new Map((stockResult.data || []).map((row) => [row.item_id, toNumber(row.on_hand_quantity, 0)]));
  const costByItem = new Map((itemResult.data || []).map((row) => [row.id, toNumber(row.unit_cost, 0)]));

  // For a backdated count, the reconcile delta is measured against the ledger
  // quantity AS OF the count date (not current on-hand), so movements recorded
  // after that date aren't double-counted. The same delta then adjusts the
  // current on-hand cache (preserving post-count activity).
  const asOfByItem = new Map();
  if (isBackdated) {
    const { data: moves, error: movesError } = await client
      .from('inventory_movements')
      .select('item_id, quantity_delta')
      .eq('company_id', companyId)
      .eq('location_id', locationId)
      .lte('movement_date', countDate);
    if (movesError) throw movesError;
    for (const m of moves || []) {
      asOfByItem.set(m.item_id, (asOfByItem.get(m.item_id) || 0) + toNumber(m.quantity_delta, 0));
    }
  }

  let created = 0;
  let updated = 0;
  const movements = [];
  const affectedItemIds = [];
  for (const [itemId, totalQty] of Object.entries(itemQtyMap)) {
    const existingId = locInvMap[itemId];
    const quantity = Number(totalQty || 0);
    const currentOnHand = prevQtyByItem.get(itemId) || 0;
    // Backdated: delta vs ledger-as-of-date; on-hand shifts by that delta.
    // Today: delta vs current on-hand; on-hand becomes the counted value.
    const delta = isBackdated ? quantity - (asOfByItem.get(itemId) || 0) : quantity - currentOnHand;
    const newOnHand = isBackdated ? currentOnHand + delta : quantity;
    if (existingId) {
      await updateRecord(client, 'inventory_location_stock', existingId, companyId, {
        on_hand_quantity: newOnHand,
      });
      updated += 1;
    } else {
      await createRecord(client, 'inventory_location_stock', {
        company_id: companyId,
        location_id: locationId,
        item_id: itemId,
        on_hand_quantity: newOnHand,
        par_level: 0,
        reorder_point: 0,
      });
      created += 1;
    }
    affectedItemIds.push(itemId);
    if (delta !== 0) {
      movements.push({
        company_id: companyId,
        location_id: locationId,
        item_id: itemId,
        movement_date: countDate,
        quantity_delta: delta,
        unit_cost: costByItem.get(itemId) || 0,
        source_type: 'count_reconcile',
        source_id: countId,
        created_by: user.id || null,
        notes: 'Inventory count reconciliation',
      });
    }
  }

  if (movements.length) {
    const { error: movementError } = await client.from('inventory_movements').insert(movements);
    if (movementError) throw movementError;
  }

  // Backdated count: recompute historical snapshots from the count date forward.
  if (isBackdated && affectedItemIds.length) {
    const { error: recalcError } = await client.rpc('recalculate_inventory_snapshots', {
      p_company_id: companyId,
      p_location_id: locationId,
      p_from_date: countDate,
      p_item_ids: affectedItemIds,
      p_reason: 'backdated_count',
      p_changed_by: user.id || null,
    });
    if (recalcError) throw recalcError;
  }

  await updateRecord(client, 'inventory_counts', countId, companyId, {
    status: 'submitted',
    submitted_at: nowIso(),
    submitted_by: user.email,
    count_date: countDate,
  });

  return { success: true, updated, created };
}

async function validateVendorToken(client, body) {
  const { orderId } = verifyVendorOrderToken(body.token);
  const { data: order, error } = await client
    .from('inventory_orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (!order) throw httpError(404, 'Order not found');

  if (order.status === 'sent') {
    const viewedAt = nowIso();
    const { data: updated, error: updateError } = await client
      .from('inventory_orders')
      .update({ status: 'viewed', viewed_at: viewedAt, email_read_at: viewedAt })
      .eq('id', order.id)
      .select('*')
      .single();
    if (updateError) throw updateError;
    Object.assign(order, updated);
  }

  const [{ data: location, error: locationError }, { data: brandRows, error: brandError }, { data: company, error: companyError }] = await Promise.all([
    client.from('locations').select('*').eq('id', order.location_id).maybeSingle(),
    client.from('brand_settings').select('*').eq('company_id', order.company_id).limit(1),
    client.from('companies').select('*').eq('id', order.company_id).maybeSingle(),
  ]);
  if (locationError) throw locationError;
  if (brandError) throw brandError;
  if (companyError) throw companyError;

  return {
    success: true,
    order,
    location: location || null,
    settings: {
      company_name: brandRows?.[0]?.business_name || company?.name || '',
      logo_url: brandRows?.[0]?.logo_url || '',
    },
  };
}

export async function handleInventoryFunction(name, req, client, user, body) {
  name = normalizeInventoryFunction(name);
  await requireInventoryAccess(client, user);
  const companyId = user.company_id;

  switch (name) {
    case 'inventoryDownloadCatalogTemplate':
      return [
        'Item Name,SKU,Category,Unit of Measure,Unit Cost,Is Commissary Item,Commissary Price,Description,Vendor Name,Vendor Email,Product Name,Product Code,Pack Size,Inner Pack Units,Inner Pack Name,Packs Per Case,AI Suggested Par,Minimum Reorder Volume,Is Active',
        '"Sample Item","SKU001","Produce","EA",2.50,No,,"Fresh produce item","Example Vendor","vendor@example.com","Product ABC","ABC123","6x10oz",6,"Pack",10,100,50,Yes',
        '"Another Item","SKU002","Dairy","EA",5.75,No,,"Dairy product","Dairy Supplier","dairy@example.com","Milk Carton","MILK001","12 pack",12,"Carton",1,50,25,Yes',
      ].join('\n');

    case 'inventoryExtractInvoiceImage':
      return extractInvoiceImage(client, user, body);

    case 'inventoryImportCatalog':
      return importCatalog(client, user, body.file_url);

    case 'inventoryImportCatalogCsv':
      return importCatalogCsv(client, user, body.csv_text);

    case 'inventoryExportCatalog':
      return exportCatalog(body.format, body.items || []);

    case 'inventoryExportCatalogPDF':
      return exportCatalog('pdf', body.items || []);

    case 'inventoryManageProductGroups':
      return manageProductGroups(client, user, body);

    case 'inventorySubmitInventoryCount':
      return submitInventoryCount(client, user, body);

    case 'inventoryMergeDuplicateItems': {
      const { item1_id, item2_id, keep_id } = body;
      const item1 = await getRecord(client, 'inventory_items', item1_id, companyId);
      const item2 = await getRecord(client, 'inventory_items', item2_id, companyId);
      if (!item1 || !item2) throw httpError(400, 'Both items must exist');
      const keep = keep_id === item1.id ? item1 : item2;
      const remove = keep_id === item1.id ? item2 : item1;
      await updateRecord(client, 'inventory_items', keep.id, companyId, {
        purchase_options: [...(keep.purchase_options || []), ...(remove.purchase_options || [])],
      });
      await deleteRecord(client, 'inventory_items', remove.id, companyId);
      return { success: true, kept_name: keep.name, removed_name: remove.name };
    }

    case 'inventorySendVendorOrderEmail': {
      const sentAt = nowIso();
      const email = await sendEmail(client, companyId, withVendorOrderLink(req, body));
      if (body.orderId) {
        await updateRecord(client, 'inventory_orders', body.orderId, companyId, {
          status: 'sent',
          sent_at: sentAt,
          email_sent_at: sentAt,
          sent_to_email: body.toEmail || null,
          email_status: email.status,
          email_log_id: email.id,
        });
      }
      return { success: true, email };
    }

    case 'inventoryCancelVendorOrderEmail': {
      const email = await sendEmail(client, companyId, body);
      if (body.orderId) {
        await updateRecord(client, 'inventory_orders', body.orderId, companyId, {
          status: 'cancelled',
          cancelled_at: nowIso(),
          cancellation_email_status: email.status,
          cancellation_email_log_id: email.id,
        });
      }
      return { success: true, email };
    }

    case 'inventoryReviewOrderBeforeSend':
      return reviewOrderBeforeSend(client, companyId, body);

    case 'inventoryReviewCatalog':
      return reviewCatalog(client, companyId);

    case 'inventoryAiPrepareCatalogImport':
      return aiPrepareCatalogImport(client, user, body);

    case 'inventoryAiCommitCatalogImport':
      return aiCommitCatalogImport(client, user, body);

    case 'inventoryCalculateSmartParsAfterCount':
      return calculateSmartParsAfterCount(client, companyId, body);

    case 'inventoryFulfillCommissaryOrder':
      return fulfillCommissaryOrder(client, user, body);

    case 'inventoryScrapeProductImage':
      return scrapeProductImage(body);

    case 'inventoryCreateDailySnapshot':
      return createDailySnapshot(client, user);

    case 'inventoryValidateVendorToken':
      return validateVendorToken(client, body);

    default:
      throw httpError(404, `Unknown inventory function: ${name}`);
  }
}

export async function handlePublicInventoryFunction(name, client, body) {
  name = normalizeInventoryFunction(name);
  switch (name) {
    case 'inventoryValidateVendorToken':
      return validateVendorToken(client, body);
    default:
      throw httpError(404, `Unknown public inventory function: ${name}`);
  }
}
