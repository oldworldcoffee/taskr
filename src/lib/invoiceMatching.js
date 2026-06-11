// Pure heuristics for auto-linking an invoice to a purchase order.
//
// Tier 1 (high confidence): an exact reference match — the invoice's PO number,
// vendor reference, or invoice number equals the order's order_number, po_number,
// or vendor_reference.
// Tier 2 (medium): vendor + location + date range — the most recent still-open
// order from the same vendor at the same location, placed within a window around
// the invoice's date.
//
// The caller resolves vendorId (via its own fuzzy vendor-name match) and passes
// it in, keeping this module dependency-free and unit-testable.

const norm = (value) => String(value ?? '').trim().toLowerCase();
const code = (value) => norm(value).replace(/\s+/g, '');
const DAY_MS = 86400000;

// Orders in these states can no longer receive an invoice.
const TERMINAL_STATUSES = new Set(['cancelled', 'closed', 'fully_received', 'received']);

function orderDateValue(order) {
  const raw = order.ordered_at || order.sent_at || order.created_date;
  const time = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(time) ? time : null;
}

function invoiceDateValue(invoice) {
  const raw = invoice.received_date || invoice.invoice_date;
  const time = raw ? new Date(raw).getTime() : Date.now();
  return Number.isFinite(time) ? time : Date.now();
}

export function matchInvoiceToOrder(invoice, orders = [], {
  vendorId = null,
  windowDaysBefore = 45,
  windowDaysAfter = 7,
} = {}) {
  if (!invoice || !orders.length) return null;

  const candidates = orders.filter((order) => {
    if (TERMINAL_STATUSES.has(norm(order.status))) return false;
    if (invoice.location_id && order.location_id && order.location_id !== invoice.location_id) {
      return false;
    }
    return true;
  });
  if (!candidates.length) return null;

  // Tier 1: exact reference match.
  const refs = new Set(
    [invoice.po_number, invoice.vendor_reference, invoice.invoice_number].map(code).filter(Boolean)
  );
  if (refs.size) {
    const byRef = candidates.find((order) =>
      [order.order_number, order.po_number, order.vendor_reference]
        .map(code)
        .filter(Boolean)
        .some((value) => refs.has(value))
    );
    if (byRef) return { order: byRef, reason: 'reference', confidence: 'high' };
  }

  // Tier 2: vendor + location + date window, most recent first.
  if (vendorId) {
    const invoiceTime = invoiceDateValue(invoice);
    const earliest = invoiceTime - windowDaysBefore * DAY_MS;
    const latest = invoiceTime + windowDaysAfter * DAY_MS;
    const inWindow = candidates
      .filter((order) => order.vendor_id === vendorId)
      .map((order) => ({ order, time: orderDateValue(order) }))
      .filter(({ time }) => time !== null && time >= earliest && time <= latest)
      .sort((a, b) => b.time - a.time);
    if (inWindow.length) {
      return { order: inWindow[0].order, reason: 'vendor_location_date', confidence: 'medium' };
    }
  }

  return null;
}

export const MATCH_REASON_LABELS = {
  reference: 'Matched by PO / reference',
  vendor_location_date: 'Matched by vendor, location & date',
};
