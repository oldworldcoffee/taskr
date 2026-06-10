import { useState, useEffect, useMemo, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Camera, Upload, CheckCircle, XCircle, Eye, AlertTriangle, Plus, Trash2, Loader2, Check, ChevronsUpDown, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import PageHeader from '@/components/layout/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { mergeInventoryCategories } from '@/lib/inventoryCategories';
import { format } from 'date-fns';
import { toast } from 'sonner';

const UOM_OPTIONS = ['EA', 'fl-oz', 'oz', 'ml', 'L', 'Qt', 'gal', 'g', 'gr', 'kg', 'lb'];
const INVOICE_EXTRACTION_TIMEOUT_MS = 90 * 1000;
const PROCESSING_STALE_MS = 2 * 60 * 1000;

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

function normalizeMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\bchoc\b/g, 'chocolate')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function purchaseOptionMatchesLine(option = {}, row = {}) {
  const rowCode = normalizeMatchText(row.vendor_sku || row.vendor_item_number || row.product_code || row.sku);
  const optionCode = normalizeMatchText(option.product_code || option.vendor_sku || option.sku);
  if (rowCode && optionCode && rowCode === optionCode) return true;
  if (rowCode) return false;

  const rowName = normalizeMatchText(row.item_name);
  const optionName = normalizeMatchText(option.product_name || option.name);
  if (!rowName || !optionName) return false;
  return rowName === optionName || rowName.includes(optionName) || optionName.includes(rowName);
}

function shouldSuggestPurchaseOption(row, item) {
  if (!row?.item_id || !item) return false;
  if (row.purchase_option_added) return false;
  if ((item.purchase_options || []).some((option) => purchaseOptionMatchesLine(option, row))) return false;
  return Boolean(row.vendor_sku || row.item_name);
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
  const matchedVendor = vendorName
    ? vendors.find(v => String(v.name || '').trim().toLowerCase() === vendorName.toLowerCase())
    : null;
  const packDefaults = parseInvoicePackSize(row, item);
  const unitCost = parseFloat(row.unit_cost) || 0;

  return {
    ...EMPTY_PURCHASE_OPTION,
    vendor_id: matchedVendor?.id || '',
    vendor_name: vendorName,
    product_name: row.item_name || item.name || '',
    product_code: row.vendor_sku || '',
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

function inventoryItemLabel(item) {
  if (!item) return '';
  return `${item.name}${item.unit_of_measure ? ` (${item.unit_of_measure})` : ''}`;
}

function normalizeInventorySearch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/fluid\s+ounces?/g, 'oz')
    .replace(/fl[.\s-]*oz/g, 'oz')
    .replace(/ounces?/g, 'oz')
    .replace(/\bchoc\b/g, 'chocolate')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchParts(value) {
  const normalized = normalizeInventorySearch(value);
  return {
    normalized,
    compact: normalized.replace(/\s+/g, ''),
    words: normalized.split(' ').filter(Boolean),
  };
}

function tokenMatches(parts, token) {
  if (!token) return true;
  if (/\d/.test(token)) return parts.compact.includes(token) || parts.normalized.includes(token);
  if (token.length <= 3) return parts.words.some((word) => word === token || word.startsWith(token));
  return parts.normalized.includes(token) || parts.words.some((word) => word.startsWith(token));
}

function itemSearchText(item) {
  const purchaseText = (item.purchase_options || [])
    .map((option) => [
      option.vendor_name,
      option.product_name,
      option.product_code,
      option.vendor_sku,
      option.unit_of_measure,
      option.inner_pack_name,
      option.inner_pack_uom,
    ].filter(Boolean).join(' '))
    .join(' ');
  return [item.name, item.sku, item.category, item.unit_of_measure, item.description, purchaseText].filter(Boolean).join(' ');
}

function rankInventoryItem(item, query) {
  const queryParts = searchParts(query);
  const tokens = queryParts.words.length ? queryParts.words : [queryParts.compact].filter(Boolean);
  if (!tokens.length) return 0;

  const fullParts = searchParts(itemSearchText(item));
  if (!tokens.every((token) => tokenMatches(fullParts, token))) return null;

  const nameParts = searchParts(item.name);
  const categoryParts = searchParts(item.category);
  const uomParts = searchParts(item.unit_of_measure);
  const queryText = queryParts.normalized;
  const queryCompact = queryParts.compact;

  let score = 100;
  if (nameParts.normalized === queryText) score = 0;
  else if (nameParts.normalized.startsWith(queryText)) score = 5;
  else if (nameParts.words.some((word) => word === queryText || word.startsWith(queryText))) score = 10;
  else if (queryCompact && nameParts.compact.includes(queryCompact)) score = 15;
  else if (nameParts.normalized.includes(queryText)) score = 20;
  else if (tokens.every((token) => tokenMatches(nameParts, token))) score = 25;
  else if (tokens.every((token) => tokenMatches(categoryParts, token))) score = 45;
  else if (tokens.every((token) => tokenMatches(uomParts, token))) score = 60;

  return score + Math.min(nameParts.normalized.length / 100, 2);
}

function rankedInventoryItems(items, query) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [...items].sort((a, b) => (a.name || '').localeCompare(b.name || '')).slice(0, 50);
  }

  return items
    .map((item) => ({ item, rank: rankInventoryItem(item, trimmedQuery) }))
    .filter((entry) => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || (a.item.name || '').localeCompare(b.item.name || ''))
    .map((entry) => entry.item)
    .slice(0, 75);
}

