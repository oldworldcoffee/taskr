const clean = (value) => String(value || '').trim();
const lower = (value) => clean(value).toLowerCase();

const toPositiveNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

export function getVendorPurchaseOption(item, vendorId) {
  const options = Array.isArray(item?.purchase_options) ? item.purchase_options : [];
  if (!options.length) return null;

  if (vendorId) {
    const vendorOptions = options.filter((option) => option.vendor_id === vendorId);
    if (vendorOptions.length) {
      return vendorOptions.find((option) => option.is_preferred) || vendorOptions[0];
    }

    if (item?.is_commissary_item && item?.commissary_vendor_id === vendorId) {
      return null;
    }
  }

  return options.find((option) => option.is_preferred) || options[0] || null;
}

export function getOrderUnit(item, vendorOrOption = null) {
  const option = vendorOrOption && typeof vendorOrOption === 'object'
    ? vendorOrOption
    : getVendorPurchaseOption(item, vendorOrOption);

  const baseUnit = clean(item?.base_unit_of_measure || item?.base_uom || item?.unit_of_measure || option?.inner_pack_uom || 'EA');
  const storedLabel = clean(item?.order_unit_label);
  const storedMultiplier = toPositiveNumber(item?.order_unit_multiplier, 0);

  if (storedLabel && storedMultiplier) {
    return { label: storedLabel, multiplier: storedMultiplier, baseUnit, option };
  }

  const optionUnit = clean(option?.unit_of_measure);
  const packName = clean(option?.inner_pack_name || item?.inner_pack_name);
  const packUnits = toPositiveNumber(option?.inner_pack_units || item?.inner_pack_units, 0);
  const packsPerCase = toPositiveNumber(option?.packs_per_case || item?.packs_per_case, 0);

  if (lower(optionUnit) === 'case') {
    return {
      label: 'Case',
      multiplier: packUnits && packsPerCase ? packUnits * packsPerCase : 1,
      baseUnit,
      option,
    };
  }

  if (packName && packUnits > 1 && (!optionUnit || lower(optionUnit) === lower(baseUnit) || lower(optionUnit) === lower(packName))) {
    return { label: packName, multiplier: packUnits, baseUnit, option };
  }

  if (optionUnit && lower(optionUnit) !== lower(baseUnit)) {
    return { label: optionUnit, multiplier: 1, baseUnit, option };
  }

  const countUnits = Array.isArray(item?.count_units) ? item.count_units : [];
  const countUnit = countUnits.find((unit) => {
    const multiplier = toPositiveNumber(unit?.multiplier, 0);
    return clean(unit?.label) && multiplier > 1 && lower(unit.label) !== lower(baseUnit);
  });

  if (countUnit) {
    return {
      label: clean(countUnit.label),
      multiplier: toPositiveNumber(countUnit.multiplier, 1),
      baseUnit,
      option,
    };
  }

  return { label: optionUnit || baseUnit, multiplier: 1, baseUnit, option };
}

export function getOrderUnitLabel(item, vendorOrOption = null) {
  return getOrderUnit(item, vendorOrOption).label;
}

export function toStockQuantity(orderQuantity, orderUnit) {
  return Number(orderQuantity || 0) * toPositiveNumber(orderUnit?.multiplier, 1);
}

export function formatQuantity(value) {
  const number = Number(value || 0);
  if (Number.isInteger(number)) return String(number);
  return number.toFixed(2).replace(/\.?0+$/, '');
}

export function pluralizeUnit(label, quantity) {
  const unit = clean(label);
  if (!unit || Number(quantity) === 1) return unit;
  if (/[-/]/.test(unit) || unit === unit.toUpperCase()) return unit;
  if (lower(unit) === 'case') return 'Cases';
  if (unit.endsWith('y')) return `${unit.slice(0, -1)}ies`;
  if (unit.endsWith('s')) return unit;
  return `${unit}s`;
}

export function formatOrderQuantity(quantity, label) {
  return `${formatQuantity(quantity)} ${pluralizeUnit(label, quantity)}`;
}
