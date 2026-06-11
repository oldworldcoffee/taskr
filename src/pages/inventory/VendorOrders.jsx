import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { enrichLocationsWithInventorySettings, getVendorCommissaryLocationId, isCommissaryLocation } from '@/lib/inventoryLocations';
import { ShoppingCart, Send, Eye, Trash2, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import PageHeader from '@/components/layout/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { format } from 'date-fns';
import MultiVendorCart from '@/components/orders/MultiVendorCart.jsx';
import OrderHistory from '@/components/orders/OrderHistory';
import SmartFillDialog from '@/components/orders/SmartFillDialog';
import AIReviewDialog from '@/components/orders/AIReviewDialog';
import { getOrderUnit, toStockQuantity } from '@/lib/inventoryOrderUnits';

const asArray = (value) => Array.isArray(value) ? value : [];
const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const asNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const money = (value) => asNumber(value).toFixed(2);
const lineTotal = (item) => {
  if (item?.total_cost !== undefined && item?.total_cost !== null && item.total_cost !== '') {
    return asNumber(item.total_cost);
  }
  return asNumber(item?.qty ?? item?.quantity_ordered) * asNumber(item?.unit_cost);
};
const cartTotal = (cart) => asArray(cart).reduce((sum, item) => sum + lineTotal(item), 0);

// Per-line receipt status: an explicit line_status wins, otherwise derive from
// ordered vs received quantities.
const receiptLineStatus = (item) => {
  if (item?.line_status) return item.line_status;
  const ordered = asNumber(item?.quantity_ordered);
  const received = asNumber(item?.quantity_received);
  if (received <= 0) return 'pending';
  if (received >= ordered) return 'received';
  return 'partial';
};
const LINE_STATUS_BADGE = {
  pending: 'pending', partial: 'partial', received: 'fully_received',
  backordered: 'backstocked', cancelled_by_vendor: 'cancelled',
  not_received: 'cancelled', substitute_received: 'viewed',
};
const LINE_STATUS_LABELS = {
  pending: 'Pending', partial: 'Partial', received: 'Received',
  backordered: 'Backordered', cancelled_by_vendor: 'Cancelled', // by vendor
  not_received: 'Not received', substitute_received: 'Substitute',
};
const purchaseOptionsFor = (item) => Array.isArray(item?.purchase_options) ? item.purchase_options : [];
const locationSettingsFor = (vendor) => asArray(vendor?.location_settings);
const firstArray = (...values) => values.find(Array.isArray) || [];


export default function VendorOrders() {
  const { canAccessLocation, user, companyId } = useAuth();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [locations, setLocations] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [items, setItems] = useState([]);
  const [locInv, setLocInv] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('history'); // 'history' | 'cart'
  const [selectedLocation, setSelectedLocation] = useState('');
  const [selectedVendor, setSelectedVendor] = useState('');
  const [carts, setCarts] = useState({}); // {vendorId: [{item, qty, unit_cost, ...}]}
  const [emailDialog, setEmailDialog] = useState(null);
  const [emailBody, setEmailBody] = useState('');
  const [emailDeliveryDate, setEmailDeliveryDate] = useState('');
  const [sending, setSending] = useState(false);
  const [viewDialog, setViewDialog] = useState(null);
  const [viewReceiving, setViewReceiving] = useState([]);
  const [closingOrder, setClosingOrder] = useState(false);
  const [editDialog, setEditDialog] = useState(null);
  const [smartFillDialog, setSmartFillDialog] = useState(false);
  const [aiReviewDialog, setAiReviewDialog] = useState(false);
  const [pendingOrderItems, setPendingOrderItems] = useState(null);
  const [pendingVendorId, setPendingVendorId] = useState(null);
  const [pendingOrderType, setPendingOrderType] = useState('vendor');
  const [deleteDialog, setDeleteDialog] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [sendCancellationEmail, setSendCancellationEmail] = useState(false);

  const load = async () => {
    if (!companyId) {
      setLocations([]);
      setVendors([]);
      setItems([]);
      setLocInv([]);
      setOrders([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [locs, settings, vends, itms, linv, ords] = await Promise.all([
        base44.entities.Location.filter({ is_active: true, company_id: companyId }),
        base44.entities.InventoryLocationSetting.filter({ company_id: companyId }),
        base44.entities.Vendor.filter({ is_active: true, company_id: companyId }),
        base44.entities.InventoryItem.filter({ is_active: true, company_id: companyId }),
        base44.entities.LocationInventory.filter({ company_id: companyId }),
        base44.entities.Order.filter({ company_id: companyId }, '-created_date', 50),
      ]);
      const enrichedLocations = enrichLocationsWithInventorySettings(asArray(locs), asArray(settings));
      const accessibleLocs = enrichedLocations.filter(l => canAccessLocation(l.id));
      const accessibleLocIds = new Set(accessibleLocs.map(l => l.id));
      setLocations(accessibleLocs);
      setVendors(asArray(vends));
      setItems(asArray(itms));
      setLocInv(asArray(linv));
      setOrders(asArray(ords).filter(o => accessibleLocIds.has(o.location_id)));
    } catch (error) {
      console.error('Failed to load orders page:', error);
      toast.error('Orders could not load. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [companyId]);

  const getLocInv = (itemId) => locInv.find(l => l.location_id === selectedLocation && l.item_id === itemId);
  const selectedInventoryLocation = locations.find(l => l.id === selectedLocation);
  const selectedIsCommissary = isCommissaryLocation(selectedInventoryLocation);

  const itemHasSupplierVendor = (item, vendorId) => (
    item.vendor_id === vendorId ||
    purchaseOptionsFor(item).some(p => p.vendor_id === vendorId)
  );

  const getSupplierVendorForItem = (item) => {
    if (selectedVendor && itemHasSupplierVendor(item, selectedVendor)) return selectedVendor;
    const purchaseOptions = purchaseOptionsFor(item);
    const preferred = purchaseOptions.find(p => p.is_preferred);
    const firstPurchaseOptionVendorId = purchaseOptions[0]?.vendor_id;

    if (selectedIsCommissary && item.is_commissary_item) {
      return preferred?.vendor_id ||
        firstPurchaseOptionVendorId ||
        (item.vendor_id !== item.commissary_vendor_id ? item.vendor_id : null) ||
        null;
    }

    return preferred?.vendor_id || item.vendor_id || firstPurchaseOptionVendorId || null;
  };

  const matchesSelectedVendor = (item) => {
    if (!selectedVendor) return true;
    if (selectedIsCommissary) return itemHasSupplierVendor(item, selectedVendor);
    if (item.is_commissary_item && item.commissary_vendor_id) {
      return item.commissary_vendor_id === selectedVendor;
    }
    return itemHasSupplierVendor(item, selectedVendor);
  };

  const getVendorForItem = (item) => {
    if (selectedIsCommissary) return getSupplierVendorForItem(item);

    // Retail locations order commissary-made items from the commissary vendor.
    if (item.is_commissary_item && item.commissary_vendor_id) {
      return item.commissary_vendor_id;
    }

    return getSupplierVendorForItem(item);
  };

  const getUnitCostForItem = (item, vendorId) => {
    // Retail locations see the internal commissary price. Commissary locations
    // see their supplier's vendor pricing.
    const vendor = vendors.find(v => v.id === vendorId);
    if (!selectedIsCommissary && vendor?.is_commissary && item.is_commissary_item) {
      return asNumber(item.commissary_price);
    }
    // Otherwise use regular vendor pricing
    const purchaseOptions = purchaseOptionsFor(item);
    const preferred = purchaseOptions.find(p => p.vendor_id === vendorId && p.is_preferred) || 
                     purchaseOptions.find(p => p.vendor_id === vendorId);
    return asNumber(preferred?.unit_cost ?? item.unit_cost);
  };

  const getCatalogItem = (itemId) => items.find(i => i.id === itemId) || null;

  const getCartItemDetails = (cartItem) => {
    const catalogItem = getCatalogItem(cartItem.item_id || cartItem.id) || {};
    return {
      ...catalogItem,
      ...cartItem,
      id: cartItem.item_id || cartItem.id,
      name: cartItem.item_name || cartItem.name || catalogItem.name,
      item_name: cartItem.item_name || cartItem.name || catalogItem.name,
      unit_of_measure: cartItem.base_unit_of_measure || catalogItem.unit_of_measure || cartItem.unit_of_measure,
      purchase_options: purchaseOptionsFor(cartItem).length ? purchaseOptionsFor(cartItem) : purchaseOptionsFor(catalogItem),
      count_units: asArray(cartItem.count_units).length ? asArray(cartItem.count_units) : asArray(catalogItem.count_units),
      inner_pack_name: cartItem.inner_pack_name || catalogItem.inner_pack_name,
      inner_pack_units: cartItem.inner_pack_units || catalogItem.inner_pack_units,
      packs_per_case: cartItem.packs_per_case || catalogItem.packs_per_case,
    };
  };

  const buildCartItem = ({ item, vendorId, qty, unitCost, onHand = 0, parLevel = 0 }) => {
    const orderUnit = getOrderUnit(item, vendorId);
    const orderQty = asNumber(qty);
    const cost = asNumber(unitCost);
    return {
      item_id: item.id,
      item_name: item.name || item.item_name || 'Unnamed item',
      category: item.category,
      unit_of_measure: orderUnit.label,
      base_unit_of_measure: orderUnit.baseUnit,
      order_unit_label: orderUnit.label,
      order_unit_multiplier: orderUnit.multiplier,
      stock_quantity_ordered: toStockQuantity(orderQty, orderUnit),
      unit_cost: cost,
      qty: orderQty,
      total_cost: orderQty * cost,
      on_hand: asNumber(onHand),
      par_level: asNumber(parLevel),
      purchase_options: purchaseOptionsFor(item),
      selected_purchase_option: orderUnit.option || null,
      variant_id: item.variant_id || null,
      variant_name: item.variant_name || null,
    };
  };

  const buildOrderItem = (cartItem, vendorId) => {
    const itemDetails = getCartItemDetails(cartItem);
    const orderUnit = getOrderUnit(itemDetails, vendorId);
    const qty = asNumber(cartItem.qty);
    const unitCost = asNumber(cartItem.unit_cost);

    return {
      item_id: cartItem.item_id,
      item_name: cartItem.item_name || itemDetails.name || 'Unnamed item',
      category: cartItem.category,
      unit_of_measure: cartItem.order_unit_label || orderUnit.label,
      base_unit_of_measure: cartItem.base_unit_of_measure || orderUnit.baseUnit,
      order_unit_label: cartItem.order_unit_label || orderUnit.label,
      order_unit_multiplier: cartItem.order_unit_multiplier || orderUnit.multiplier,
      stock_quantity_ordered: cartItem.stock_quantity_ordered ?? toStockQuantity(qty, orderUnit),
      quantity_ordered: qty,
      unit_cost: unitCost,
      total_cost: lineTotal({ ...cartItem, qty, unit_cost: unitCost }),
      selected_purchase_option: cartItem.selected_purchase_option || orderUnit.option || null,
      variant_id: cartItem.variant_id || null,
      variant_quantities: cartItem.variant_quantities || null,
    };
  };

  const fillToPars = (useAI = false) => {
    if (!selectedLocation) return;
    
    if (useAI) {
      setSmartFillDialog(true);
      return;
    }
    
    const newCarts = { ...carts };
    
    items.forEach(item => {
      if (!matchesSelectedVendor(item)) return;
      const vendorId = getVendorForItem(item);
      if (!vendorId) return;
      
      const li = getLocInv(item.id);
      const onHand = asNumber(li?.on_hand_quantity);
      const par = asNumber(li?.par_level);
      const needed = Math.max(0, par - onHand);
      
      if (needed > 0) {
        newCarts[vendorId] = asArray(newCarts[vendorId]);
        const existing = newCarts[vendorId].findIndex(c => c.item_id === item.id);
        const unitCost = getUnitCostForItem(item, vendorId);
        const orderUnit = getOrderUnit(item, vendorId);
        const orderQty = Math.ceil(needed / Math.max(orderUnit.multiplier || 1, 1));
        const nextCartItem = buildCartItem({
          item,
          vendorId,
          qty: orderQty,
          unitCost,
          onHand,
          parLevel: par,
        });
        
        if (existing >= 0) {
          newCarts[vendorId][existing] = { ...newCarts[vendorId][existing], ...nextCartItem };
        } else {
          newCarts[vendorId].push(nextCartItem);
        }
      }
    });
    
    setCarts(Object.fromEntries(Object.entries(newCarts).filter(([_, cart]) => asArray(cart).filter(c => c.qty > 0).length > 0)));
  };

  const handleSmartFillConfirm = (results) => {
    // Use AI suggested pars instead of manual pars
    if (!selectedLocation) return;
    const suggestedRowsByItemId = new Map(
      asArray(results?.results)
        .filter(row => row.status === 'updated' && row.item_id)
        .map(row => [row.item_id, row])
    );
    setItems(prevItems => asArray(prevItems).map(item => {
      const suggestion = suggestedRowsByItemId.get(item.id);
      return suggestion
        ? {
            ...item,
            ai_suggested_par: suggestion.suggested_par,
            minimum_reorder_volume: suggestion.minimum_reorder_volume,
          }
        : item;
    }));

    const newCarts = { ...carts };
    
    items.forEach(item => {
      if (!matchesSelectedVendor(item)) return;
      const vendorId = getVendorForItem(item);
      if (!vendorId) return;
      
      const li = getLocInv(item.id);
      const onHand = asNumber(li?.on_hand_quantity);
      const suggestedRow = suggestedRowsByItemId.get(item.id);
      const aiPar = asNumber(suggestedRow?.suggested_par ?? item.ai_suggested_par);
      const needed = Math.max(0, aiPar - onHand);
      
      if (needed > 0) {
        newCarts[vendorId] = asArray(newCarts[vendorId]);
        const existing = newCarts[vendorId].findIndex(c => c.item_id === item.id);
        const unitCost = getUnitCostForItem(item, vendorId);
        const orderUnit = getOrderUnit(item, vendorId);
        const orderQty = Math.ceil(needed / Math.max(orderUnit.multiplier || 1, 1));
        const nextCartItem = buildCartItem({
          item,
          vendorId,
          qty: orderQty,
          unitCost,
          onHand,
          parLevel: aiPar,
        });
        
        if (existing >= 0) {
          newCarts[vendorId][existing] = { ...newCarts[vendorId][existing], ...nextCartItem };
        } else {
          newCarts[vendorId].push(nextCartItem);
        }
      }
    });
    
    setCarts(Object.fromEntries(Object.entries(newCarts).filter(([_, cart]) => asArray(cart).filter(c => c.qty > 0).length > 0)));
  };

  const addToCart = (item, vendorId, qty = 1) => {
    let targetVendor;
    if (selectedIsCommissary) {
      targetVendor = vendorId || getSupplierVendorForItem(item);
    } else {
      targetVendor = (item.is_commissary_item && item.commissary_vendor_id) 
        ? item.commissary_vendor_id 
        : (vendorId || getVendorForItem(item));
    }
    if (!targetVendor) return;
    
    // Use functional update to handle rapid successive calls
    setCarts(prevCarts => {
      const newCarts = { ...prevCarts };
      newCarts[targetVendor] = asArray(newCarts[targetVendor]);
      
      const existing = newCarts[targetVendor].findIndex(c => c.item_id === item.id);
      const li = locInv.find(l => l.location_id === selectedLocation && l.item_id === item.id);
      const unitCost = getUnitCostForItem(item, targetVendor);
      
      if (existing >= 0) {
        const nextQty = asNumber(newCarts[targetVendor][existing].qty) + asNumber(qty);
        newCarts[targetVendor][existing] = {
          ...newCarts[targetVendor][existing],
          ...buildCartItem({
            item,
            vendorId: targetVendor,
            qty: nextQty,
            unitCost,
            onHand: newCarts[targetVendor][existing].on_hand,
            parLevel: newCarts[targetVendor][existing].par_level,
          }),
        };
      } else {
        newCarts[targetVendor].push(buildCartItem({
          item,
          vendorId: targetVendor,
          qty: asNumber(qty),
          unitCost,
          onHand: asNumber(li?.on_hand_quantity),
          parLevel: asNumber(li?.par_level),
        }));
      }
      return newCarts;
    });
  };

  const addVariantToCart = (variantItem, vendorId, qty = 1) => {
    // Same as addToCart but for variant items
    addToCart(variantItem, vendorId, qty);
  };

  const updateCartQty = (vendorId, idx, val) => {
    const qty = Math.max(0, parseFloat(val) || 0);
    const newCarts = { ...carts };
    if (!newCarts[vendorId]) return;
    const current = newCarts[vendorId][idx];
    const orderUnit = getOrderUnit(getCartItemDetails(current), vendorId);
    newCarts[vendorId][idx] = {
      ...current,
      qty,
      total_cost: qty * asNumber(current.unit_cost),
      stock_quantity_ordered: toStockQuantity(qty, orderUnit),
    };
    setCarts(newCarts);
  };

  const removeFromCart = (vendorId, idx) => {
    const newCarts = { ...carts };
    if (!newCarts[vendorId]) return;
    newCarts[vendorId] = asArray(newCarts[vendorId]).filter((_, i) => i !== idx);
    if (newCarts[vendorId].length === 0) delete newCarts[vendorId];
    setCarts(newCarts);
  };

  const clearCart = (vendorId) => {
    const newCarts = { ...carts };
    if (vendorId) {
      delete newCarts[vendorId];
    } else {
      Object.keys(newCarts).forEach(key => delete newCarts[key]);
    }
    setCarts(newCarts);
  };

  const editDraftOrder = (order) => {
    const vendorId = order.vendor_id;
    setCarts({
      [vendorId]: asArray(order.items).map(i => {
        const itemDetails = getCartItemDetails(i);
        const orderUnit = getOrderUnit(itemDetails, vendorId);
        const qty = asNumber(i.quantity_ordered);
        const unitCost = asNumber(i.unit_cost);
        return {
          item_id: i.item_id,
          item_name: i.item_name,
          category: i.category,
          unit_of_measure: i.order_unit_label || orderUnit.label,
          base_unit_of_measure: i.base_unit_of_measure || orderUnit.baseUnit,
          order_unit_label: i.order_unit_label || orderUnit.label,
          order_unit_multiplier: i.order_unit_multiplier || orderUnit.multiplier,
          stock_quantity_ordered: i.stock_quantity_ordered ?? toStockQuantity(qty, orderUnit),
          unit_cost: unitCost,
          qty,
          total_cost: lineTotal({ ...i, qty, unit_cost: unitCost }),
          on_hand: 0,
          par_level: 0,
          selected_purchase_option: i.selected_purchase_option || orderUnit.option || null,
          purchase_options: purchaseOptionsFor(itemDetails),
          variant_id: i.variant_id || null,
          variant_quantities: i.variant_quantities || null,
        };
      })
    });
    setSelectedLocation(order.location_id);
    setSelectedVendor(vendorId);
    setEditDialog(order);
  };

  const updateDraftOrder = async () => {
    const vendorId = editDialog.vendor_id;
    const vendorCart = asArray(carts[vendorId]);
    const orderItems = asArray(vendorCart).filter(i => i.qty > 0).map(i => buildOrderItem(i, vendorId));
    const totalAmount = cartTotal(vendorCart);
    await base44.entities.Order.update(editDialog.id, {
      items: orderItems,
      total_amount: totalAmount,
    });
    await load();
    const newCarts = { ...carts };
    delete newCarts[vendorId];
    setCarts(newCarts);
    setEditDialog(null);
    setView('history');
  };

  const getCartTotal = (vendorId) => {
    const vendorCart = asArray(carts[vendorId]);
    return cartTotal(vendorCart);
  };

  const getAllCartsTotal = () => {
    return Object.values(asObject(carts)).reduce((total, vendorCart) => total + cartTotal(vendorCart), 0);
  };

  const createOrder = async (vendorId) => {
    const vendorCart = asArray(carts[vendorId]);
    const orderItems = asArray(vendorCart).filter(i => i.qty > 0).map(i => buildOrderItem(i, vendorId));
    
    // Determine order type based on vendor
    const vendor = vendors.find(v => v.id === vendorId);
    const orderType = vendor?.is_commissary ? 'commissary' : 'vendor';
    
    // Trigger AI review before creating order
    setPendingOrderItems(orderItems);
    setPendingVendorId(vendorId);
    setPendingOrderType(orderType);
    setAiReviewDialog(true);
  };

  // Given a vendor and location, calculate the next expected delivery date based on cutoff rules.
  // delivery_days entries have: day (e.g. "Thursday"), cutoff_day (e.g. "Wednesday"), cutoff_time (e.g. "5:00 PM")
  const calcNextDeliveryDate = (vendor, locationId) => {
    if (!vendor) return '';
    const locSettings = locationSettingsFor(vendor).find(s => s.location_id === locationId);
    const deliveryDays = firstArray(locSettings?.delivery_days, vendor.default_delivery_days, vendor.delivery_days);
    const enabledDays = deliveryDays.filter(d => d.enabled && d.cutoff_day && d.cutoff_time);
    if (enabledDays.length === 0) return '';

    const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const now = new Date();

    const parseCutoffTime = (timeStr) => {
      if (!timeStr) return null;
      const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
      if (!match) return null;
      let h = parseInt(match[1]);
      const m = parseInt(match[2]);
      const ampm = (match[3] || '').toUpperCase();
      if (ampm === 'PM' && h < 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      return { h, m };
    };

    let bestDelivery = null;

    for (const entry of enabledDays) {
      const cutoffDayIdx = DAY_NAMES.indexOf(entry.cutoff_day);
      const deliveryDayIdx = DAY_NAMES.indexOf(entry.day);
      if (cutoffDayIdx === -1 || deliveryDayIdx === -1) continue;

      const cutoffTime = parseCutoffTime(entry.cutoff_time);
      if (!cutoffTime) continue;

      const todayIdx = now.getDay();

      // How many days until the next cutoff day (0 = today)
      let daysUntilCutoff = (cutoffDayIdx - todayIdx + 7) % 7;

      // If today IS the cutoff day, check if we're still before the cutoff time
      if (daysUntilCutoff === 0) {
        const cutoffDate = new Date(now);
        cutoffDate.setHours(cutoffTime.h, cutoffTime.m, 0, 0);
        if (now >= cutoffDate) {
          // Missed today's cutoff — next occurrence is in 7 days
          daysUntilCutoff = 7;
        }
      }

      // The actual cutoff date
      const cutoffDate = new Date(now);
      cutoffDate.setDate(now.getDate() + daysUntilCutoff);
      cutoffDate.setHours(0, 0, 0, 0);

      // Days from cutoff to delivery — if delivery is on or before cutoff weekday, it's the following week
      let daysBetween = (deliveryDayIdx - cutoffDayIdx + 7) % 7;
      if (daysBetween === 0) daysBetween = 7; // same day = next week

      const deliveryDate = new Date(cutoffDate);
      deliveryDate.setDate(cutoffDate.getDate() + daysBetween);

      if (!bestDelivery || deliveryDate < bestDelivery) {
        bestDelivery = deliveryDate;
      }
    }

    if (!bestDelivery) return '';
    return bestDelivery.toISOString().split('T')[0];
  };

  const handleAIReviewConfirm = async () => {
    // User confirmed AI review, proceed with order creation
    if (!pendingOrderItems || !pendingVendorId) return;
    
    const vendorCart = asArray(carts[pendingVendorId]);
    const totalAmount = cartTotal(vendorCart);
    const vendor = vendors.find(v => v.id === pendingVendorId);
    const isNonEmailVendor = pendingOrderType === 'commissary' || vendor?.order_type === 'online' || vendor?.order_type === 'instore';
    const order = await base44.entities.Order.create({
      company_id: companyId,
      type: pendingOrderType,
      status: isNonEmailVendor ? 'sent' : 'draft',
      location_id: selectedLocation,
      vendor_id: pendingVendorId,
      items: pendingOrderItems,
      total_amount: totalAmount,
      order_number: `${pendingOrderType === 'commissary' ? 'CO' : 'VO'}-${Date.now().toString().slice(-6)}`,
    });
    await load();
    const newCarts = { ...carts };
    delete newCarts[pendingVendorId];
    setCarts(newCarts);
    
    // For commissary orders, create a CommissaryFulfillment record instead of sending email
    if (pendingOrderType === 'commissary') {
      const vendor = vendors.find(v => v.id === pendingVendorId);
      const commissaryLocationId =
        getVendorCommissaryLocationId(vendor, locations) ||
        locations.find(isCommissaryLocation)?.id ||
        vendor?.id;
      await base44.entities.CommissaryFulfillment.create({
        company_id: companyId,
        order_id: order.id,
        order_number: order.order_number,
        retail_location_id: selectedLocation,
        commissary_location_id: commissaryLocationId,
        items: asArray(pendingOrderItems).map(i => ({
          item_id: i.item_id,
          item_name: i.item_name,
          unit_of_measure: i.unit_of_measure,
          base_unit_of_measure: i.base_unit_of_measure,
          order_unit_label: i.order_unit_label,
          order_unit_multiplier: i.order_unit_multiplier,
          quantity_ordered: i.quantity_ordered,
          stock_quantity_ordered: i.stock_quantity_ordered,
          quantity_fulfilled: i.quantity_ordered,
          stock_quantity_fulfilled: i.stock_quantity_ordered,
          unit_cost: i.unit_cost,
          total_cost: i.total_cost,
        })),
        status: 'pending',
        fulfillment_date: new Date().toISOString(),
      });
      toast.success('Commissary order placed! View it in the Commissary dashboard.');
      setView('history');
    } else {
      const vendor = vendors.find(v => v.id === pendingVendorId);
      if (vendor?.order_type === 'online' || vendor?.order_type === 'instore') {
        // Online/instore: order is already created as 'sent', user handles it in their respective pages
        const dest = vendor.order_type === 'online' ? 'Online Orders' : 'In-Store Shopping';
        toast.success(`Order created! View it in ${dest}.`);
        setView('history');
      } else {
        // Email vendors: show email dialog
        const loc = locations.find(l => l.id === selectedLocation);
        const autoDeliveryDate = calcNextDeliveryDate(vendor, selectedLocation);
        setEmailDeliveryDate(autoDeliveryDate);
        setEmailBody('');
        setEmailDialog({ order, vendor, loc, items: pendingOrderItems, totalAmount });
        setView('history');
      }
    }
    
    // Clear pending state and close AI review dialog
    setPendingOrderItems(null);
    setPendingVendorId(null);
    setPendingOrderType('vendor');
    setAiReviewDialog(false);
  };

  const createAllOrders = async () => {
    for (const vendorId of Object.keys(asObject(carts))) {
      await createOrder(vendorId);
    }
    setView('history');
  };

  const buildEmailHtml = (type = 'new') => {
    const { order, vendor, loc, items: orderItems, totalAmount } = emailDialog;
    const sentAt = format(new Date(), 'MM/dd/yyyy, hh:mm aa');
    const deliveryDate = emailDeliveryDate 
      ? format(new Date(emailDeliveryDate + 'T12:00:00'), 'MM/dd/yyyy')
      : 'TBD';

    if (type === 'cancellation') {
      return `
<p><strong>CANCELLATION NOTICE</strong></p>
<p>The following order from <strong>${loc?.name}</strong> to <strong>${vendor?.name}</strong> has been CANCELLED.</p>
<p><strong>Order number:</strong> ${order.order_number}</p>
<p><strong>Order cancelled on:</strong> ${sentAt}</p>
<p><strong>Cancelled by:</strong> ${user?.full_name || '—'}</p>
<br/>
<p>Customer details:<br/>
Phone: ${loc?.phone || '—'}<br/>
Address: ${loc?.address || '—'}</p>
      `.trim();
    }

    return `
<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#333;">
  <h1 style="color:#16a34a;text-align:center;margin:20px 0 10px;font-size:28px;">New Order</h1>
  <p style="text-align:center;color:#666;margin:0 0 20px;font-size:14px;">From: <strong>${loc?.business_name ? loc.business_name + ' - ' : ''}${loc?.name || '—'}</strong> • ${sentAt} • Order No. <strong>${order.order_number}</strong></p>
  
  <div style="text-align:center;margin:25px 0;">
    <a href="TRACKING_PLACEHOLDER_CONFIRM" style="display:inline-block;padding:14px 40px;background-color:#16a34a;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:16px;">View Order Details</a>
    <p style="color:#999;font-size:12px;margin-top:10px;">Click above to view the full order details online</p>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:30px;margin:30px 0;border-bottom:3px solid #16a34a;padding-bottom:30px;">
    <div>
      <p style="color:#999;font-size:12px;text-transform:uppercase;margin-bottom:5px;">Location</p>
      <h2 style="margin:0 0 15px;font-size:18px;">${loc?.business_name ? loc.business_name + ' - ' : ''}${loc?.name || '—'}</h2>
    </div>
    <div>
      <p style="color:#999;font-size:12px;text-transform:uppercase;margin-bottom:5px;">Delivery Date</p>
      <h2 style="margin:0;font-size:18px;color:#16a34a;">${deliveryDate}</h2>
    </div>
  </div>

  <div style="background:#f9fafb;padding:20px;border-radius:6px;margin:30px 0;">
    <h3 style="margin:0 0 15px;text-transform:uppercase;color:#666;font-size:12px;">Customer Details</h3>
    <p style="margin:8px 0;"><strong>Ordered by:</strong> ${user?.full_name || '—'}</p>
    <p style="margin:8px 0;"><strong>Phone:</strong> ${loc?.phone || '—'}</p>
    <p style="margin:8px 0;"><strong>Address:</strong> ${loc?.address || '—'}</p>
  </div>
</div>
    `.trim();
  };

  const sendEmail = async () => {
    if (sending) return; // Prevent double-click
    setSending(true);
    const htmlBody = buildEmailHtml();
    const vendor = emailDialog.vendor;

    try {
      // Fetch company logo
      const settings = await base44.entities.BrandSettings.filter({ company_id: companyId });
      const brandSettings = asArray(settings);
      const logoUrl = brandSettings.length > 0 ? brandSettings[0].logo_url : null;

      // Resolve to/cc emails: use location-specific settings if available, else vendor defaults
      const locSettings = locationSettingsFor(vendor).find(s => s.location_id === emailDialog.loc?.id);
      const toEmail = locSettings?.order_email || vendor.default_order_email || vendor.email;
      const ccEmail = locSettings?.cc_email || vendor.default_cc_email || '';

      const result = await base44.functions.invoke('sendVendorOrderEmail', {
        orderId: emailDialog.order.id,
        toEmail,
        ccEmail: ccEmail || undefined,
        subject: `Purchase Order — ${emailDialog.order.order_number}`,
        htmlBody,
        logoUrl,
        appUrl: window.location.origin,
      });

      await load();
      setEmailDialog(null);

      // The backend logs the email even when no email provider is configured
      // (provider 'local-log'), so a 200 doesn't guarantee delivery. Only claim
      // it was sent when the provider actually accepted it.
      const delivered = result?.data?.email?.status === 'sent';
      if (delivered) {
        toast.success('Order email sent!');
      } else {
        toast.warning('Order recorded, but the email was NOT delivered — email sending isn’t configured for this environment. The vendor did not receive anything.');
      }
    } catch (error) {
      console.error('Failed to send email:', error);
      toast.error('Failed to send email. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const deleteOrder = async (sendCancellation = false) => {
    if (!deleteDialog) return;
    setDeleting(true);
    try {
      if (sendCancellation) {
        // Send cancellation email first
        const vendor = vendors.find(v => v.id === deleteDialog.vendor_id);
        const loc = locations.find(l => l.id === deleteDialog.location_id);
        const locSettings = locationSettingsFor(vendor).find(s => s.location_id === deleteDialog.location_id);
        const toEmail = locSettings?.order_email || vendor?.default_order_email || vendor?.email;
        const ccEmail = locSettings?.cc_email || vendor?.default_cc_email || '';
        
        // Build cancellation email HTML
        const items = asArray(deleteDialog.items);
        const totalAmount = asNumber(deleteDialog.total_amount);
        const cancelledAt = format(new Date(), 'MM/dd/yyyy, hh:mm aa');
        const rows = items.map(i => `
        <tr>
          <td style="border:1px solid #ccc;padding:6px 10px;">${i.item_name}</td>
          <td style="border:1px solid #ccc;padding:6px 10px;text-align:center;">${i.quantity_ordered}</td>
          <td style="border:1px solid #ccc;padding:6px 10px;">${i.quantity_ordered} Total (${i.unit_of_measure})</td>
          <td style="border:1px solid #ccc;padding:6px 10px;">$${money(i.unit_cost)}</td>
          <td style="border:1px solid #ccc;padding:6px 10px;">$${money(lineTotal(i))}</td>
        </tr>`).join('');
        
        const htmlBody = `
<p><strong>CANCELLATION NOTICE</strong></p>
<p>The following order from <strong>${loc?.business_name ? loc.business_name + ' - ' : ''}${loc?.name}</strong> to <strong>${vendor?.name}</strong> has been CANCELLED.</p>
<p><strong>Order number:</strong> ${deleteDialog.order_number}</p>
<p><strong>Order cancelled on:</strong> ${cancelledAt}</p>
<p><strong>Cancelled by:</strong> ${user?.full_name || '—'}</p>
<br/>
<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
  <thead>
    <tr style="background:#f5f5f5;">
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:left;">Product Name</th>
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:center;">Qty</th>
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:left;">Total Qty</th>
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:left;">Price</th>
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:left;">Total</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr style="background:#f5f5f5;">
      <td colspan="4" style="border:1px solid #ccc;padding:6px 10px;text-align:right;font-weight:bold;">Sub Total:</td>
      <td style="border:1px solid #ccc;padding:6px 10px;font-weight:bold;">$${money(totalAmount)}</td>
    </tr>
  </tfoot>
</table>
<br/>
<p>Customer details:<br/>
Phone: ${loc?.phone || '—'}<br/>
Address: ${loc?.address || '—'}</p>
      `.trim();
        
        // Fetch company logo
        const settings = await base44.entities.BrandSettings.filter({ company_id: companyId });
        const brandSettings = asArray(settings);
        const logoUrl = brandSettings.length > 0 ? brandSettings[0].logo_url : null;
        
        await base44.functions.invoke('cancelVendorOrderEmail', {
          orderId: deleteDialog.id,
          toEmail,
          ccEmail: ccEmail || undefined,
          subject: `CANCELLED: Order ${deleteDialog.order_number}`,
          htmlBody,
          logoUrl,
          appUrl: window.location.origin,
        });
      }
      
      await base44.entities.Order.delete(deleteDialog.id);
      await load();
      setDeleteDialog(null);
      setSendCancellationEmail(false);
      toast.success(sendCancellation ? 'Cancellation email sent and order deleted' : 'Order deleted');
    } catch (error) {
      console.error('Failed to delete order:', error);
      toast.error('Order could not be deleted. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const locName = (id) => locations.find(l => l.id === id)?.name || '—';
  const vendorName = (id) => vendors.find(v => v.id === id)?.name || '—';

  const refreshOrders = async () => {
    try {
      const ords = await base44.entities.Order.filter({ company_id: companyId }, '-created_date', 50);
      const accessibleLocIds = new Set(locations.map(l => l.id));
      setOrders(asArray(ords).filter(o => accessibleLocIds.has(o.location_id)));
    } catch (error) {
      console.error('Failed to refresh orders:', error);
      toast.error('Orders could not refresh. Please try again.');
    }
  };

  const openOrderDetail = async (order) => {
    let freshOrder = await base44.entities.Order.get(order.id);
    setViewDialog(freshOrder);
    setViewReceiving([]);
    try {
      const events = await base44.entities.ReceivingEvent.filter({ order_id: order.id }, '-received_date');
      setViewReceiving(asArray(events));
      // Self-heal: recompute received quantities + status from receiving events
      // (covers orders received before the roll-up existed). Persist only if it
      // actually changed, and never override a manual close/cancel.
      const synced = await syncOrderFromReceiving(freshOrder, asArray(events));
      if (synced) {
        freshOrder = synced;
        setViewDialog(synced);
        setOrders(prev => prev.map(o => (o.id === synced.id ? { ...o, ...synced } : o)));
      }
    } catch (error) {
      console.error('Failed to load receiving history:', error);
    }
  };

  // Recompute an order's per-line received quantities and status from its
  // receiving events. Returns the updated order if anything changed, else null.
  const syncOrderFromReceiving = async (order, events) => {
    if (!order || ['closed', 'cancelled'].includes(order.status) || !events.length) return null;
    const receivedByItem = {};
    for (const ev of events) {
      const evLines = await base44.entities.ReceivingLine.filter({ receiving_event_id: ev.id });
      for (const line of asArray(evLines)) {
        if (!line.item_id) continue;
        receivedByItem[line.item_id] = (receivedByItem[line.item_id] || 0) + asNumber(line.quantity_received);
      }
    }
    const items = asArray(order.items).map(it => ({ ...it, quantity_received: receivedByItem[it.item_id] || 0 }));
    const anyReceived = items.some(it => asNumber(it.quantity_received) > 0);
    const allReceived = items.length > 0 && items.every(it =>
      asNumber(it.quantity_ordered) > 0 && asNumber(it.quantity_received) >= asNumber(it.quantity_ordered));
    const status = allReceived ? 'fully_received' : (anyReceived ? 'partially_received' : order.status);
    const changed = status !== order.status ||
      items.some((it, i) => asNumber(it.quantity_received) !== asNumber(asArray(order.items)[i]?.quantity_received));
    if (!changed) return null;
    return base44.entities.Order.update(order.id, {
      items, status, received_at: anyReceived ? (order.received_at || new Date().toISOString()) : order.received_at,
    });
  };

  // Manually close an incomplete order, or reopen a closed one (recomputing its
  // received status from line quantities).
  const toggleOrderClosed = async () => {
    if (!viewDialog) return;
    setClosingOrder(true);
    try {
      let patch;
      if (viewDialog.status === 'closed') {
        const its = asArray(viewDialog.items);
        const anyReceived = its.some(i => asNumber(i.quantity_received) > 0);
        const allReceived = its.length > 0 && its.every(i =>
          asNumber(i.quantity_ordered) > 0 && asNumber(i.quantity_received) >= asNumber(i.quantity_ordered));
        patch = { status: allReceived ? 'fully_received' : (anyReceived ? 'partially_received' : 'ordered'), closed_at: null, close_reason: null };
      } else {
        patch = { status: 'closed', closed_at: new Date().toISOString() };
      }
      await base44.entities.Order.update(viewDialog.id, patch);
      setViewDialog(prev => prev ? { ...prev, ...patch } : prev);
      await refreshOrders();
      toast.success(patch.status === 'closed' ? 'Order closed.' : 'Order reopened.');
    } catch (error) {
      toast.error(error.message || 'Failed to update order');
    } finally {
      setClosingOrder(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className={isMobile ? "p-4 max-w-full" : "p-6 max-w-7xl mx-auto"}>
      <PageHeader
        title="Vendor Orders"
        subtitle="Browse items and place purchase orders"
        actions={
          <div className="flex gap-2">
            <Button variant={view === 'history' ? 'secondary' : 'outline'} onClick={() => setView('history')}>
              <Eye className="w-4 h-4 mr-1" />Order History
            </Button>
            <Button variant={view === 'cart' ? 'default' : 'outline'} onClick={() => setView('cart')}>
              <ShoppingCart className="w-4 h-4 mr-1" />
              New Order
              {(() => { const count = Object.values(asObject(carts)).reduce((sum, cart) => sum + asArray(cart).length, 0); return count > 0 ? <span className="ml-1 bg-white text-primary rounded-full text-xs w-5 h-5 flex items-center justify-center font-bold">{count}</span> : null; })()}
            </Button>
          </div>
        }
      />

      {view === 'history' ? (
        <OrderHistory 
        orders={orders} 
        locName={locName} 
        vendorName={vendorName} 
        onView={openOrderDetail}
        onEdit={editDraftOrder} 
        onDelete={setDeleteDialog} 
      />
      ) : (
        <MultiVendorCart
          locations={locations}
          vendors={vendors}
          items={items}
          locInv={locInv}
          selectedLocation={selectedLocation}
          selectedVendor={selectedVendor}
          carts={carts}
          onSelectLocation={setSelectedLocation}
          onSelectVendor={setSelectedVendor}
          onAddToCart={addToCart}
          onUpdateQty={updateCartQty}
          onRemove={removeFromCart}
          onClearCart={clearCart}
          onFillToPar={fillToPars}
          onCreateOrder={createOrder}
          onCreateAllOrders={createAllOrders}
        />
      )}

      {/* Email Draft Dialog */}
      <Dialog open={!!emailDialog} onOpenChange={() => setEmailDialog(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Review & Send Order Email</DialogTitle></DialogHeader>
          {emailDialog && (
            <div className="space-y-3 py-2">
              <div className="bg-muted/50 rounded-lg px-3 py-2 text-sm">
                <span className="text-muted-foreground">To: </span>
                <span className="font-medium">{emailDialog.vendor?.email}</span>
              </div>

              {/* Minimum order warning */}
              {(() => {
                const vendor = emailDialog.vendor;
                const locSettings = locationSettingsFor(vendor).find(s => s.location_id === emailDialog.loc?.id);
                const minType = locSettings?.min_order_type || vendor?.default_min_order_type || 'none';
                const minValue = parseFloat(locSettings?.min_order_value || vendor?.default_min_order_value || 0);
                const total = asNumber(emailDialog.totalAmount);
                const cartItems = asArray(emailDialog.items);

                if (minType === 'dollar' && minValue > 0 && total < minValue) {
                  return (
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-sm">
                      <span className="text-amber-500 text-base leading-none mt-0.5">⚠️</span>
                      <div>
                        <p className="font-medium text-amber-800">Below minimum order</p>
                        <p className="text-amber-700 text-xs mt-0.5">
                          This order is <strong>${money(total)}</strong>, but {vendor?.name} requires a minimum of <strong>${money(minValue)}</strong>. You can still send it, but the vendor may reject it.
                        </p>
                      </div>
                    </div>
                  );
                }
                if (minType === 'cases' && minValue > 0 && cartItems.length < minValue) {
                  return (
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-sm">
                      <span className="text-amber-500 text-base leading-none mt-0.5">⚠️</span>
                      <div>
                        <p className="font-medium text-amber-800">Below minimum order</p>
                        <p className="text-amber-700 text-xs mt-0.5">
                          This order has <strong>{cartItems.length} case(s)</strong>, but {vendor?.name} requires a minimum of <strong>{minValue} cases</strong>. You can still send it, but the vendor may reject it.
                        </p>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Order summary preview */}
              <div className="border border-border rounded-lg overflow-hidden text-sm">
                <div className="bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Order Items</div>
                <table className="w-full">
                  <thead className="bg-muted/20">
                    <tr>
                      {['Product Name', 'Qty', 'Unit Price', 'Total'].map(h => (
                        <th key={h} className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {asArray(emailDialog.items).map((item, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">{item.item_name}</td>
                        <td className="px-3 py-2">{item.quantity_ordered} {item.unit_of_measure}</td>
                        <td className="px-3 py-2">${money(item.unit_cost)}</td>
                        <td className="px-3 py-2 font-medium">${money(lineTotal(item))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/20 border-t border-border">
                    <tr>
                      <td colSpan={3} className="px-3 py-2 text-sm font-semibold text-right">Sub Total:</td>
                      <td className="px-3 py-2 font-bold">${money(emailDialog.totalAmount)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div>
                <Label>Expected Delivery Date</Label>
                <Input className="mt-1" type="date" value={emailDeliveryDate} onChange={e => setEmailDeliveryDate(e.target.value)} />
                {emailDeliveryDate && (
                  <p className="text-xs text-muted-foreground mt-1">Auto-calculated from vendor delivery schedule. You can adjust if needed.</p>
                )}
              </div>
              <div>
                <Label>Order Comments (optional)</Label>
                <Textarea className="mt-1 h-20 text-sm" placeholder="Any special instructions or comments..." value={emailBody} onChange={e => setEmailBody(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailDialog(null)}>Save as Draft</Button>
            <Button onClick={sendEmail} disabled={sending}>
              <Send className="w-4 h-4 mr-1" />{sending ? 'Sending...' : 'Send Email'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Order Dialog */}
      <Dialog open={!!viewDialog} onOpenChange={() => setViewDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Order {viewDialog?.order_number}</DialogTitle></DialogHeader>
          {viewDialog && (
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="break-words"><span className="text-muted-foreground">Location:</span> <span className="font-medium">{locName(viewDialog.location_id)}</span></div>
                <div className="break-words"><span className="text-muted-foreground">Vendor:</span> <span className="font-medium">{vendorName(viewDialog.vendor_id)}</span></div>
                <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={viewDialog.status} /></div>
                <div><span className="text-muted-foreground">Fulfilled:</span> <span className="font-bold text-green-600">${money(asArray(viewDialog.items).reduce((sum, item) => sum + (asNumber(item.quantity_received) * asNumber(item.unit_cost)), 0))}</span></div>
              </div>
              {viewDialog.notes && (
                <div className="border border-border rounded-lg p-3 bg-muted/30">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm whitespace-pre-wrap">{viewDialog.notes}</p>
                </div>
              )}
              {viewDialog.backstock_note && (
                <div className="border border-amber-200 rounded-lg p-3 bg-amber-50">
                  <p className="text-xs font-medium text-amber-800 mb-1">Backstock Note</p>
                  <p className="text-sm text-amber-900">{viewDialog.backstock_note}</p>
                </div>
              )}
              <div className="border border-border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Item</th>
                      <th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">Ord.</th>
                      <th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">Recv.</th>
                      <th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">Rem.</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Status</th>
                      <th className="hidden sm:table-cell text-left px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">Unit $</th>
                      <th className="hidden sm:table-cell text-left px-3 py-2 text-xs font-medium text-muted-foreground">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {asArray(viewDialog.items).map((item, i) => {
                      const ordered = asNumber(item.quantity_ordered);
                      const received = asNumber(item.quantity_received);
                      const remaining = Math.max(0, ordered - received);
                      const st = receiptLineStatus(item);
                      return (
                        <tr key={i}>
                          <td className="px-3 py-2">{item.item_name}</td>
                          <td className="px-2 py-2">{ordered}</td>
                          <td className="px-2 py-2 font-medium text-green-600">{received}</td>
                          <td className={`px-2 py-2 font-medium ${remaining > 0 ? 'text-amber-700' : 'text-muted-foreground'}`}>{remaining}</td>
                          <td className="px-3 py-2"><StatusBadge status={LINE_STATUS_BADGE[st] || 'pending'} label={LINE_STATUS_LABELS[st]} /></td>
                          <td className="hidden sm:table-cell px-3 py-2">${money(item.unit_cost)}</td>
                          <td className="hidden sm:table-cell px-3 py-2 font-medium">${money(lineTotal(item))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {viewReceiving.length > 0 && (
                <div className="border border-border rounded-lg p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Receiving history</p>
                  <div className="space-y-1.5">
                    {viewReceiving.map(ev => (
                      <div key={ev.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5">
                          <PackageCheck className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                          {ev.received_date ? format(new Date(ev.received_date), 'MMM d, yyyy') : '—'}
                          {ev.reference && <span className="text-muted-foreground">· {ev.reference}</span>}
                        </span>
                        <StatusBadge status={ev.status === 'received' ? 'fully_received' : ev.status} label={ev.status === 'received' ? 'Received' : undefined} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {viewDialog.status === 'closed' && (
                <p className="text-xs text-muted-foreground">Order manually closed{viewDialog.closed_at ? ` on ${format(new Date(viewDialog.closed_at), 'MMM d, yyyy')}` : ''}.</p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            {viewDialog && viewDialog.status !== 'cancelled' && (
              <Button variant="outline" onClick={toggleOrderClosed} disabled={closingOrder} className="mr-auto">
                {viewDialog.status === 'closed' ? 'Reopen order' : 'Close order'}
              </Button>
            )}
            <Button variant="outline" onClick={() => setViewDialog(null)}>Done</Button>
            {viewDialog && !['fully_received', 'closed', 'cancelled', 'received'].includes(viewDialog.status) && (
              <Button onClick={() => navigate('/dashboard/inventory/invoices', { state: { receiveOrderId: viewDialog.id, receiveLocationId: viewDialog.location_id } })}>
                <PackageCheck className="w-4 h-4 mr-1" />Receive Order
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Draft Order Dialog */}
      <Dialog open={!!editDialog} onOpenChange={() => setEditDialog(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Draft Order {editDialog?.order_number}</DialogTitle>
          </DialogHeader>
          {editDialog && (
            <MultiVendorCart
              locations={locations}
              vendors={vendors}
              items={items}
              locInv={locInv}
              selectedLocation={selectedLocation}
              selectedVendor={selectedVendor}
              carts={carts}
              onSelectLocation={setSelectedLocation}
              onSelectVendor={setSelectedVendor}
              onAddToCart={addToCart}
              onUpdateQty={updateCartQty}
              onRemove={removeFromCart}
              onClearCart={clearCart}
              onFillToPar={fillToPars}
              onCreateOrder={updateDraftOrder}
              onCreateAllOrders={updateDraftOrder}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { 
              if (editDialog?.vendor_id) {
                const newCarts = {...carts}; 
                delete newCarts[editDialog.vendor_id]; 
                setCarts(newCarts);
              }
              setEditDialog(null); 
            }}>Cancel</Button>
            <Button onClick={updateDraftOrder} disabled={!selectedLocation || asArray(carts[editDialog?.vendor_id]).filter(c => c.qty > 0).length === 0}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Smart Fill Dialog */}
      <SmartFillDialog
        open={smartFillDialog}
        onOpenChange={setSmartFillDialog}
        locationId={selectedLocation}
        onConfirm={handleSmartFillConfirm}
      />

      {/* AI Review Dialog */}
      <AIReviewDialog
        open={aiReviewDialog}
        onOpenChange={setAiReviewDialog}
        orderItems={pendingOrderItems}
        locationId={selectedLocation}
        onConfirm={handleAIReviewConfirm}
      />

      {/* Delete Order Confirmation Dialog */}
      <AlertDialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Order {deleteDialog?.order_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the order and all its items.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 py-2">
            <input
              type="checkbox"
              id="send-cancellation"
              className="h-4 w-4 rounded border-gray-300 accent-primary"
              onChange={(e) => setSendCancellationEmail(e.target.checked)}
            />
            <label htmlFor="send-cancellation" className="text-sm text-foreground cursor-pointer">
              Send cancellation email to vendor ({vendorName(deleteDialog?.vendor_id)})
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteOrder(sendCancellationEmail)} disabled={deleting}>
              <Trash2 className="w-4 h-4 mr-1" />{deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
