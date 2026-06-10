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

function parseJsonObject(text) {
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
    throw httpError(502, 'Invoice extraction returned unreadable data.');
  }
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

function meaningfulWords(value) {
  const stop = new Set(['the', 'and', 'with', 'blend', 'barista', 'califia', 'case', 'cs', 'pl', 'plt', 'milk']);
  return normalizeMatchText(value).split(' ').filter((word) => word.length > 1 && !stop.has(word));
}

function candidateInvoiceCodes(extracted) {
  return [
    extracted.vendor_sku,
    extracted.vendor_item_number,
    extracted.item_number,
    extracted.product_code,
    extracted.sku,
  ].map(normalizeMatchText).filter(Boolean);
}

function optionCodes(option = {}) {
  return [
    option.product_code,
    option.vendor_sku,
    option.sku,
  ].map(normalizeMatchText).filter(Boolean);
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
        return { item, score: 100, reason: 'purchase_option_code' };
      }
      if (codes.length > 0) continue;

      if (invoiceName) {
        for (const optionName of optionNames(option)) {
          if (!optionName) continue;
          if (optionName === invoiceName) return { item, score: 96, reason: 'purchase_option_name' };
          if (invoiceName.includes(optionName) || optionName.includes(invoiceName)) {
            const sharedLength = Math.min(invoiceName.length, optionName.length);
            if (sharedLength >= 8) return { item, score: 90, reason: 'purchase_option_name' };
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
    match_score: itemMatch.score,
  };
}

function normalizeExtractedItems(rawItems = [], catalogItems = []) {
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((item) => {
      const itemName = String(item.item_name || item.name || item.description || '').trim();
      if (!itemName) return null;

      const match = matchCatalogItem(item, catalogItems);
      const itemId = match?.item_id || null;
      const quantity = toNumber(item.quantity ?? item.qty ?? item.shipped_quantity ?? item.ordered_quantity, 0);
      const totalCost = toNumber(item.total_cost ?? item.line_total ?? item.extended_price ?? item.extended_cost ?? item.total, 0);
      const unitCost = toNumber(item.unit_cost ?? item.unit_price ?? item.price ?? item.cost, quantity > 0 && totalCost > 0 ? totalCost / quantity : 0);
      const unitOfMeasure = String(item.unit_of_measure || item.uom || '').trim();

      return {
        item_name: itemName,
        item_id: itemId,
        vendor_sku: String(item.vendor_sku || item.vendor_item_number || item.item_number || item.product_code || item.sku || '').trim(),
        pack_size: String(item.pack_size || item.pack || '').trim(),
        match_type: match?.match_type || null,
        match_score: match?.match_score || 0,
        purchase_option_matched: match?.purchase_option_matched === true,
        purchase_option_missing: match?.purchase_option_missing === true,
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

async function requireInventoryAccess(client, user) {
  if (!user?.company_id || !['admin', 'manager'].includes(user.role)) {
    throw httpError(403, 'Inventory access requires a company admin or manager.');
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

async function reviewOrderBeforeSend(client, companyId, body) {
  const [locInv, items, previousOrders] = await Promise.all([
    fetchCompanyRows(client, 'inventory_location_stock', companyId),
    fetchCompanyRows(client, 'inventory_items', companyId),
    fetchCompanyRows(client, 'inventory_orders', companyId),
  ]);
  const review = (body.order_items || []).map((orderItem) => {
    const item = items.find((row) => row.id === orderItem.item_id);
    const stock = locInv.find((row) => row.location_id === body.location_id && row.item_id === orderItem.item_id);
    const historical = previousOrders
      .filter((order) => order.location_id === body.location_id)
      .flatMap((order) => order.items || [])
      .filter((row) => row.item_id === orderItem.item_id)
      .map((row) => Number(row.quantity_ordered || 0))
      .filter((quantity) => quantity > 0);
    const avg = historical.length ? historical.reduce((sum, quantity) => sum + quantity, 0) / historical.length : 0;
    const orderQuantity = Number(orderItem.quantity_ordered || 0);
    const aiPar = Number(item?.ai_suggested_par || stock?.par_level || 0);
    const highComparedToHistory = avg > 0 && orderQuantity > avg * 1.75;
    const abovePar = aiPar > 0 && (Number(stock?.on_hand_quantity || 0) + orderQuantity) > aiPar * 1.5;
    const status = highComparedToHistory || abovePar ? 'warning' : avg === 0 ? 'question' : 'ok';
    return {
      item_name: orderItem.item_name,
      order_quantity: orderQuantity,
      on_hand: Number(stock?.on_hand_quantity || 0),
      ai_par: aiPar,
      avg_historical_order: avg,
      status,
      message: status === 'ok' ? 'Order quantity looks reasonable.' : status === 'question' ? 'No order history yet for this item.' : 'This quantity is higher than recent patterns or current par levels.',
      recommendation: status === 'warning' ? 'Double-check the quantity before sending.' : '',
    };
  });
  return { success: true, review };
}

async function calculateSmartParsAfterCount(client, companyId, body) {
  const locationId = body.location_id;
  const [items, orders] = await Promise.all([
    fetchCompanyRows(client, 'inventory_items', companyId),
    fetchCompanyRows(client, 'inventory_orders', companyId),
  ]);
  const activeItems = items.filter((item) => item.is_active !== false);
  const locationOrders = orders.filter((order) => order.location_id === locationId);
  const results = [];

  for (const item of activeItems) {
    const quantities = locationOrders
      .flatMap((order) => order.items || [])
      .filter((row) => row.item_id === item.id)
      .map((row) => Number(row.quantity_ordered || 0))
      .filter((quantity) => quantity > 0);
    if (!quantities.length) {
      results.push({ item_name: item.name, status: 'no_history' });
      continue;
    }
    const avg = quantities.reduce((sum, quantity) => sum + quantity, 0) / quantities.length;
    const suggested = Math.ceil(avg * 1.25);
    const minimum = Math.max(1, Math.floor(suggested * 0.35));
    await updateRecord(client, 'inventory_items', item.id, companyId, {
      ai_suggested_par: suggested,
      minimum_reorder_volume: minimum,
      last_par_calculation_date: nowIso(),
    });
    results.push({ item_name: item.name, status: 'updated', suggested_par: suggested, minimum_reorder_volume: minimum });
  }

  return {
    success: true,
    items_processed: activeItems.length,
    items_updated: results.filter((row) => row.status === 'updated').length,
    results,
  };
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
      purchase_options: (item.purchase_options || []).slice(0, 4).map((option) => ({
        vendor_name: option.vendor_name || '',
        product_name: option.product_name || '',
        product_code: option.product_code || option.vendor_sku || '',
        unit_of_measure: option.unit_of_measure || '',
      })),
    }))
    .slice(0, 600);
  const activeVendorNames = vendors
    .filter((vendor) => vendor.is_active !== false)
    .map((vendor) => String(vendor.name || '').trim())
    .filter(Boolean)
    .slice(0, 200);

  const model = process.env.OPENAI_INVOICE_MODEL || process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
  const imageUrl = await imageUrlToDataUrl(fileUrl, client);
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
            'Return JSON only with vendor_name, invoice_number, invoice_date, subtotal_amount, tax_amount, freight_amount, total_amount, and items.',
            'vendor_name means the company issuing the invoice: the supplier/seller/remit-to company, usually shown in the logo/header, "from", "remit to", "mail payments to", or seller area.',
            'Never use bill-to, sold-to, ship-to, customer, customer number, customer PO, delivery address, or buyer account names as vendor_name.',
            'If an invoice has both a supplier header and sold-to/bill-to/customer block, choose the supplier header/remit-to company.',
            'For Chefs Warehouse / Greenleaf invoices, vendor_name should be Chefs Warehouse or The Chefs Warehouse West Coast LLC, not the Old World Coffee customer name.',
            'Extract every product/service row in the invoice line-item table. Do not omit rows just because there is no catalog match.',
            'For items, return item_name, vendor_sku, pack_size, quantity, unit_cost, unit_of_measure, total_cost, item_id, and matched.',
            'pack_size must be the exact printed pack-size line when present, such as "12/32 OZ CS" or "160/2 OZ CS"; do not rewrite or summarize it.',
            'A pack size like "160/2 OZ CS" means 160 individual pieces per case, each piece is 2 oz. Do not treat that as 160 oz or 2 cases.',
            'A pack size like "12/32 OZ CS" means 12 inner units per case, each inner unit is 32 oz.',
            'Match by existing purchase option product_code/vendor SKU first.',
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
                'Catalog items for matching:',
                JSON.stringify(activeCatalogItems),
                '',
                'Known vendors for this company:',
                JSON.stringify(activeVendorNames),
                '',
                'Extract the invoice from the image. Return all rows in the line-item table and all visible totals.',
                'Use the known vendors only as hints. If the printed invoice supplier is not in that list, still return the printed supplier.',
                'If the invoice has fees like fuel, freight, bottle deposit, or surcharge, include them in total_amount but not as product line items.',
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
    throw httpError(response.status, payload.error?.message || 'Invoice image extraction failed.');
  }

  const content = payload.choices?.[0]?.message?.content;
  const parsed = parseJsonObject(content);
  const items = normalizeExtractedItems(parsed.items, activeCatalogItems);

  return {
    vendor_name: String(parsed.vendor_name || '').trim(),
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

async function createDailySnapshot(client, user) {
  const companyId = user.company_id;
  const snapshotDay = new Date();
  snapshotDay.setDate(snapshotDay.getDate() - 1);
  const date = snapshotDay.toISOString().slice(0, 10);
  const [locations, settings, items, stock] = await Promise.all([
    fetchCompanyRows(client, 'locations', companyId),
    fetchCompanyRows(client, 'inventory_location_settings', companyId),
    fetchCompanyRows(client, 'inventory_items', companyId),
    fetchCompanyRows(client, 'inventory_location_stock', companyId),
  ]);
  let created = 0;
  for (const location of locations.filter((row) => row.is_active !== false)) {
    for (const item of items.filter((row) => row.is_active !== false)) {
      const existing = await client
        .from('inventory_snapshots')
        .select('id')
        .eq('snapshot_date', date)
        .eq('location_id', location.id)
        .eq('item_id', item.id)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) continue;
      const stockRow = stock.find((row) => row.location_id === location.id && row.item_id === item.id);
      const unitCost = inventorySnapshotUnitCost(item, location, settings);
      await createRecord(client, 'inventory_snapshots', {
        company_id: companyId,
        snapshot_date: date,
        location_id: location.id,
        item_id: item.id,
        quantity_on_hand: Number(stockRow?.on_hand_quantity || 0),
        unit_cost: unitCost,
      });
      created += 1;
    }
  }
  return { success: true, created };
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

  let created = 0;
  let updated = 0;
  for (const [itemId, totalQty] of Object.entries(itemQtyMap)) {
    const existingId = locInvMap[itemId];
    const quantity = Number(totalQty || 0);
    if (existingId) {
      await updateRecord(client, 'inventory_location_stock', existingId, companyId, {
        on_hand_quantity: quantity,
      });
      updated += 1;
    } else {
      await createRecord(client, 'inventory_location_stock', {
        company_id: companyId,
        location_id: locationId,
        item_id: itemId,
        on_hand_quantity: quantity,
        par_level: 0,
        reorder_point: 0,
      });
      created += 1;
    }
  }

  await updateRecord(client, 'inventory_counts', countId, companyId, {
    status: 'submitted',
    submitted_at: nowIso(),
    submitted_by: user.email,
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
