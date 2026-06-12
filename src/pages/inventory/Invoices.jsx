import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Camera, Upload, CheckCircle, XCircle, Eye, AlertTriangle, Plus, Trash2, Loader2, Layers, RefreshCw, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import PageHeader from '@/components/layout/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import InventoryItemSearch from '@/components/inventory/InventoryItemSearch';
import CreatePoolDialog from '@/components/inventory/CreatePoolDialog';
import { activePoolsForItem, allocateDrawdowns, lineBaseQuantity } from '@/lib/prepaidPools';
import { mergeInventoryCategories } from '@/lib/inventoryCategories';
import { recordMovement, recalculateSnapshots } from '@/lib/inventoryLedger';
import { matchInvoiceToOrder } from '@/lib/invoiceMatching';
import { format } from 'date-fns';
import { toast } from 'sonner';

const UOM_OPTIONS = ['EA', 'fl-oz', 'ml', 'L', 'Pt', 'Qt', 'gal', 'oz', 'lb', 'g', 'kg'];
const INVOICE_EXTRACTION_TIMEOUT_MS = 90 * 1000;
const PROCESSING_STALE_MS = 2 * 60 * 1000;
const INVOICE_WARNING_STORAGE_KEY = 'taskr.invoiceExtractionWarnings';

const EMPTY_QUICK_ADD = { name: '', category: '', unit_of_measure: 'EA', unit_cost: '' };
const EMPTY_PURCHASE_OPTION = {
  vendor_id: '',
  vendor_name: '',
  product_name: '',
  product_code: '',
  unit_cost: '',
  unit_of_measure: '',
  inner_pack_uom: '',
  inner_pack_units: '',
  inner_pack_name: '',
  packs_per_case: '',
  is_preferred: false,
  notes: '',
  location_ids: null,
};