function InvoiceItemSearch({ value, onChange, items, extractedName }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = items.find((item) => item.id === value);
  const visibleItems = useMemo(() => rankedInventoryItems(items, query), [items, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-8 w-full min-w-[220px] justify-between px-2 text-xs font-normal"
        >
          <span className={`truncate ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>
            {selected ? inventoryItemLabel(selected) : 'Search inventory item'}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(520px,calc(100vw-2rem))] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={extractedName ? `Search for ${extractedName}` : 'Search by item, size, category, SKU...'}
          />
          <CommandList>
            <CommandGroup>
              <CommandItem value="__no_match__" onSelect={() => { onChange(''); setOpen(false); setQuery(''); }}>
                <Check className={`h-4 w-4 ${!value ? 'opacity-100' : 'opacity-0'}`} />
                <span className="text-muted-foreground">No match</span>
              </CommandItem>
              {visibleItems.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">No inventory item found.</div>
              ) : visibleItems.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={() => {
                    onChange(item.id);
                    setOpen(false);
                    setQuery('');
                  }}
                >
                  <Check className={`h-4 w-4 ${value === item.id ? 'opacity-100' : 'opacity-0'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{inventoryItemLabel(item)}</span>
                    {item.category && <span className="block truncate text-xs text-muted-foreground">{item.category}</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function Invoices() {
  const { canAccessLocation, companyId } = useAuth();
  const isMobile = useIsMobile();
  const [locations, setLocations] = useState([]);
  const [items, setItems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [inventoryCategories, setInventoryCategories] = useState([]);
  const [locInv, setLocInv] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [uploadDialog, setUploadDialog] = useState(false);
  const [reviewDialog, setReviewDialog] = useState(null);
  const [quickAddRowIdx, setQuickAddRowIdx] = useState(null);
  const [quickAddForm, setQuickAddForm] = useState(EMPTY_QUICK_ADD);
  const [purchaseOptionDialog, setPurchaseOptionDialog] = useState(null);
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
  const fileRef = useRef();

  const load = () => {
    setLoading(true);
    return Promise.all([
      base44.entities.Location.list(),
      base44.entities.InventoryItem.filter({ is_active: true }),
      base44.entities.LocationInventory.list(),
      base44.entities.Invoice.list('-created_date', 50),
      base44.entities.Vendor.list(),
      companyId ? base44.entities.InventoryCategory.filter({ company_id: companyId }).catch(() => []) : Promise.resolve([]),
    ]).then(([locs, itms, linv, invs, vends, cats]) => {
      setLocations(locs.filter(l => canAccessLocation(l.id)));
      setItems(itms);
      setLocInv(linv);
      setInvoices(invs);
      setVendors(vends);
      setInventoryCategories(cats);
      setLoading(false);
    }).catch((error) => {
      toast.error(error.message || 'Failed to load invoices');
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, [companyId]);

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
      extractionWarning = extractionError.message || 'The image uploaded, but automatic parsing failed. You can add lines manually in review.';
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

    await base44.entities.Invoice.update(invoice.id, patch);
    return {
      invoice: { ...invoice, ...patch },
      extractedItems,
      extractionWarning,
    };
  };

  const handleFileUpload = async (file) => {
    if (!file || !selectedLoc) return;

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
      });
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
        toast.warning(extractionWarning);
      } else if (extractedItems.length === 0) {
        toast.warning('Invoice is ready for review, but no line items were found.');
      } else {
        toast.success('Invoice is ready for review.');
      }
    } catch (error) {
      console.error('Invoice extraction save failed:', error);
      try {
        await base44.entities.Invoice.update(invoice.id, { status: 'pending_review' });
        await load();
      } catch (statusError) {
        console.error('Failed to move invoice out of processing:', statusError);
      }
      toast.error('The invoice uploaded, but the extracted data could not be saved.');
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
      await base44.entities.Invoice.update(invoice.id, { status: 'processing' });
      await load();
      const { invoice: reviewedInvoice, extractedItems, extractionWarning } = await extractInvoiceToReview(invoice, fileUrl);
      await load();
      setReviewDialog({
        ...reviewedInvoice,
        extraction_warning: extractionWarning,
      });
      if (extractionWarning) {
        toast.warning(extractionWarning);
      } else if (extractedItems.length === 0) {
        toast.warning('Invoice is ready for review, but no line items were found.');
      } else {
        toast.success('Invoice extraction finished.');
      }
    } catch (error) {
      console.error('Invoice retry failed:', error);
      try {
        await base44.entities.Invoice.update(invoice.id, { status: 'pending_review' });
        await load();
      } catch (statusError) {
        console.error('Failed to unlock invoice after retry failure:', statusError);
      }
      toast.error(error.message || 'AI retry failed. You can review the invoice manually.');
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
      setReviewDialog({
        ...invoice,
        ...patch,
        extraction_warning: 'AI processing did not finish. Add lines manually, correct the details, or retry extraction from the invoice list.',
      });
    } catch (error) {
      toast.error(error.message || 'Failed to open invoice for manual review');
    }
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
      const matchedVendor = vendorName
        ? vendors.find(v => String(v.name || '').trim().toLowerCase() === vendorName.toLowerCase())
        : null;
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
            vendor_name: vendorName,
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

    const unmatchedCount = (reviewDialog.extracted_items || []).filter(row => !row.item_id).length;
    if (unmatchedCount > 0) {
      toast.error('Match, add, or remove unmatched lines before confirming.');
      return;
    }

    setConfirming(true);
    try {
      const patch = invoicePatchFromReview('confirmed');
      await base44.entities.Invoice.update(reviewDialog.id, patch);
      // Update stock levels for matched items
      for (const row of patch.extracted_items) {
        if (!row.item_id) continue;
        const li = locInv.find(l => l.location_id === patch.location_id && l.item_id === row.item_id);
        const newQty = (li?.on_hand_quantity || 0) + (row.quantity || 0);
        if (li) await base44.entities.LocationInventory.update(li.id, { ...li, on_hand_quantity: newQty });
        else await base44.entities.LocationInventory.create({ location_id: patch.location_id, item_id: row.item_id, on_hand_quantity: newQty, par_level: 0, reorder_point: 0 });
      }
      // Update related commissary order status to 'received'
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
          }
        } catch (err) {
          console.error('Failed to update order status:', err);
        }
      }
      await load();
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
    setReviewDialog(null);
  };

  const locName = (id) => locations.find(l => l.id === id)?.name || '—';
  const processingCount = invoices.filter(i => i.status === 'processing').length;
  const staleProcessingCount = invoices.filter(isProcessingStale).length;
  const pendingCount = invoices.filter(i => i.status === 'pending_review').length;
  const scanBusy = uploading || extracting;
  const lineItemCount = reviewDialog?.extracted_items?.length || 0;
  const unmatchedLineCount = (reviewDialog?.extracted_items || []).filter(row => !row.item_id).length;
  const purchaseOptionSuggestionCount = (reviewDialog?.extracted_items || []).filter(row => row.item_id && row.purchase_option_missing).length;
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
              {inv.status === 'pending_review' && (
                <Button size="sm" className="w-full h-9" onClick={() => setReviewDialog(inv)}>
                  <Eye className="w-4 h-4 mr-1" />Review Invoice
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
                  <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                  <td className="px-4 py-3">
                    {inv.status === 'pending_review' && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReviewDialog(inv)}>
                        Review
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

            <input type="file" ref={fileRef} accept="image/*" capture="environment" className="hidden" onChange={e => handleFileUpload(e.target.files?.[0])} />

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
                  <p className="text-sm text-muted-foreground">Take a photo or upload an invoice image</p>
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

      {/* Review Dialog */}
      <Dialog open={!!reviewDialog} onOpenChange={(open) => { if (!open) { setReviewDialog(null); closeQuickAdd(); closePurchaseOptionDialog(); } }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Review Invoice — AI Extracted Data</DialogTitle></DialogHeader>
          {reviewDialog && (
            <div className="space-y-4 py-2">
              {reviewDialog.extraction_warning ? (
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
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-sm font-semibold">Invoice Details</Label>
                  <span className="text-xs text-muted-foreground">Edit anything the scan read incorrectly.</span>
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
                  <a href={reviewDialog.image_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">View Original Image</a>
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <Label className="block">Line Items — match to inventory items to update stock</Label>
                  <Button variant="outline" size="sm" className="h-8" onClick={addManualExtractedItem}>
                    <Plus className="w-3.5 h-3.5 mr-1" />Add Line
                  </Button>
                </div>
                <div className="border border-border rounded-lg overflow-x-auto">
                  <table className="w-full min-w-[920px] text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        {['AI Extracted Name', 'Match to Item', 'Qty', 'UOM', 'Unit Cost', 'Total', 'Actions'].map(h => (
                          <th key={h} className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {lineItemCount === 0 && (
                        <tr>
                          <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">
                            No line items found. Add a line manually or reject this invoice.
                          </td>
                        </tr>
                      )}
                      {(reviewDialog.extracted_items || []).map((row, idx) => (
                        <tr key={idx} className="hover:bg-muted/20">
                          <td className="px-3 py-2">
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">{row.item_name}</p>
                              {(row.vendor_sku || row.pack_size) && (
                                <p className="text-[11px] text-muted-foreground">
                                  {[row.vendor_sku ? `Item # ${row.vendor_sku}` : '', row.pack_size].filter(Boolean).join(' · ')}
                                </p>
                              )}
                              {!row.item_id && (
                                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                  New or unmatched
                                </span>
                              )}
                              {row.item_id && row.purchase_option_missing && (
                                <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                                  New purchase option
                                </span>
                              )}
                              {row.purchase_option_matched && !row.purchase_option_missing && (
                                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                  Purchase option matched
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <InvoiceItemSearch
                              value={row.item_id || ''}
                              onChange={(itemId) => updateExtractedItem(idx, 'item_id', itemId)}
                              items={items}
                              extractedName={row.item_name}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input type="number" className="w-20 h-7 text-xs" value={row.quantity} onChange={e => updateExtractedItem(idx, 'quantity', e.target.value)} />
                          </td>
                          <td className="px-3 py-2">
                            <Input className="w-20 h-7 text-xs" value={row.unit_of_measure || ''} onChange={e => updateExtractedItem(idx, 'unit_of_measure', e.target.value)} />
                          </td>
                          <td className="px-3 py-2">
                            <Input type="number" step="0.01" className="w-20 h-7 text-xs" value={row.unit_cost} onChange={e => updateExtractedItem(idx, 'unit_cost', e.target.value)} />
                          </td>
                          <td className="px-3 py-2 text-xs font-medium">${(row.total_cost || ((row.quantity || 0) * (row.unit_cost || 0))).toFixed(2)}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              {!row.item_id && (
                                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openQuickAdd(idx)}>
                                  <Plus className="w-3.5 h-3.5 mr-1" />Add Item
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
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="text-destructive" onClick={rejectInvoice}>
              <XCircle className="w-4 h-4 mr-1" />Reject
            </Button>
            <Button variant="outline" onClick={saveInvoiceReview} disabled={savingReview || confirming}>
              {savingReview ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              {savingReview ? 'Saving...' : 'Save Changes'}
            </Button>
            <Button onClick={confirmInvoice} disabled={confirming || savingReview || lineItemCount === 0 || unmatchedLineCount > 0}>
              <CheckCircle className="w-4 h-4 mr-1" />{confirming ? 'Confirming...' : 'Confirm & Receive Stock'}
            </Button>
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
    </div>
  );
}