function dateInputValue(value) {
  if (!value) return '';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function invoiceAgeMs(invoice) {
  const date = new Date(invoice.updated_date || invoice.created_date || Date.now());
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : Date.now() - time;
}

function isProcessingStale(invoice) {
  return invoice.status === 'processing' && invoiceAgeMs(invoice) > PROCESSING_STALE_MS;
}

function processingAgeLabel(invoice) {
  const minutes = Math.max(1, Math.floor(invoiceAgeMs(invoice) / 60000));
  return `${minutes} min`;
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function readStoredInvoiceWarnings() {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(INVOICE_WARNING_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredInvoiceWarnings(warnings) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(INVOICE_WARNING_STORAGE_KEY, JSON.stringify(warnings));
}

function errorMessage(error, fallback) {
  return String(error?.message || error || fallback || '').trim().slice(0, 1200);
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

function lineCodeValues(row = {}) {
  return [
    row.vendor_sku,
    row.vendor_item_number,
    row.vendor_item_no,
    row.item_number,
    row.item_no,
    row.item_num,
    row.item_code,
    row.product_code,
    row.product_number,
    row.product_no,
    row.supplier_item_number,
    row.supplier_item_no,
    row.supplier_sku,
    row.vendor_code,
    row.catalog_number,
    row.catalog_no,
    row.code,
    row.sku,
    row.upc,
  ].map((value) => String(value || '').trim()).filter(Boolean);
}

function optionCodeValues(option = {}) {
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
  ].map((value) => String(value || '').trim()).filter(Boolean);
}

function firstLineCode(row = {}) {
  return lineCodeValues(row)[0] || '';
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

function findVendorByName(vendors = [], candidate) {
  const candidateText = String(candidate || '').trim();
  if (!candidateText) return null;

  let best = null;
  for (const vendor of vendors) {
    if (vendor.is_active === false) continue;
    for (const name of vendorNameValues(vendor)) {
      const score = vendorMatchScore(candidateText, name);
      if (score > (best?.score || 0)) {
        best = { vendor, score };
      }
    }
  }

  return best?.score >= 82 ? best.vendor : null;
}

function purchaseOptionMatchesLine(option = {}, row = {}) {
  const rowCodes = lineCodeValues(row).map(normalizeCode).filter(Boolean);
  const optionCodes = optionCodeValues(option).map(normalizeCode).filter(Boolean);
  if (rowCodes.length && optionCodes.length && optionCodes.some((code) => rowCodes.includes(code))) return true;
  if (rowCodes.length) return false;

  const rowName = normalizeMatchText(row.item_name);
  const optionName = normalizeMatchText(option.product_name || option.name);
  if (!rowName || !optionName) return false;
  return rowName === optionName || rowName.includes(optionName) || optionName.includes(rowName);
}

function shouldSuggestPurchaseOption(row, item) {
  if (!row?.item_id || !item) return false;
  if (row.is_pool_draw) return false;
  if (row.purchase_option_added) return false;
  if ((item.purchase_options || []).some((option) => purchaseOptionMatchesLine(option, row))) return false;
  return Boolean(firstLineCode(row) || row.item_name);
}

// Mirrors the backend fee detection: fee lines stay on the invoice for the
// record but are never matched, received as stock, or used in costing.
const FEE_LINE_PATTERN = /\b(fuel|freight|shipping|surcharge|handling)\b|\b(delivery|service|truck|energy|environmental)\s*(charge|fee)s?\b|\bbottle\s*deposit\b/i;

function autoDetectFeeLine(row) {
  if (row.fee_user_set) return Boolean(row.is_fee);
  return row.is_fee === true || FEE_LINE_PATTERN.test(String(row.item_name || ''));
}

function normalizeInvoiceUom(value) {
  const text = String(value || '').trim();
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (['cs', 'case', 'cases'].includes(normalized)) return 'Case';
  if (['ea', 'each', 'pc', 'piece', 'pieces'].includes(normalized)) return 'EA';
  if (['floz', 'fluidounce', 'fluidounces'].includes(normalized)) return 'fl-oz';
  if (['oz', 'ounce', 'ounces'].includes(normalized)) return 'oz';
  if (['gal', 'gallon', 'gallons'].includes(normalized)) return 'gal';
  if (['lb', 'lbs', 'pound', 'pounds'].includes(normalized)) return 'lb';
  return text;
}

function singularize(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.endsWith('ies') ? `${text.slice(0, -3)}y` : text.endsWith('s') ? text.slice(0, -1) : text;
}

function inferInnerPackName(row = {}, item = {}) {
  const text = normalizeMatchText(`${row.item_name || ''} ${item.name || ''}`);
  if (text.includes('cookie')) return 'Cookie';
  if (text.includes('cup')) return 'Cup';
  if (text.includes('lid')) return 'Lid';
  if (text.includes('bottle') || text.includes('sauce') || text.includes('syrup') || text.includes('milk') || text.includes('chai')) return 'Bottle';
  if (text.includes('bag')) return 'Bag';
  if (text.includes('can')) return 'Can';
  return singularize(item.unit_of_measure || 'Unit') || 'Unit';
}

function parseInvoicePackSize(row = {}, item = {}) {
  const rawPack = String(row.pack_size || row.pack || row.case_pack || '').trim();
  const invoiceUom = normalizeInvoiceUom(row.unit_of_measure);
  const baseUom = item.unit_of_measure || '';
  const notes = [];
  if (rawPack) notes.push(`Invoice pack size: ${rawPack}`);

  const cleaned = rawPack
    .replace(/\bPLT?#?:?\s*\d+.*$/i, '')
    .replace(/\bPACK\s*SIZE\b:?/i, '')
    .trim();
  const caseMatch = cleaned.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*([a-zA-Z-]+)(?:\s*(?:CS|CASE|CASES))?/i);
  if (!caseMatch) {
    return {
      unit_of_measure: invoiceUom || 'Case',
      inner_pack_units: '',
      inner_pack_uom: '',
      inner_pack_name: rawPack || '',
      packs_per_case: '',
      notes: notes.join(' | '),
    };
  }

  const outerCount = parseFloat(caseMatch[1]);
  const innerSize = parseFloat(caseMatch[2]);
  const printedUom = normalizeInvoiceUom(caseMatch[3]);
  const baseIsEach = normalizeInvoiceUom(baseUom) === 'EA';
  const baseIsFluidOunce = normalizeInvoiceUom(baseUom) === 'fl-oz';
  const packUom = baseIsFluidOunce && printedUom === 'oz'
    ? 'fl-oz'
    : baseUom && !baseIsEach ? baseUom : printedUom;
  const packName = inferInnerPackName(row, item);

  if (baseIsEach) {
    notes.push(`${outerCount} ${packName.toLowerCase()}s per case, ${innerSize} ${printedUom || 'oz'} each`);
    return {
      unit_of_measure: invoiceUom === 'Case' ? 'Case' : invoiceUom || 'Case',
      inner_pack_units: 1,
      inner_pack_uom: 'EA',
      inner_pack_name: packName,
      packs_per_case: outerCount,
      notes: notes.join(' | '),
    };
  }

  notes.push(`${outerCount} ${packName.toLowerCase()}s per case, ${innerSize} ${packUom || printedUom} each`);
  return {
    unit_of_measure: invoiceUom === 'Case' ? 'Case' : invoiceUom || 'Case',
    inner_pack_units: innerSize,
    inner_pack_uom: packUom || printedUom,
    inner_pack_name: packName,
    packs_per_case: outerCount,
    notes: notes.join(' | '),
  };
}

function buildPurchaseOptionFromLine(row = {}, item = {}, invoice = {}, vendors = []) {
  const vendorName = String(invoice.vendor_name || '').trim();
  const matchedVendor = findVendorByName(vendors, vendorName);
  const resolvedVendorName = matchedVendor?.name || vendorName;
  const packDefaults = parseInvoicePackSize(row, item);
  const unitCost = parseFloat(row.unit_cost) || 0;

  return {
    ...EMPTY_PURCHASE_OPTION,
    vendor_id: matchedVendor?.id || '',
    vendor_name: resolvedVendorName,
    product_name: row.item_name || item.name || '',
    product_code: firstLineCode(row),
    unit_cost: unitCost ? unitCost.toString() : '',
    unit_of_measure: packDefaults.unit_of_measure || normalizeInvoiceUom(row.unit_of_measure) || item.unit_of_measure || '',
    inner_pack_uom: packDefaults.inner_pack_uom || '',
    inner_pack_units: packDefaults.inner_pack_units || '',
    inner_pack_name: packDefaults.inner_pack_name || '',
    packs_per_case: packDefaults.packs_per_case || '',
    is_preferred: !(item.purchase_options || []).length,
    notes: packDefaults.notes || 'Added from scanned invoice',
    location_ids: null,
  };
}


export default function Invoices() {
  const { canAccessLocation, companyId } = useAuth();
  const isMobile = useIsMobile();
  const routerLocation = useLocation();
  const navigate = useNavigate();
  const [pendingReceiveOrderId, setPendingReceiveOrderId] = useState(null);
  const [locations, setLocations] = useState([]);
  const [items, setItems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [inventoryCategories, setInventoryCategories] = useState([]);
  const [locInv, setLocInv] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [orders, setOrders] = useState([]);
  const [uploadDialog, setUploadDialog] = useState(false);
  const [reviewDialog, setReviewDialog] = useState(null);
  const [linkDialog, setLinkDialog] = useState(null);
  const [linkOrderId, setLinkOrderId] = useState('');
  const [linking, setLinking] = useState(false);
  const [quickAddRowIdx, setQuickAddRowIdx] = useState(null);
  const [quickAddForm, setQuickAddForm] = useState(EMPTY_QUICK_ADD);
  const [purchaseOptionDialog, setPurchaseOptionDialog] = useState(null);
  const [pools, setPools] = useState([]);
  const [poolDialog, setPoolDialog] = useState(null);
  const [selectedLoc, setSelectedLoc] = useState('');
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [savingQuickAdd, setSavingQuickAdd] = useState(false);
  const [savingPurchaseOptionIdx, setSavingPurchaseOptionIdx] = useState(null);
  const [savingReview, setSavingReview] = useState(false);
  const [retryingInvoiceId, setRetryingInvoiceId] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [invoiceWarnings, setInvoiceWarnings] = useState(readStoredInvoiceWarnings);
  const fileRef = useRef();

  const rememberInvoiceWarning = (invoiceId, message) => {
    const warning = errorMessage(message);
    if (!invoiceId || !warning) return;
    setInvoiceWarnings(prev => {
      const next = { ...prev, [invoiceId]: warning };
      writeStoredInvoiceWarnings(next);
      return next;
    });
  };

  const clearInvoiceWarning = (invoiceId) => {
    if (!invoiceId) return;
    setInvoiceWarnings(prev => {
      if (!prev[invoiceId]) return prev;
      const next = { ...prev };
      delete next[invoiceId];
      writeStoredInvoiceWarnings(next);
      return next;
    });
  };

  const invoiceWarningFor = (invoice) => invoice?.extraction_warning || invoiceWarnings[invoice?.id] || '';

  const resolveReviewVendorName = (invoice, reviewRows = []) => {
    const scores = new Map();
    const addVendorCandidate = (name) => {
      const rawName = String(name || '').trim();
      if (!rawName) return;
      const matchedVendor = findVendorByName(vendors, rawName);
      const resolvedName = matchedVendor?.name || rawName;
      const key = normalizeVendorText(resolvedName);
      if (!key) return;
      const current = scores.get(key) || { name: resolvedName, score: 0 };
      current.score += 1;
      scores.set(key, current);
    };

    for (const row of reviewRows) {
      addVendorCandidate(row.purchase_option_vendor_name);
      const item = items.find(i => i.id === row.item_id);
      if (!item) continue;
      const matchedOption = (item.purchase_options || []).find((option) => purchaseOptionMatchesLine(option, row));
      addVendorCandidate(matchedOption?.vendor_name);
    }

    const optionVendor = [...scores.values()].sort((a, b) => b.score - a.score)[0];
    if (optionVendor?.name) return optionVendor.name;

    const matchedInvoiceVendor = findVendorByName(vendors, invoice.vendor_name);
    return matchedInvoiceVendor?.name || String(invoice.vendor_name || '').trim();
  };

  const prepareReviewInvoice = (invoice) => {
    if (!invoice || !items.length) return invoice;
    const extractedItems = (invoice.extracted_items || []).map((row) => {
      const item = items.find(i => i.id === row.item_id);
      if (!item) {
        return {
          ...row,
          is_fee: autoDetectFeeLine(row),
          purchase_option_missing: false,
          purchase_option_matched: false,
        };
      }

      const matchedOption = (item.purchase_options || []).find((option) => purchaseOptionMatchesLine(option, row));
      const purchaseOptionMatched = Boolean(matchedOption);
      const autoPoolDraw = !row.pool_purchase
        && activePoolsForItem(pools, row.item_id).length > 0
        && (parseFloat(row.unit_cost) || 0) === 0;
      const nextRow = {
        ...row,
        matched: true,
        is_fee: false,
        is_pool_draw: row.pool_draw_user_set ? Boolean(row.is_pool_draw) : autoPoolDraw,
        purchase_option_vendor_id: matchedOption?.vendor_id || row.purchase_option_vendor_id || null,
        purchase_option_vendor_name: matchedOption?.vendor_name || row.purchase_option_vendor_name || '',
      };
      nextRow.purchase_option_matched = purchaseOptionMatched || row.purchase_option_added === true;
      nextRow.purchase_option_missing = shouldSuggestPurchaseOption(nextRow, item);
      return nextRow;
    });

    return {
      ...invoice,
      extraction_warning: invoiceWarningFor(invoice),
      vendor_name: resolveReviewVendorName(invoice, extractedItems),
      // Received date drives inventory math; default to the printed invoice
      // date, then today, so confirming always has a valid received date.
      received_date: invoice.received_date || invoice.invoice_date || format(new Date(), 'yyyy-MM-dd'),
      extracted_items: extractedItems,
    };
  };

  const load = () => {
    setLoading(true);
    return Promise.all([
      base44.entities.Location.list(),
      base44.entities.InventoryItem.filter({ is_active: true }),
      base44.entities.LocationInventory.list(),
      base44.entities.Invoice.list('-created_date', 50),
      base44.entities.Vendor.list(),
      companyId ? base44.entities.InventoryCategory.filter({ company_id: companyId }).catch(() => []) : Promise.resolve([]),
      base44.entities.PrepaidPool.filter({ status: 'active' }).catch(() => []),
      base44.entities.Order.list('-created_date', 200).catch(() => []),
    ]).then(([locs, itms, linv, invs, vends, cats, poolRows, orderRows]) => {
      setLocations(locs.filter(l => canAccessLocation(l.id) && l.is_inventory_enabled !== false));
      setItems(itms);
      setLocInv(linv);
      setInvoices(invs);
      setVendors(vends);
      setInventoryCategories(cats);
      setPools(poolRows);
      setOrders(orderRows);
      setLoading(false);
    }).catch((error) => {
      toast.error(error.message || 'Failed to load invoices');
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, [companyId]);

  // Arriving from an order's "Receive Order" button: pre-select the location,
  // remember the order to link, and open the scan dialog. Clear the nav state
  // so a refresh doesn't re-trigger it.
  useEffect(() => {
    const navState = routerLocation.state;
    if (navState?.receiveOrderId) {
      setPendingReceiveOrderId(navState.receiveOrderId);
      if (navState.receiveLocationId) setSelectedLoc(navState.receiveLocationId);
      setUploadError('');
      setUploadDialog(true);
      navigate(routerLocation.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerLocation.state]);

  const resetFileInput = () => {
    if (fileRef.current) fileRef.current.value = '';
  };

  const openFilePicker = (useCamera) => {
    if (!selectedLoc || !fileRef.current || uploading || extracting) return;
    setUploadError('');
    resetFileInput();
    if (useCamera) fileRef.current.setAttribute('capture', 'environment');
    else fileRef.current.removeAttribute('capture');
    fileRef.current.click();
  };

  const extractInvoiceToReview = async (invoice, fileUrl) => {
    let result = {
      vendor_name: '',
      invoice_number: '',
      invoice_date: null,
      total_amount: 0,
      items: [],
    };
    let extractionWarning = '';

    try {
      result = await withTimeout(
        base44.integrations.Core.InvokeLLM({
          prompt: `You are an expert at reading food & beverage supplier invoices. Extract the following structured data from this invoice image. For each line item, try to match the item name to items in our inventory catalog: ${items.map(i => `"${i.name}" (id: ${i.id})`).join(', ')}. Return null for item_id if no match found. Extract all line items.`,
          file_urls: [fileUrl],
          response_json_schema: {
            type: 'object',
            properties: {
              vendor_name: { type: 'string' },
              invoice_number: { type: 'string' },
              invoice_date: { type: 'string' },
              total_amount: { type: 'number' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    item_name: { type: 'string' },
                    item_id: { type: 'string' },
                    quantity: { type: 'number' },
                    unit_cost: { type: 'number' },
                    unit_of_measure: { type: 'string' },
                    total_cost: { type: 'number' },
                    matched: { type: 'boolean' },
                  }
                }
              }
            }
          }
        }),
        INVOICE_EXTRACTION_TIMEOUT_MS,
        'AI extraction timed out. You can retry or review this invoice manually.'
      );
      extractionWarning = result.warning || '';
    } catch (extractionError) {
      console.error('Invoice extraction failed:', extractionError);
      extractionWarning = errorMessage(extractionError, 'The image uploaded, but automatic parsing failed. You can add lines manually in review.');
    }

    const extractedItems = result.items || [];
    const patch = {
      vendor_name: result.vendor_name || invoice.vendor_name || '',
      invoice_number: result.invoice_number || invoice.invoice_number || '',
      invoice_date: result.invoice_date || invoice.invoice_date || null,
      status: 'pending_review',
      extracted_items: extractedItems,
      total_amount: result.total_amount || invoice.total_amount || 0,
    };

    // Auto-link to a purchase order unless one is already attached or the
    // invoice was explicitly marked as not needing an order.
    if (!invoice.order_id && invoice.match_status !== 'no_order') {
      const vendor = findVendorByName(vendors, patch.vendor_name);
      const match = matchInvoiceToOrder(
        { ...invoice, ...patch },
        orders,
        { vendorId: vendor?.id || null }
      );
      if (match) {
        patch.order_id = match.order.id;
        patch.match_status = 'auto_matched';
        patch.matched_at = new Date().toISOString();
      } else {
        patch.match_status = 'unmatched';
      }
    }

    await base44.entities.Invoice.update(invoice.id, patch);
    return {
      invoice: { ...invoice, ...patch, extraction_warning: extractionWarning },
      extractedItems,
      extractionWarning,
    };
  };

  const handleFileUpload = async (file) => {
    if (!file || !selectedLoc) return;

    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    if (!isPdf && !String(file.type || '').startsWith('image/')) {
      setUploadError('Unsupported file type. Upload an invoice image or PDF.');
      resetFileInput();
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setUploadError('File is too large (max 15 MB). Try a smaller scan or photo.');
      resetFileInput();
      return;
    }

    const locationId = selectedLoc;
    setUploadError('');
    toast.info('Invoice upload started. You can leave this page and come back.');

    let invoice = null;
    let fileUrl = '';

    try {
      setUploading(true);
      const uploaded = await base44.integrations.Core.UploadFile({ file });
      fileUrl = uploaded.file_url;
      invoice = await base44.entities.Invoice.create({
        location_id: locationId,
        file_url: fileUrl,
        image_url: fileUrl,
        status: 'processing',
        extracted_items: [],
        total_amount: 0,
        // Pre-link to the order when scanning via an order's "Receive Order" button.
        ...(pendingReceiveOrderId ? { order_id: pendingReceiveOrderId, match_status: 'manually_matched', matched_at: new Date().toISOString() } : {}),
      });
      if (pendingReceiveOrderId) setPendingReceiveOrderId(null);
      await load();
      setUploadDialog(false);
      resetFileInput();
      toast.info('AI invoice extraction is running in the background.');
    } catch (error) {
      console.error('Invoice upload failed:', error);
      const message = error.message || 'Invoice upload failed. Please try again.';
      setUploadError(message);
      toast.error(message);
      setUploading(false);
      resetFileInput();
      return;
    }

    setUploading(false);
    setExtracting(true);

    try {
      const { extractedItems, extractionWarning } = await extractInvoiceToReview(invoice, fileUrl);
      await load();
      if (extractionWarning) {
        rememberInvoiceWarning(invoice.id, extractionWarning);
        toast.warning(extractionWarning, { duration: 15000 });
      } else if (extractedItems.length === 0) {
        clearInvoiceWarning(invoice.id);
        toast.warning('Invoice is ready for review, but no line items were found.');
      } else {
        clearInvoiceWarning(invoice.id);
        toast.success('Invoice is ready for review.');
      }
    } catch (error) {
      console.error('Invoice extraction save failed:', error);
      const message = errorMessage(error, 'The invoice uploaded, but the extracted data could not be saved.');
      rememberInvoiceWarning(invoice.id, message);
      try {
        await base44.entities.Invoice.update(invoice.id, { status: 'pending_review' });
        await load();
      } catch (statusError) {
        console.error('Failed to move invoice out of processing:', statusError);
      }
      toast.error(message, { duration: 20000 });
    } finally {
      setUploading(false);
      setExtracting(false);
      resetFileInput();
    }
  };

  const updateExtractedItem = (idx, field, val) => {
    setReviewDialog(prev => {
      const its = [...prev.extracted_items];
      const numericFields = new Set(['quantity', 'unit_cost', 'total_cost']);
      its[idx] = { ...its[idx], [field]: numericFields.has(field) ? (parseFloat(val) || 0) : val };
      if (field === 'item_id' && val) {
        its[idx].is_fee = false;
      }
      if (field === 'item_name' && !its[idx].item_id) {
        its[idx].is_fee = autoDetectFeeLine(its[idx]);
      }
      if (field === 'item_id' || field === 'unit_cost') {
        const row = its[idx];
        if (!row.pool_draw_user_set && !row.pool_purchase) {
          row.is_pool_draw = Boolean(row.item_id)
            && activePoolsForItem(pools, row.item_id).length > 0
            && (parseFloat(row.unit_cost) || 0) === 0;
        }
      }
      if (field === 'item_id') {
        const item = items.find(i => i.id === val);
        its[idx].matched = Boolean(item);
        if (item) {
          its[idx].purchase_option_missing = shouldSuggestPurchaseOption(its[idx], item);
        } else {
          its[idx].purchase_option_missing = false;
          its[idx].purchase_option_matched = false;
        }
      }
      if (field === 'quantity' || field === 'unit_cost') {
        its[idx].total_cost = (its[idx].quantity || 0) * (its[idx].unit_cost || 0);
        const item = items.find(i => i.id === its[idx].item_id);
        if (item) its[idx].purchase_option_missing = shouldSuggestPurchaseOption(its[idx], item);
      }
      return { ...prev, extracted_items: its };
    });
  };

  const updateReviewField = (field, value) => {
    setReviewDialog(prev => prev ? { ...prev, [field]: value } : prev);
  };

  const invoicePatchFromReview = (status) => ({
    ...(status ? { status } : {}),
    location_id: reviewDialog.location_id || null,
    vendor_name: String(reviewDialog.vendor_name || '').trim(),
    invoice_number: String(reviewDialog.invoice_number || '').trim(),
    invoice_date: reviewDialog.invoice_date || null,
    received_date: reviewDialog.received_date || null,
    total_amount: parseFloat(reviewDialog.total_amount) || 0,
    extracted_items: reviewDialog.extracted_items || [],
  });

  const saveInvoiceReview = async () => {
    if (!reviewDialog) return;
    setSavingReview(true);
    try {
      const patch = invoicePatchFromReview();
      await base44.entities.Invoice.update(reviewDialog.id, patch);
      setReviewDialog(prev => prev ? { ...prev, ...patch } : prev);
      await load();
      toast.success('Invoice changes saved');
    } catch (error) {
      toast.error(error.message || 'Failed to save invoice changes');
    } finally {
      setSavingReview(false);
    }
  };

  const retryInvoiceExtraction = async (invoice) => {
    const fileUrl = invoice.file_url || invoice.image_url;
    if (!fileUrl) {
      toast.error('This invoice does not have an image attached. Open it manually instead.');
      return;
    }

    setRetryingInvoiceId(invoice.id);
    try {
      clearInvoiceWarning(invoice.id);
      await base44.entities.Invoice.update(invoice.id, { status: 'processing' });
      await load();
      const { invoice: reviewedInvoice, extractedItems, extractionWarning } = await extractInvoiceToReview(invoice, fileUrl);
      await load();
      setReviewDialog(prepareReviewInvoice({
        ...reviewedInvoice,
        extraction_warning: extractionWarning,
      }));
      if (extractionWarning) {
        rememberInvoiceWarning(invoice.id, extractionWarning);
        toast.warning(extractionWarning, { duration: 15000 });
      } else if (extractedItems.length === 0) {
        clearInvoiceWarning(invoice.id);
        toast.warning('Invoice is ready for review, but no line items were found.');
      } else {
        clearInvoiceWarning(invoice.id);
        toast.success('Invoice extraction finished.');
      }
    } catch (error) {
      console.error('Invoice retry failed:', error);
      const message = errorMessage(error, 'AI retry failed. You can review the invoice manually.');
      rememberInvoiceWarning(invoice.id, message);
      try {
        await base44.entities.Invoice.update(invoice.id, { status: 'pending_review' });
        await load();
      } catch (statusError) {
        console.error('Failed to unlock invoice after retry failure:', statusError);
      }
      toast.error(message, { duration: 20000 });
    } finally {
      setRetryingInvoiceId(null);
    }
  };

  const openProcessingInvoiceManually = async (invoice) => {
    const patch = {
      status: 'pending_review',
      extracted_items: invoice.extracted_items || [],
    };

    try {
      await base44.entities.Invoice.update(invoice.id, patch);
      await load();
      setReviewDialog(prepareReviewInvoice({
        ...invoice,
        ...patch,
        extraction_warning: 'AI processing did not finish. Add lines manually, correct the details, or retry extraction from the invoice list.',
      }));
    } catch (error) {
      toast.error(error.message || 'Failed to open invoice for manual review');
    }
  };

  const toggleFeeLine = (idx) => {
    setReviewDialog(prev => {
      if (!prev) return prev;
      const its = [...(prev.extracted_items || [])];
      if (!its[idx]) return prev;
      its[idx] = { ...its[idx], is_fee: !its[idx].is_fee, fee_user_set: true };
      return { ...prev, extracted_items: its };
    });
  };

  const togglePoolDraw = (idx) => {
    setReviewDialog(prev => {
      if (!prev) return prev;
      const its = [...(prev.extracted_items || [])];
      if (!its[idx]) return prev;
      its[idx] = { ...its[idx], is_pool_draw: !its[idx].is_pool_draw, pool_draw_user_set: true };
      const item = items.find(i => i.id === its[idx].item_id);
      if (item) its[idx].purchase_option_missing = shouldSuggestPurchaseOption(its[idx], item);
      return { ...prev, extracted_items: its };
    });
  };

  const openPoolDialogForLine = (idx) => {
    const row = reviewDialog?.extracted_items?.[idx];
    const item = items.find(i => i.id === row?.item_id);
    if (!row || !item) {
      toast.error('Match this line to an inventory item first.');
      return;
    }

    const matchedOption = (item.purchase_options || []).find((option) => purchaseOptionMatchesLine(option, row));
    const matchedVendor = findVendorByName(vendors, reviewDialog.vendor_name);
    setPoolDialog({
      rowIdx: idx,
      initial: {
        item_id: item.id,
        vendor_id: matchedVendor?.id || '',
        vendor_name: matchedVendor?.name || String(reviewDialog.vendor_name || '').trim(),
        source_invoice_id: reviewDialog.id,
        total_quantity: String(lineBaseQuantity(row, item, matchedOption) || ''),
        total_cost: String(row.total_cost || ((row.quantity || 0) * (row.unit_cost || 0)) || ''),
        purchased_date: dateInputValue(reviewDialog.invoice_date),
      },
    });
  };

  const handlePoolCreated = (pool, updatedItem) => {
    if (updatedItem) {
      setItems(prev => prev.map(existing => existing.id === updatedItem.id ? { ...existing, ...updatedItem } : existing));
    }
    setPools(prev => [...prev, pool]);
    const rowIdx = poolDialog?.rowIdx;
    setReviewDialog(prev => {
      if (!prev || rowIdx == null) return prev;
      const its = [...(prev.extracted_items || [])];
      if (!its[rowIdx]) return prev;
      its[rowIdx] = {
        ...its[rowIdx],
        pool_purchase: true,
        pool_id: pool.id,
        is_pool_draw: false,
        purchase_option_missing: false,
      };
      return { ...prev, extracted_items: its };
    });
  };

  const openPurchaseOptionDialog = (idx) => {
    if (!reviewDialog) return;
    const row = reviewDialog.extracted_items?.[idx];
    const item = items.find(i => i.id === row?.item_id);
    if (!row || !item) {
      toast.error('Match this line to an inventory item first.');
      return;
    }

    setPurchaseOptionDialog({
      rowIdx: idx,
      itemId: item.id,
      itemName: item.name,
      option: buildPurchaseOptionFromLine(row, item, reviewDialog, vendors),
    });
  };

  const updatePurchaseOptionDraft = (field, value) => {
    setPurchaseOptionDialog(prev => prev ? {
      ...prev,
      option: { ...prev.option, [field]: value },
    } : prev);
  };

  const handlePurchaseOptionVendorChange = (vendorId) => {
    const vendor = vendors.find(v => v.id === vendorId);
    setPurchaseOptionDialog(prev => prev ? {
      ...prev,
      option: {
        ...prev.option,
        vendor_id: vendorId,
        vendor_name: vendor?.name || prev.option.vendor_name || '',
      },
    } : prev);
  };

  const closePurchaseOptionDialog = () => {
    setPurchaseOptionDialog(null);
  };

  const savePurchaseOptionFromDialog = async () => {
    if (!purchaseOptionDialog) return;
    const { rowIdx, itemId, option } = purchaseOptionDialog;
    const item = items.find(i => i.id === itemId);
    if (!item) {
      toast.error('Could not find the matched catalog item.');
      return;
    }

    const nextOption = {
      ...option,
      vendor_name: String(option.vendor_name || '').trim(),
      product_name: String(option.product_name || '').trim(),
      product_code: String(option.product_code || '').trim(),
      unit_cost: parseFloat(option.unit_cost) || 0,
      unit_of_measure: option.unit_of_measure || item.unit_of_measure || '',
      inner_pack_units: option.inner_pack_units === '' ? '' : parseFloat(option.inner_pack_units) || '',
      packs_per_case: option.packs_per_case === '' ? '' : parseFloat(option.packs_per_case) || '',
      inner_pack_uom: option.inner_pack_uom || '',
      inner_pack_name: option.inner_pack_name || '',
      notes: option.notes || '',
    };

    setSavingPurchaseOptionIdx(rowIdx);
    try {
      const nextPurchaseOptions = [...(item.purchase_options || []), nextOption];
      const updated = await base44.entities.InventoryItem.update(item.id, {
        purchase_options: nextPurchaseOptions,
        unit_cost: item.unit_cost || nextOption.unit_cost,
        vendor_id: item.vendor_id || nextOption.vendor_id || '',
      });
      const savedItem = updated || {
        ...item,
        purchase_options: nextPurchaseOptions,
        unit_cost: item.unit_cost || nextOption.unit_cost,
        vendor_id: item.vendor_id || nextOption.vendor_id || '',
      };

      setItems(prev => prev.map(existing => existing.id === savedItem.id ? { ...existing, ...savedItem } : existing));
      setReviewDialog(prev => {
        if (!prev) return prev;
        const its = [...(prev.extracted_items || [])];
        if (!its[rowIdx]) return prev;
        its[rowIdx] = {
          ...its[rowIdx],
          purchase_option_missing: false,
          purchase_option_matched: true,
          purchase_option_added: true,
          matched: true,
        };
        return { ...prev, extracted_items: its };
      });
      toast.success('Purchase option added to catalog item');
      closePurchaseOptionDialog();
    } catch (error) {
      toast.error(error.message || 'Failed to add purchase option');
    } finally {
      setSavingPurchaseOptionIdx(null);
    }
  };

  const removeExtractedItem = (idx) => {
    setReviewDialog(prev => ({
      ...prev,
      extracted_items: (prev.extracted_items || []).filter((_, i) => i !== idx),
    }));
  };

  const addManualExtractedItem = () => {
    setReviewDialog(prev => ({
      ...prev,
      extracted_items: [
        ...(prev.extracted_items || []),
        { item_name: 'New line item', item_id: '', quantity: 1, unit_cost: 0, unit_of_measure: 'EA', total_cost: 0, matched: false },
      ],
    }));
  };

  const openQuickAdd = (idx) => {
    const row = reviewDialog?.extracted_items?.[idx] || {};
    setQuickAddForm({
      name: row.item_name || '',
      category: '',
      unit_of_measure: row.unit_of_measure || 'EA',
      unit_cost: row.unit_cost ?? '',
    });
    setQuickAddRowIdx(idx);
  };

  const closeQuickAdd = () => {
    setQuickAddRowIdx(null);
    setQuickAddForm(EMPTY_QUICK_ADD);
  };

  const createCatalogItemFromLine = async () => {
    if (quickAddRowIdx === null || !reviewDialog) return;
    const row = reviewDialog.extracted_items?.[quickAddRowIdx];
    const name = quickAddForm.name.trim();
    const unit = quickAddForm.unit_of_measure || 'EA';
    if (!row || !name) {
      toast.error('Item name is required');
      return;
    }

    setSavingQuickAdd(true);
    try {
      const vendorName = String(reviewDialog.vendor_name || '').trim();
      const matchedVendor = findVendorByName(vendors, vendorName);
      const resolvedVendorName = matchedVendor?.name || vendorName;
      const formUnitCost = parseFloat(quickAddForm.unit_cost);
      const scannedUnitCost = parseFloat(row.unit_cost);
      const unitCost = Number.isFinite(formUnitCost)
        ? formUnitCost
        : Number.isFinite(scannedUnitCost) ? scannedUnitCost : 0;
      const draftItem = { name, unit_of_measure: unit, purchase_options: [] };
      const purchaseOption = vendorName
        ? {
            ...buildPurchaseOptionFromLine(row, draftItem, reviewDialog, vendors),
            unit_cost: unitCost,
            vendor_id: matchedVendor?.id || '',
            vendor_name: resolvedVendorName,
            is_preferred: true,
          }
        : null;
      const purchaseOptions = purchaseOption ? [purchaseOption] : [];

      const created = await base44.entities.InventoryItem.create({
        name,
        category: quickAddForm.category || '',
        unit_of_measure: unit,
        unit_cost: unitCost,
        vendor_id: purchaseOption?.vendor_id || '',
        is_active: true,
        purchase_options: purchaseOptions,
        count_units: [{ label: unit, multiplier: 1 }],
      });

      setItems(prev => [...prev, created].sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      setReviewDialog(prev => {
        const its = [...(prev.extracted_items || [])];
        its[quickAddRowIdx] = {
          ...its[quickAddRowIdx],
          item_id: created.id,
          item_name: created.name,
          unit_cost: unitCost,
          unit_of_measure: unit,
          purchase_option_missing: false,
          purchase_option_matched: Boolean(purchaseOptions.length),
          purchase_option_added: Boolean(purchaseOptions.length),
          matched: true,
        };
        return { ...prev, extracted_items: its };
      });
      toast.success('Item added to catalog');
      closeQuickAdd();
    } catch (error) {
      toast.error(error.message || 'Failed to add catalog item');
    } finally {
      setSavingQuickAdd(false);
    }
  };

  const confirmInvoice = async () => {
    if (!reviewDialog.location_id) {
      toast.error('Choose a location before confirming.');
      return;
    }

    const unmatchedCount = (reviewDialog.extracted_items || []).filter(row => !row.item_id && !row.is_fee).length;
    if (unmatchedCount > 0) {
      toast.error('Match, add, or remove unmatched lines before confirming.');
      return;
    }

    setConfirming(true);
    try {
      const patch = invoicePatchFromReview('confirmed');
      await base44.entities.Invoice.update(reviewDialog.id, patch);

      // Received date drives all inventory math (snapshots, valuation), not the
      // entry date. Fall back to the printed invoice date, then today.
      const receivedDateStr = dateInputValue(patch.received_date)
        || dateInputValue(patch.invoice_date)
        || format(new Date(), 'yyyy-MM-dd');
      const movementCompanyId = reviewDialog.company_id || companyId;

      // Lines that physically add stock (pool purchases stay at the vendor; fees never stock).
      const receivableRows = patch.extracted_items.filter(
        row => row.item_id && !row.pool_purchase && !row.is_fee
      );

      // One receiving event per confirmed invoice records the physical arrival.
      // Its lines drive the inventory_movements ledger via record_inventory_movement,
      // which also keeps location_stock.on_hand_quantity in sync.
      let receivingEvent = null;
      if (receivableRows.length) {
        receivingEvent = await base44.entities.ReceivingEvent.create({
          company_id: movementCompanyId,
          order_id: reviewDialog.order_id || null,
          location_id: patch.location_id,
          received_date: receivedDateStr,
          received_at: new Date().toISOString(),
          reference: patch.invoice_number || null,
          status: 'received',
        });
      }

      const recordReceivingLine = (row, qty, lineStatus = 'received') => {
        if (!receivingEvent) return Promise.resolve(null);
        return base44.entities.ReceivingLine.create({
          company_id: movementCompanyId,
          receiving_event_id: receivingEvent.id,
          item_id: row.item_id,
          quantity_received: qty,
          unit_cost: Number(row.unit_cost || 0),
          line_status: lineStatus,
        });
      };

      // Standard receipts: stock added at the invoice line cost.
      for (const row of receivableRows) {
        if (row.is_pool_draw) continue; // handled with pool drawdowns below
        const receiveQty = row.quantity || 0;
        if (receiveQty <= 0) continue;
        const recvLine = await recordReceivingLine(row, receiveQty);
        await recordMovement({
          companyId: movementCompanyId,
          locationId: patch.location_id,
          itemId: row.item_id,
          quantityDelta: receiveQty,
          unitCost: Number(row.unit_cost || 0),
          sourceType: 'receipt',
          movementDate: receivedDateStr,
          sourceId: recvLine?.id || reviewDialog.id,
          notes: `Invoice ${patch.invoice_number || reviewDialog.id}`,
        });
      }

      // Pool-draw lines: receive the case-converted base quantity at the locked
      // pool cost, recording prepaid drawdowns alongside the ledger movement.
      const poolDrawRows = receivableRows.filter(row => row.is_pool_draw);
      if (poolDrawRows.length) {
        const freshPools = await base44.entities.PrepaidPool.filter({ status: 'active' });
        let overdrawn = false;
        for (const row of poolDrawRows) {
          const item = items.find(i => i.id === row.item_id);
          const matchedOption = item ? (item.purchase_options || []).find((option) => purchaseOptionMatchesLine(option, row)) : null;
          const baseQty = lineBaseQuantity(row, item || {}, matchedOption);
          if (baseQty <= 0) continue;
          const itemPools = activePoolsForItem(freshPools, row.item_id);
          let drawnCost = 0;
          for (const allocation of allocateDrawdowns(itemPools, baseQty)) {
            const available = Math.max(Number(allocation.pool.remaining_quantity || 0), 0);
            if (allocation.quantity > available) overdrawn = true;
            const poolUnitCost = Number(allocation.pool.unit_cost || 0);
            await base44.entities.PoolDrawdown.create({
              pool_id: allocation.pool.id,
              item_id: row.item_id,
              location_id: patch.location_id,
              invoice_id: reviewDialog.id,
              quantity: allocation.quantity,
              unit_cost: poolUnitCost,
              total_cost: allocation.quantity * poolUnitCost,
              drawn_date: receivedDateStr,
              draw_type: 'invoice',
            });
            drawnCost += allocation.quantity * poolUnitCost;
            // keep local remaining in sync so later lines on this invoice allocate correctly
            allocation.pool.remaining_quantity = Number(allocation.pool.remaining_quantity || 0) - allocation.quantity;
          }
          // Add the received stock through the ledger at the weighted pool cost.
          const recvLine = await recordReceivingLine(row, baseQty);
          await recordMovement({
            companyId: movementCompanyId,
            locationId: patch.location_id,
            itemId: row.item_id,
            quantityDelta: baseQty,
            unitCost: baseQty > 0 ? drawnCost / baseQty : 0,
            sourceType: 'pool_draw',
            movementDate: receivedDateStr,
            sourceId: recvLine?.id || reviewDialog.id,
            notes: `Pool draw — invoice ${patch.invoice_number || reviewDialog.id}`,
          });
        }
        if (overdrawn) {
          toast.warning('A prepaid pool was overdrawn by this invoice. Check the Pools page and record an adjustment if needed.');
        }
      }

      // Link the invoice to the receiving event it produced.
      if (receivingEvent) {
        await base44.entities.Invoice.update(reviewDialog.id, { receiving_event_id: receivingEvent.id });
      }

      // Backdated receiving: recompute historical snapshots from the received
      // date forward and record the corrections in the snapshot audit trail.
      const today = format(new Date(), 'yyyy-MM-dd');
      if (receivableRows.length && receivedDateStr < today) {
        try {
          const affectedItemIds = [...new Set(receivableRows.map(row => row.item_id))];
          const changed = await recalculateSnapshots({
            companyId: movementCompanyId,
            locationId: patch.location_id,
            fromDate: receivedDateStr,
            itemIds: affectedItemIds,
            reason: 'backdated_invoice',
            invoiceId: reviewDialog.id,
            receivingEventId: receivingEvent?.id || null,
          });
          if (changed > 0) {
            toast.info(`Updated ${changed} historical snapshot${changed > 1 ? 's' : ''} for the backdated received date.`);
          }
        } catch (recalcError) {
          console.error('Snapshot recalculation failed:', recalcError);
          toast.warning('Stock received, but historical snapshot recalculation failed. Check the audit log.');
        }
      }
      // Roll received quantities back to the linked order and update its status.
      if (reviewDialog.order_id) {
        try {
          const order = await base44.entities.Order.get(reviewDialog.order_id);
          if (order && order.type === 'commissary') {
            const relatedInvoices = await base44.entities.Invoice.filter({ order_id: reviewDialog.order_id });
            const allRelatedInvoicesConfirmed = relatedInvoices.every(inv => inv.status === 'confirmed');
            if (order.status === 'fulfilled' && allRelatedInvoicesConfirmed) {
              await base44.entities.Order.update(reviewDialog.order_id, {
                status: 'received',
                received_at: new Date().toISOString()
              });
            }
          } else if (order) {
            await applyOrderReceivingRollup(order);
          }
        } catch (err) {
          console.error('Failed to update order status:', err);
        }
      }
      await load();
      clearInvoiceWarning(reviewDialog.id);
      setReviewDialog(null);
    } catch (error) {
      toast.error(error.message || 'Failed to confirm invoice');
    } finally {
      setConfirming(false);
    }
  };

  const rejectInvoice = async () => {
    await base44.entities.Invoice.update(reviewDialog.id, { status: 'rejected' });
    await load();
    clearInvoiceWarning(reviewDialog.id);
    setReviewDialog(null);
  };

  // Recompute a vendor order's per-line received quantities from all of its
  // receiving events, and set the order status (ordered → partially_received →
  // fully_received). Skips manually closed/cancelled orders.
  const applyOrderReceivingRollup = async (order) => {
    if (!order || ['closed', 'cancelled'].includes(order.status)) return;
    const events = await base44.entities.ReceivingEvent.filter({ order_id: order.id });
    const receivedByItem = {};
    for (const ev of events) {
      const evLines = await base44.entities.ReceivingLine.filter({ receiving_event_id: ev.id });
      for (const line of evLines) {
        if (!line.item_id) continue;
        receivedByItem[line.item_id] = (receivedByItem[line.item_id] || 0) + Number(line.quantity_received || 0);
      }
    }
    const orderItems = Array.isArray(order.items) ? order.items : [];
    const items = orderItems.map(it => ({ ...it, quantity_received: receivedByItem[it.item_id] || 0 }));
    const anyReceived = items.some(it => Number(it.quantity_received || 0) > 0);
    const allReceived = items.length > 0 && items.every(it =>
      Number(it.quantity_ordered || 0) > 0 && Number(it.quantity_received || 0) >= Number(it.quantity_ordered || 0)
    );
    const status = allReceived ? 'fully_received' : (anyReceived ? 'partially_received' : order.status);
    await base44.entities.Order.update(order.id, {
      items,
      status,
      received_at: anyReceived ? new Date().toISOString() : order.received_at,
    });
  };

  const orderById = (id) => orders.find(o => o.id === id) || null;
  const orderLabel = (order) => order ? (order.order_number || order.po_number || `Order ${String(order.id).slice(0, 8)}`) : '';

  const openLinkDialog = (invoice) => {
    setLinkOrderId(invoice.order_id || '');
    setLinkDialog(invoice);
  };

  // Candidate orders for manual linking: same location (if known) and not in a
  // terminal state, newest first.
  const linkCandidateOrders = (invoice) => {
    if (!invoice) return [];
    const terminal = new Set(['cancelled', 'closed', 'fully_received', 'received']);
    return orders
      .filter(o => !terminal.has(String(o.status || '').toLowerCase()))
      .filter(o => !invoice.location_id || !o.location_id || o.location_id === invoice.location_id)
      .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
  };

  const markInvoiceNoOrder = async (invoice) => {
    try {
      await base44.entities.Invoice.update(invoice.id, { match_status: 'no_order', order_id: null });
      await load();
      setReviewDialog(prev => (prev && prev.id === invoice.id ? { ...prev, match_status: 'no_order', order_id: null } : prev));
      toast.success('Marked as no order needed.');
    } catch (error) {
      toast.error(error.message || 'Failed to update invoice');
    }
  };

  const linkInvoiceToOrder = async () => {
    if (!linkDialog) return;
    setLinking(true);
    try {
      const patch = linkOrderId
        ? { order_id: linkOrderId, match_status: 'manually_matched', matched_at: new Date().toISOString() }
        : { order_id: null, match_status: 'unmatched', matched_at: null };
      await base44.entities.Invoice.update(linkDialog.id, patch);
      await load();
      setReviewDialog(prev => (prev && prev.id === linkDialog.id ? { ...prev, ...patch } : prev));
      toast.success(linkOrderId ? 'Invoice linked to order.' : 'Invoice unlinked.');
      setLinkDialog(null);
    } catch (error) {
      toast.error(error.message || 'Failed to link invoice');
    } finally {
      setLinking(false);
    }
  };

  const locName = (id) => locations.find(l => l.id === id)?.name || '—';
  const unmatchedInvoices = invoices.filter(i => !i.order_id && i.match_status !== 'no_order' && i.status !== 'rejected');
  const processingCount = invoices.filter(i => i.status === 'processing').length;
  const staleProcessingCount = invoices.filter(isProcessingStale).length;
  const pendingCount = invoices.filter(i => i.status === 'pending_review').length;
  const scanBusy = uploading || extracting;
  // Already-finalized invoices open read-only (no re-receive / re-reject).
  const reviewIsFinalized = ['confirmed', 'rejected'].includes(reviewDialog?.status);
  const lineItemCount = reviewDialog?.extracted_items?.length || 0;
  const unmatchedLineCount = (reviewDialog?.extracted_items || []).filter(row => !row.item_id && !row.is_fee).length;
  const feeLineCount = (reviewDialog?.extracted_items || []).filter(row => row.is_fee).length;
  const purchaseOptionSuggestionCount = (reviewDialog?.extracted_items || []).filter(row => row.item_id && row.purchase_option_missing).length;
  const poolDrawCount = (reviewDialog?.extracted_items || []).filter(row => row.item_id && row.is_pool_draw && !row.pool_purchase).length;
  const poolPurchaseCount = (reviewDialog?.extracted_items || []).filter(row => row.pool_purchase).length;
  const allLinesArePoolPurchases = lineItemCount > 0 && poolPurchaseCount === lineItemCount;
  const activeCategories = mergeInventoryCategories(inventoryCategories, items)
    .filter(category => category.is_active !== false);

  return (
    <div className={isMobile ? "p-4 max-w-full" : "p-6 max-w-7xl mx-auto"}>
      <PageHeader
        title="Invoices"
        subtitle="Scan invoices with your camera to auto-receive stock"
        actions={
          <Button disabled={scanBusy} onClick={() => { setUploadError(''); setUploadDialog(true); }}>
            {scanBusy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Camera className="w-4 h-4 mr-1" />}
            {scanBusy ? 'Processing...' : 'Scan Invoice'}
          </Button>
        }
      />

      {processingCount > 0 && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2 text-blue-700 text-sm">
          {staleProcessingCount > 0 ? <AlertTriangle className="w-4 h-4 flex-shrink-0" /> : <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" />}
          {staleProcessingCount > 0
            ? `${staleProcessingCount} invoice${staleProcessingCount > 1 ? 's look' : ' looks'} stalled. Use Retry AI or Review Manually.`
            : `${processingCount} invoice${processingCount > 1 ? 's are' : ' is'} processing in the background`}
        </div>
      )}

      {pendingCount > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2 text-amber-700 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {pendingCount} invoice{pendingCount > 1 ? 's' : ''} pending your review
        </div>
      )}

      {!loading && unmatchedInvoices.length > 0 && (
        <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50/60 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-orange-800">
            <Link2 className="h-4 w-4 flex-shrink-0" />
            Unmatched invoices ({unmatchedInvoices.length})
            <span className="font-normal text-orange-700/80">— not linked to a purchase order</span>
            <button
              type="button"
              className="ml-auto text-xs font-medium text-orange-700 underline-offset-2 hover:underline"
              onClick={() => unmatchedInvoices.forEach(inv => markInvoiceNoOrder(inv))}
            >
              Dismiss all (no order)
            </button>
          </div>
          <div className="space-y-2">
            {unmatchedInvoices.map(inv => (
              <div key={inv.id} className="flex items-center justify-between gap-3 rounded-md border border-orange-100 bg-white px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{inv.vendor_name || '—'} · <span className="font-mono">{inv.invoice_number || 'no #'}</span></p>
                  <p className="text-xs text-muted-foreground">{locName(inv.location_id)} · {inv.invoice_date ? format(new Date(inv.invoice_date), 'MMM d, yyyy') : '—'} · ${(inv.total_amount || 0).toFixed(2)}</p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" onClick={() => markInvoiceNoOrder(inv)}>
                    No order needed
                  </Button>
                  <Button size="sm" variant="outline" className="h-8" onClick={() => openLinkDialog(inv)}>
                    <Link2 className="mr-1 h-3.5 w-3.5" />Link to order
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
      ) : isMobile ? (
        <div className="space-y-3">
          {invoices.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">No invoices yet. Scan your first invoice to get started.</div>
          ) : invoices.map(inv => (
            <div key={inv.id} className={`bg-card border rounded-xl p-4 space-y-3 ${inv.status === 'processing' ? 'border-blue-300 bg-blue-50/30' : inv.status === 'pending_review' ? 'border-amber-300 bg-amber-50/30' : 'border-border'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-sm">{inv.vendor_name || '—'}</p>
                  <p className="text-xs text-muted-foreground">{locName(inv.location_id)} · {format(new Date(inv.created_date), 'MMM d, yyyy')}</p>
                </div>
                <StatusBadge status={inv.status} />
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div><span className="text-muted-foreground block">Invoice #</span><span className="font-mono font-medium">{inv.invoice_number || '—'}</span></div>
                <div><span className="text-muted-foreground block">Total</span><span className="font-semibold text-green-700">${(inv.total_amount || 0).toFixed(2)}</span></div>
                <div><span className="text-muted-foreground block">Items</span><span className="font-medium">{inv.extracted_items?.length || 0}</span></div>
              </div>
              {invoiceWarningFor(inv) && (
                <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                    <span className="break-words">AI scan issue: {invoiceWarningFor(inv)}</span>
                  </div>
                </div>
              )}
              {inv.status === 'pending_review' && (
                <Button size="sm" className="w-full h-9" onClick={() => setReviewDialog(prepareReviewInvoice(inv))}>
                  <Eye className="w-4 h-4 mr-1" />Review Invoice
                </Button>
              )}
              {(inv.status === 'confirmed' || inv.status === 'rejected') && (
                <Button size="sm" variant="outline" className="w-full h-9" onClick={() => setReviewDialog(prepareReviewInvoice(inv))}>
                  <Eye className="w-4 h-4 mr-1" />View Details
                </Button>
              )}
              {inv.status === 'processing' && (
                isProcessingStale(inv) ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="outline" className="h-9" disabled={retryingInvoiceId === inv.id} onClick={() => retryInvoiceExtraction(inv)}>
                      {retryingInvoiceId === inv.id ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                      Retry AI
                    </Button>
                    <Button size="sm" variant="outline" className="h-9" onClick={() => openProcessingInvoiceManually(inv)}>
                      <Eye className="w-4 h-4 mr-1" />Review
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" className="w-full h-9" disabled>
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />Processing {processingAgeLabel(inv)}
                  </Button>
                )
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['Date', 'Location', 'Vendor', 'Invoice #', 'Total', 'Items', 'Status', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invoices.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No invoices yet. Scan your first invoice to get started.</td></tr>
              ) : invoices.map(inv => (
                <tr key={inv.id} className={`hover:bg-muted/30 transition-colors ${inv.status === 'processing' ? 'bg-blue-50/50' : inv.status === 'pending_review' ? 'bg-amber-50/50' : ''}`}>
                  <td className="px-4 py-3">{format(new Date(inv.created_date), 'MMM d, yyyy')}</td>
                  <td className="px-4 py-3">{locName(inv.location_id)}</td>
                  <td className="px-4 py-3 font-medium">{inv.vendor_name || '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground font-mono">{inv.invoice_number || '—'}</td>
                  <td className="px-4 py-3 font-medium">${(inv.total_amount || 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{inv.extracted_items?.length || 0}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={inv.status} />
                    {invoiceWarningFor(inv) && (
                      <div className="mt-1 flex max-w-xs items-start gap-1 text-xs text-red-700">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                        <span className="break-words">AI scan issue: {invoiceWarningFor(inv)}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {inv.status === 'pending_review' && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReviewDialog(prepareReviewInvoice(inv))}>
                        Review
                      </Button>
                    )}
                    {(inv.status === 'confirmed' || inv.status === 'rejected') && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setReviewDialog(prepareReviewInvoice(inv))}>
                        <Eye className="w-3.5 h-3.5 mr-1" />View
                      </Button>
                    )}
                    {inv.status === 'processing' && (
                      isProcessingStale(inv) ? (
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={retryingInvoiceId === inv.id} onClick={() => retryInvoiceExtraction(inv)}>
                            {retryingInvoiceId === inv.id ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
                            Retry AI
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openProcessingInvoiceManually(inv)}>
                            Review Manually
                          </Button>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-700">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />Processing {processingAgeLabel(inv)}
                        </span>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Upload Dialog */}
      <Dialog open={uploadDialog} onOpenChange={(open) => { if (!scanBusy || open) setUploadDialog(open); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Scan Invoice</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Location *</Label>
              <select className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background" value={selectedLoc} onChange={e => setSelectedLoc(e.target.value)}>
                <option value="">Select location...</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>

            <input type="file" ref={fileRef} accept="image/*,application/pdf,.pdf" capture="environment" className="hidden" onChange={e => handleFileUpload(e.target.files?.[0])} />

            <div className="border-2 border-dashed border-border rounded-xl p-8 flex flex-col items-center gap-3 text-center">
              {uploading && <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />}
              {extracting && (
                <div className="space-y-1">
                  <div className="w-8 h-8 border-4 border-amber-300 border-t-amber-600 rounded-full animate-spin mx-auto" />
                  <p className="text-sm text-amber-700 font-medium">AI is extracting invoice data...</p>
                </div>
              )}
              {!uploading && !extracting && (
                <>
                  <Camera className="w-8 h-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Take a photo or upload an invoice image or PDF</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => openFilePicker(true)} disabled={!selectedLoc}>
                      <Camera className="w-4 h-4 mr-1" />Camera
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openFilePicker(false)} disabled={!selectedLoc}>
                      <Upload className="w-4 h-4 mr-1" />Upload
                    </Button>
                  </div>
                  {!selectedLoc && <p className="text-xs text-amber-600">Please select a location first</p>}
                  {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
                </>
              )}
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setUploadDialog(false)} disabled={scanBusy}>Cancel</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!linkDialog} onOpenChange={(open) => { if (!open) setLinkDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Link invoice to order</DialogTitle></DialogHeader>
          {linkDialog && (
            <div className="space-y-3 py-2">
              <div className="rounded-md border border-border bg-muted/30 p-2 text-sm">
                <p className="font-medium">{linkDialog.vendor_name || '—'} · <span className="font-mono">{linkDialog.invoice_number || 'no #'}</span></p>
                <p className="text-xs text-muted-foreground">{locName(linkDialog.location_id)} · {linkDialog.invoice_date ? format(new Date(linkDialog.invoice_date), 'MMM d, yyyy') : '—'}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Purchase order</Label>
                <select
                  className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                  value={linkOrderId}
                  onChange={e => setLinkOrderId(e.target.value)}
                >
                  <option value="">Unlinked</option>
                  {linkCandidateOrders(linkDialog).map(o => (
                    <option key={o.id} value={o.id}>
                      {orderLabel(o)} · {o.vendor_name || vendors.find(v => v.id === o.vendor_id)?.name || '—'} · {o.created_date ? format(new Date(o.created_date), 'MMM d') : ''} · {String(o.status || '').replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
                {linkCandidateOrders(linkDialog).length === 0 && (
                  <p className="mt-1 text-xs text-amber-600">No open orders for this location to link to.</p>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialog(null)} disabled={linking}>Cancel</Button>
            <Button onClick={linkInvoiceToOrder} disabled={linking || (!linkOrderId && !linkDialog?.order_id)}>
              {linking ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              {linkOrderId ? 'Link' : (linkDialog?.order_id ? 'Unlink' : 'Link')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Dialog */}
      <Dialog open={!!reviewDialog} onOpenChange={(open) => { if (!open) { setReviewDialog(null); closeQuickAdd(); closePurchaseOptionDialog(); } }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{reviewIsFinalized ? 'Invoice Details' : 'Review Invoice — AI Extracted Data'}</DialogTitle></DialogHeader>
          {reviewDialog && (
            <div className="space-y-4 py-2">
              {reviewIsFinalized ? (
                <div className="bg-muted/50 border border-border rounded-lg p-3 text-sm text-muted-foreground flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-green-600" />
                  <span>This invoice has been {reviewDialog.status === 'confirmed' ? 'received' : 'rejected'}. You can review the details and fix info like vendor or dates — editing line quantities here will not change stock that was already received.</span>
                </div>
              ) : reviewDialog.extraction_warning ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{reviewDialog.extraction_warning}</span>
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
                  AI has extracted the data below. Match, add, or remove each line before confirming. Confirmed items will automatically update stock levels.
                </div>
              )}
              {unmatchedLineCount > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  {unmatchedLineCount} line{unmatchedLineCount > 1 ? 's' : ''} still need a catalog match.
                </div>
              )}
              {purchaseOptionSuggestionCount > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700 flex items-center gap-2">
                  <Plus className="w-4 h-4 flex-shrink-0" />
                  {purchaseOptionSuggestionCount} matched line{purchaseOptionSuggestionCount > 1 ? 's have' : ' has'} a new vendor product/SKU. Add the purchase option before confirming if you want future invoices to match automatically.
                </div>
              )}
              {poolDrawCount > 0 && (
                <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 text-sm text-violet-700 flex items-center gap-2">
                  <Layers className="w-4 h-4 flex-shrink-0" />
                  {poolDrawCount} line{poolDrawCount > 1 ? 's' : ''} will draw from prepaid pools at the locked cost. Case quantities are converted using the purchase option pack size — stock and the pool drawdown both use the converted amount. No purchase option is created from these lines.
                </div>
              )}
              {feeLineCount > 0 && (
                <div className="bg-gray-100 border border-gray-200 rounded-lg p-3 text-sm text-gray-600 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  {feeLineCount} fee line{feeLineCount > 1 ? 's' : ''} (fuel, delivery, etc.) will stay on this invoice for the record but won&apos;t receive stock or affect item costs.
                </div>
              )}
              {poolPurchaseCount > 0 && (
                <div className="bg-slate-100 border border-slate-200 rounded-lg p-3 text-sm text-slate-700 flex items-center gap-2">
                  <Layers className="w-4 h-4 flex-shrink-0" />
                  {poolPurchaseCount} line{poolPurchaseCount > 1 ? 's are' : ' is'} a prepaid pool purchase. The vendor holds this stock — confirming records the bill without receiving stock.
                </div>
              )}
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-sm font-semibold">Invoice Details</Label>
                  <span className="text-xs text-muted-foreground">Edit anything the scan read incorrectly.</span>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <Link2 className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    {reviewDialog.order_id ? (
                      <span className="truncate">
                        Linked to <span className="font-medium">{orderLabel(orderById(reviewDialog.order_id))}</span>
                        {reviewDialog.match_status && <span className="text-muted-foreground"> · {String(reviewDialog.match_status).replace(/_/g, ' ')}</span>}
                      </span>
                    ) : reviewDialog.match_status === 'no_order' ? (
                      <span className="text-muted-foreground">No order needed</span>
                    ) : (
                      <span className="text-orange-700">Not linked to an order</span>
                    )}
                  </span>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    {!reviewDialog.order_id && reviewDialog.match_status !== 'no_order' && (
                      <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground" onClick={() => markInvoiceNoOrder(reviewDialog)}>
                        No order needed
                      </Button>
                    )}
                    <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => openLinkDialog(reviewDialog)}>
                      {reviewDialog.order_id ? 'Change' : 'Link'}
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Vendor</Label>
                    <Input
                      className="mt-1"
                      list="invoice-vendor-options"
                      value={reviewDialog.vendor_name || ''}
                      onChange={e => updateReviewField('vendor_name', e.target.value)}
                      placeholder="Supplier / vendor name"
                    />
                    <datalist id="invoice-vendor-options">
                      {vendors.map(vendor => (
                        <option key={vendor.id || vendor.name} value={vendor.name || ''} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Invoice #</Label>
                    <Input
                      className="mt-1 font-mono"
                      value={reviewDialog.invoice_number || ''}
                      onChange={e => updateReviewField('invoice_number', e.target.value)}
                      placeholder="Invoice number"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Invoice Date</Label>
                    <Input
                      className="mt-1"
                      type="date"
                      value={dateInputValue(reviewDialog.invoice_date)}
                      onChange={e => updateReviewField('invoice_date', e.target.value || null)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Received Date</Label>
                    <Input
                      className="mt-1"
                      type="date"
                      value={dateInputValue(reviewDialog.received_date)}
                      onChange={e => updateReviewField('received_date', e.target.value || null)}
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">Drives inventory counts &amp; valuation.</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Total</Label>
                    <Input
                      className="mt-1 font-semibold"
                      type="number"
                      min="0"
                      step="0.01"
                      value={reviewDialog.total_amount ?? ''}
                      onChange={e => updateReviewField('total_amount', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-xs text-muted-foreground">Receiving Location</Label>
                    <select
                      className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                      value={reviewDialog.location_id || ''}
                      onChange={e => updateReviewField('location_id', e.target.value)}
                    >
                      <option value="">Select location...</option>
                      {locations.map(location => (
                        <option key={location.id} value={location.id}>{location.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {reviewDialog.image_url && (
                <div>
                  <a href={reviewDialog.image_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">View Original Invoice</a>
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <Label className="block">Line Items — match to inventory items to update stock</Label>
                  <Button variant="outline" size="sm" className="h-8" onClick={addManualExtractedItem}>
                    <Plus className="w-3.5 h-3.5 mr-1" />Add Line
                  </Button>
                </div>
                <div className="space-y-2">
                  {lineItemCount === 0 && (
                    <div className="rounded-lg border border-border px-3 py-6 text-center text-sm text-muted-foreground">
                      No line items found. Add a line manually or reject this invoice.
                    </div>
                  )}
                  {(reviewDialog.extracted_items || []).map((row, idx) => (
                    <div key={idx} className="rounded-lg border border-border p-3 space-y-3">
                      <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">{row.item_name}</p>
                              {(firstLineCode(row) || row.pack_size) && (
                                <p className="text-[11px] text-muted-foreground">
                                  {[firstLineCode(row) ? `Item # ${firstLineCode(row)}` : '', row.pack_size].filter(Boolean).join(' · ')}
                                </p>
                              )}
                              {!row.item_id && row.is_fee && (
                                <span className="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                                  Fee — record only
                                </span>
                              )}
                              {!row.item_id && !row.is_fee && (
                                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                  New or unmatched
                                </span>
                              )}
                              {row.item_id && row.purchase_option_missing && (
                                <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                                  New purchase option
                                </span>
                              )}
                              {row.purchase_option_matched && !row.purchase_option_missing && !row.is_pool_draw && !row.pool_purchase && (
                                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                  Purchase option matched
                                </span>
                              )}
                              {row.item_id && row.is_pool_draw && !row.pool_purchase && (() => {
                                const item = items.find(i => i.id === row.item_id);
                                const itemPools = activePoolsForItem(pools, row.item_id);
                                const remaining = itemPools.reduce((sum, pool) => sum + Number(pool.remaining_quantity || 0), 0);
                                const matchedOption = item ? (item.purchase_options || []).find((option) => purchaseOptionMatchesLine(option, row)) : null;
                                const baseQty = lineBaseQuantity(row, item || {}, matchedOption);
                                const converted = baseQty !== Number(row.quantity || 0);
                                const overdraw = baseQty > remaining;
                                return (
                                  <span className="inline-flex flex-wrap items-center gap-1">
                                    <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                                      Pool draw{converted ? ` — ${baseQty.toLocaleString()} ${item?.unit_of_measure || 'EA'}` : ''}
                                    </span>
                                    <span className={`text-[11px] ${overdraw ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                                      {overdraw ? `exceeds ${remaining.toLocaleString()} remaining` : `${remaining.toLocaleString()} in pool`}
                                    </span>
                                  </span>
                                );
                              })()}
                              {row.pool_purchase && (
                                <span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                                  Pool purchase — no stock received
                                </span>
                              )}
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Match to inventory item</Label>
                        <div className="mt-1">
                          <InventoryItemSearch
                            value={row.item_id || ''}
                            onChange={(itemId) => updateExtractedItem(idx, 'item_id', itemId)}
                            items={items}
                            extractedName={row.item_name}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div>
                          <Label className="text-xs text-muted-foreground">Qty</Label>
                          <Input type="number" className="mt-1 h-8 text-sm" value={row.quantity} onChange={e => updateExtractedItem(idx, 'quantity', e.target.value)} />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">UOM</Label>
                          <Input className="mt-1 h-8 text-sm" value={row.unit_of_measure || ''} onChange={e => updateExtractedItem(idx, 'unit_of_measure', e.target.value)} />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Unit Cost</Label>
                          <Input type="number" step="0.01" className="mt-1 h-8 text-sm" value={row.unit_cost} onChange={e => updateExtractedItem(idx, 'unit_cost', e.target.value)} />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Total</Label>
                          <p className="mt-1 flex h-8 items-center text-sm font-medium">${(row.total_cost || ((row.quantity || 0) * (row.unit_cost || 0))).toFixed(2)}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                              {!row.item_id && !row.is_fee && (
                                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openQuickAdd(idx)}>
                                  <Plus className="w-3.5 h-3.5 mr-1" />Add Item
                                </Button>
                              )}
                              {!row.item_id && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className={`h-7 text-xs ${row.is_fee ? 'border-gray-400 text-gray-600' : ''}`}
                                  onClick={() => toggleFeeLine(idx)}
                                >
                                  {row.is_fee ? 'Fee: On' : 'Mark as Fee'}
                                </Button>
                              )}
                              {row.item_id && row.purchase_option_missing && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  disabled={savingPurchaseOptionIdx === idx}
                                  onClick={() => openPurchaseOptionDialog(idx)}
                                >
                                  <Plus className="w-3.5 h-3.5 mr-1" />
                                  {savingPurchaseOptionIdx === idx ? 'Adding...' : 'Review Purchase Option'}
                                </Button>
                              )}
                              {row.item_id && !row.pool_purchase && activePoolsForItem(pools, row.item_id).length > 0 && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className={`h-7 text-xs ${row.is_pool_draw ? 'border-violet-300 text-violet-700' : ''}`}
                                  onClick={() => togglePoolDraw(idx)}
                                >
                                  <Layers className="w-3.5 h-3.5 mr-1" />
                                  {row.is_pool_draw ? 'Pool Draw: On' : 'Pool Draw: Off'}
                                </Button>
                              )}
                              {row.item_id && !row.pool_purchase && !row.is_pool_draw && ((row.total_cost || 0) > 0 || (row.unit_cost || 0) > 0) && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => openPoolDialogForLine(idx)}
                                >
                                  <Layers className="w-3.5 h-3.5 mr-1" />Create Pool
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive"
                                aria-label={`Remove ${row.item_name || 'line item'}`}
                                onClick={() => removeExtractedItem(idx)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            {reviewIsFinalized ? (
              <>
                <Button variant="outline" onClick={saveInvoiceReview} disabled={savingReview}>
                  {savingReview ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                  {savingReview ? 'Saving...' : 'Save Changes'}
                </Button>
                <Button onClick={() => setReviewDialog(null)}>Done</Button>
              </>
            ) : (
              <>
                <Button variant="outline" className="text-destructive" onClick={rejectInvoice}>
                  <XCircle className="w-4 h-4 mr-1" />Reject
                </Button>
                <Button variant="outline" onClick={saveInvoiceReview} disabled={savingReview || confirming}>
                  {savingReview ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                  {savingReview ? 'Saving...' : 'Save Changes'}
                </Button>
                <Button onClick={confirmInvoice} disabled={confirming || savingReview || lineItemCount === 0 || unmatchedLineCount > 0}>
                  <CheckCircle className="w-4 h-4 mr-1" />
                  {confirming ? 'Confirming...' : allLinesArePoolPurchases ? 'Confirm — Vendor Holds Stock' : 'Confirm & Receive Stock'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!purchaseOptionDialog} onOpenChange={(open) => { if (!open) closePurchaseOptionDialog(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Review Purchase Option</DialogTitle></DialogHeader>
          {purchaseOptionDialog && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
                Add a supplier purchase option for <span className="font-semibold">{purchaseOptionDialog.itemName}</span>. Review the case pack, UOM, and price before saving it to the catalog.
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Linked Supplier</Label>
                  <select
                    className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                    value={purchaseOptionDialog.option.vendor_id || ''}
                    onChange={e => handlePurchaseOptionVendorChange(e.target.value)}
                  >
                    <option value="">Custom / not linked</option>
                    {vendors.map(vendor => (
                      <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Supplier Name</Label>
                  <Input
                    className="mt-1"
                    value={purchaseOptionDialog.option.vendor_name || ''}
                    onChange={e => updatePurchaseOptionDraft('vendor_name', e.target.value)}
                    placeholder="Supplier name"
                  />
                </div>
                <div>
                  <Label className="text-xs">Product Name</Label>
                  <Input
                    className="mt-1"
                    value={purchaseOptionDialog.option.product_name || ''}
                    onChange={e => updatePurchaseOptionDraft('product_name', e.target.value)}
                    placeholder="Name as shown on invoice"
                  />
                </div>
                <div>
                  <Label className="text-xs">Supplier Product Code</Label>
                  <Input
                    className="mt-1"
                    value={purchaseOptionDialog.option.product_code || ''}
                    onChange={e => updatePurchaseOptionDraft('product_code', e.target.value)}
                    placeholder="SKU / item number"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-border p-3">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pack Size Breakdown</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Units per Inner Pack</Label>
                    <div className="mt-1 flex gap-1.5">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={purchaseOptionDialog.option.inner_pack_units ?? ''}
                        onChange={e => updatePurchaseOptionDraft('inner_pack_units', e.target.value)}
                        className="min-w-0 flex-1"
                      />
                      <select
                        className="w-24 shrink-0 rounded-md border border-input bg-background px-2 py-1 text-sm"
                        value={purchaseOptionDialog.option.inner_pack_uom || ''}
                        onChange={e => updatePurchaseOptionDraft('inner_pack_uom', e.target.value)}
                      >
                        <option value="">UOM</option>
                        {UOM_OPTIONS.map(uom => <option key={uom} value={uom}>{uom}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Inner Pack Name</Label>
                    <Input
                      className="mt-1"
                      value={purchaseOptionDialog.option.inner_pack_name || ''}
                      onChange={e => updatePurchaseOptionDraft('inner_pack_name', e.target.value)}
                      placeholder="Cookie, Bottle, Sleeve..."
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Packs per Case</Label>
                    <Input
                      className="mt-1"
                      type="number"
                      min="0"
                      step="0.01"
                      value={purchaseOptionDialog.option.packs_per_case ?? ''}
                      onChange={e => updatePurchaseOptionDraft('packs_per_case', e.target.value)}
                    />
                  </div>
                </div>
                {parseFloat(purchaseOptionDialog.option.inner_pack_units) > 0 && purchaseOptionDialog.option.inner_pack_name && (
                  <div className="mt-3 rounded-md bg-primary/5 p-2 text-xs font-medium text-primary">
                    {(() => {
                      const units = parseFloat(purchaseOptionDialog.option.inner_pack_units) || 0;
                      const packs = parseFloat(purchaseOptionDialog.option.packs_per_case) || 0;
                      const uom = purchaseOptionDialog.option.inner_pack_uom || 'EA';
                      const name = purchaseOptionDialog.option.inner_pack_name;
                      if (packs > 0) return `${units} ${uom} x ${packs} ${name}${packs === 1 ? '' : 's'} = ${units * packs} ${uom} per Case`;
                      return `${units} ${uom} per ${name}`;
                    })()}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Unit Cost</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    min="0"
                    step="0.01"
                    value={purchaseOptionDialog.option.unit_cost || ''}
                    onChange={e => updatePurchaseOptionDraft('unit_cost', e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Cost Is Per</Label>
                  <select
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={purchaseOptionDialog.option.unit_of_measure || ''}
                    onChange={e => updatePurchaseOptionDraft('unit_of_measure', e.target.value)}
                  >
                    <option value="">Select UOM...</option>
                    {[...new Set([...UOM_OPTIONS, 'Case', purchaseOptionDialog.option.inner_pack_name].filter(Boolean))].map(uom => (
                      <option key={uom} value={uom}>{uom}</option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={purchaseOptionDialog.option.is_preferred === true}
                    onChange={e => updatePurchaseOptionDraft('is_preferred', e.target.checked)}
                  />
                  Make preferred purchase option
                </label>
                <div className="md:col-span-2">
                  <Label className="text-xs">Notes</Label>
                  <Input
                    className="mt-1"
                    value={purchaseOptionDialog.option.notes || ''}
                    onChange={e => updatePurchaseOptionDraft('notes', e.target.value)}
                    placeholder="Pack notes, vendor notes, special handling..."
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closePurchaseOptionDialog}>Cancel</Button>
            <Button
              onClick={savePurchaseOptionFromDialog}
              disabled={!purchaseOptionDialog?.option.product_name?.trim() || savingPurchaseOptionIdx !== null}
            >
              {savingPurchaseOptionIdx !== null ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
              {savingPurchaseOptionIdx !== null ? 'Saving...' : 'Save Purchase Option'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={quickAddRowIdx !== null} onOpenChange={(open) => { if (!open) closeQuickAdd(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Catalog Item</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Item Name *</Label>
              <Input
                className="mt-1"
                value={quickAddForm.name}
                onChange={e => setQuickAddForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <Label>Category</Label>
              <select
                className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                value={quickAddForm.category}
                onChange={e => setQuickAddForm(f => ({ ...f, category: e.target.value }))}
              >
                <option value="">No category</option>
                {activeCategories.map(category => (
                  <option key={`${category.main_category}-${category.name}`} value={category.name}>{category.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Unit of Measure *</Label>
                <select
                  className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                  value={quickAddForm.unit_of_measure}
                  onChange={e => setQuickAddForm(f => ({ ...f, unit_of_measure: e.target.value }))}
                >
                  {UOM_OPTIONS.map(uom => <option key={uom} value={uom}>{uom}</option>)}
                </select>
              </div>
              <div>
                <Label>Unit Cost</Label>
                <Input
                  className="mt-1"
                  type="number"
                  step="0.01"
                  value={quickAddForm.unit_cost}
                  onChange={e => setQuickAddForm(f => ({ ...f, unit_cost: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeQuickAdd}>Cancel</Button>
            <Button onClick={createCatalogItemFromLine} disabled={savingQuickAdd || !quickAddForm.name.trim() || !quickAddForm.unit_of_measure}>
              <Plus className="w-4 h-4 mr-1" />{savingQuickAdd ? 'Adding...' : 'Add & Match'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreatePoolDialog
        open={Boolean(poolDialog)}
        onClose={() => setPoolDialog(null)}
        items={items}
        vendors={vendors}
        initial={poolDialog?.initial}
        onCreated={handlePoolCreated}
      />
    </div>
  );
}
