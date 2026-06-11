import { getInventoryItemValue, getPreferredPurchaseOption } from '@/lib/inventoryValue';

export const DEFAULT_TARGET_MARGIN = 0.75;
export const DEFAULT_WASTE_MARGIN = 0.05;
export const DEFAULT_YELLOW_MARGIN_POINTS = 0.05;
const RED_MARGIN_OFFSET_POINTS = 0.05;

export const RECIPE_UOM_OPTIONS = ['EA', 'fl-oz', 'ml', 'L', 'Pt', 'Qt', 'gal', 'oz', 'lb', 'g', 'kg'];

const UOM_DEFINITIONS = {
  'fl-oz': { family: 'volume', toBase: 1 },
  floz: { family: 'volume', toBase: 1 },
  // oz is the avoirdupois (dry-weight) ounce; fluid ounces are fl-oz.
  oz: { family: 'weight', toBase: 28.3495 },
  ml: { family: 'volume', toBase: 0.033814 },
  l: { family: 'volume', toBase: 33.814 },
  pt: { family: 'volume', toBase: 16 },
  qt: { family: 'volume', toBase: 32 },
  gal: { family: 'volume', toBase: 128 },
  g: { family: 'weight', toBase: 1 },
  gr: { family: 'weight', toBase: 1 },
  kg: { family: 'weight', toBase: 1000 },
  lb: { family: 'weight', toBase: 453.592 },
  ea: { family: 'count', toBase: 1 },
  each: { family: 'count', toBase: 1 },
};

export function normalizeUom(uom) {
  const cleaned = String(uom || '').trim();
  if (!cleaned) return '';
  const key = cleaned
    .toLowerCase()
    .replace(/fluid\s+ounces?/g, 'fl-oz')
    .replace(/fl[.\s-]*oz/g, 'fl-oz')
    .replace(/ounces?/g, 'oz')
    .replace(/\s+/g, '');

  if (key === 'liter' || key === 'litre' || key === 'liters' || key === 'litres') return 'L';
  if (key === 'pint' || key === 'pints') return 'Pt';
  if (key === 'quart' || key === 'quarts') return 'Qt';
  if (key === 'gallon' || key === 'gallons') return 'gal';
  if (key === 'each') return 'EA';
  return RECIPE_UOM_OPTIONS.find((option) => option.toLowerCase() === key) || cleaned;
}

export function convertQuantity(quantity, fromUom, toUom) {
  const amount = toNumber(quantity);
  const from = normalizeUom(fromUom);
  const to = normalizeUom(toUom);
  if (!from || !to || from === to) return amount;

  const fromDef = UOM_DEFINITIONS[from.toLowerCase()];
  const toDef = UOM_DEFINITIONS[to.toLowerCase()];
  if (!fromDef || !toDef || fromDef.family !== toDef.family) return null;

  return amount * (fromDef.toBase / toDef.toBase);
}

function convertUnitCost(costPerFromUom, fromUom, toUom) {
  const oneToUnitInFromUnits = convertQuantity(1, toUom, fromUom);
  if (oneToUnitInFromUnits == null) return null;
  return toNumber(costPerFromUom) * oneToUnitInFromUnits;
}

// Items counted in EA but purchased by weight/volume can declare a bridge,
// e.g. { each_count: 12, quantity: 5, uom: 'lb' } means 12 EA = 5 lb.
export function eachConversionFor(item) {
  const conv = item?.each_conversion;
  const eachCount = toNumber(conv?.each_count);
  const quantity = toNumber(conv?.quantity);
  const uom = normalizeUom(conv?.uom || '');
  if (eachCount <= 0 || quantity <= 0 || !uom || uom === 'EA') return null;
  return { eachCount, quantity, uom };
}

export function convertQuantityForItem(item, quantity, fromUom, toUom) {
  const direct = convertQuantity(quantity, fromUom, toUom);
  if (direct != null) return direct;

  const conv = eachConversionFor(item);
  if (!conv) return null;
  const from = normalizeUom(fromUom);
  const to = normalizeUom(toUom);

  if (from === 'EA') {
    const inConvUom = (toNumber(quantity) / conv.eachCount) * conv.quantity;
    return convertQuantity(inConvUom, conv.uom, to);
  }
  if (to === 'EA') {
    const inConvUom = convertQuantity(quantity, fromUom, conv.uom);
    if (inConvUom == null) return null;
    return (inConvUom / conv.quantity) * conv.eachCount;
  }
  return null;
}

function convertUnitCostForItem(item, costPerFromUom, fromUom, toUom) {
  const oneToUnitInFromUnits = convertQuantityForItem(item, 1, toUom, fromUom);
  if (oneToUnitInFromUnits == null) return null;
  return toNumber(costPerFromUom) * oneToUnitInFromUnits;
}

export const emptyPackage = () => ({
  name: '',
  category: 'Drinks',
  description: '',
  lines: [],
  is_active: true,
});

export const emptyPrepRecipe = () => ({
  name: '',
  category: 'Drinks',
  description: '',
  yield_quantity: 1,
  yield_uom: '',
  lines: [],
  is_active: true,
});

export const emptySizeSet = () => ({
  name: '',
  category: 'Drinks',
  description: '',
  sizes: [
    { id: crypto.randomUUID(), name: '12 oz hot', base_size: '12 oz', service_style: 'hot', package_id: '' },
    { id: crypto.randomUUID(), name: '12 oz iced', base_size: '12 oz', service_style: 'iced', package_id: '' },
  ],
  is_active: true,
});

export const emptyChoiceGroup = () => ({
  name: '',
  category: 'Drinks',
  description: '',
  size_set_id: '',
  unit_of_measure: 'fl-oz',
  amounts: {},
  options: [],
  is_active: true,
});

export const emptyRecipeModifier = () => ({
  name: '',
  category: 'Drinks',
  description: '',
  size_set_id: '',
  upcharge: 0,
  lines: [],
  is_active: true,
});

export const emptyMenuRecipe = () => {
  const small = crypto.randomUUID();
  const regular = crypto.randomUUID();
  return {
    name: '',
    category: 'Drinks',
    description: '',
    target_margin_override: null,
    waste_margin_override: null,
    size_set_id: '',
    selected_size_ids: [],
    size_prices: {},
    sizes: [
      { id: small, name: '12 oz hot', base_size: '12 oz', service_style: 'hot', menu_price: 0, package_id: '' },
      { id: regular, name: '12 oz iced', base_size: '12 oz', service_style: 'iced', menu_price: 0, package_id: '' },
    ],
    drink_base_sizes: ['12 oz'],
    drink_service_styles: ['hot', 'iced'],
    food_prep_recipe_id: '',
    food_prep_quantity: 1,
    food_extra_items: [],
    components: [],
    choice_group_ids: [],
    modifiers: [],
    modifier_ids: [],
    set_pricing: {},
    is_active: true,
  };
};

export function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function toPercentNumber(value, fallback = 0) {
  const number = toNumber(value, fallback);
  return number > 1 ? number / 100 : number;
}

export function money(value) {
  return `$${toNumber(value).toFixed(2)}`;
}

export function percent(value) {
  return `${(toNumber(value) * 100).toFixed(1)}%`;
}

function lineAmount(line, sizeId) {
  if (!line) return 0;
  if (line.amounts && sizeId) return toNumber(line.amounts[sizeId]);
  return toNumber(line.quantity);
}

function fallbackItemUnitCost(item) {
  if (!item) return 0;
  const preferred = getPreferredPurchaseOption(item);
  const cost = toNumber(preferred?.unit_cost || item.unit_cost);
  if (!cost) {
    const valueForOneBaseUnit = getInventoryItemValue(item, 1, null);
    return valueForOneBaseUnit > 0 ? valueForOneBaseUnit : 0;
  }

  const itemUom = item.unit_of_measure || preferred?.inner_pack_uom || preferred?.unit_of_measure;
  const orderingUom = preferred?.unit_of_measure || itemUom;
  const packUom = preferred?.inner_pack_uom || itemUom;
  const packName = preferred?.inner_pack_name || '';
  const packUnits = toNumber(preferred?.inner_pack_units || item.inner_pack_units, 1) || 1;
  const packsPerCase = toNumber(preferred?.packs_per_case || item.packs_per_case);
  let costPerPackUom = null;

  // A cost whose ordering UOM already matches the pack/item UOM is per-unit;
  // the pack-size fallbacks below must not divide it by the pack quantity.
  const costIsPerUnit = normalizeUom(orderingUom) === normalizeUom(packUom)
    || normalizeUom(orderingUom) === normalizeUom(itemUom);

  if (String(orderingUom || '').toLowerCase() === 'case' && packsPerCase > 0 && packUnits > 0) {
    costPerPackUom = cost / (packUnits * packsPerCase);
  } else if (packName && orderingUom === packName && packUnits > 0) {
    costPerPackUom = cost / packUnits;
  } else if (!costIsPerUnit && packUnits > 1 && packsPerCase > 0) {
    costPerPackUom = cost / (packUnits * packsPerCase);
  } else if (!costIsPerUnit && packUnits > 1) {
    costPerPackUom = cost / packUnits;
  }

  if (costPerPackUom != null) {
    return convertUnitCostForItem(item, costPerPackUom, packUom, itemUom) ?? costPerPackUom;
  }

  return convertUnitCostForItem(item, cost, orderingUom, itemUom) ?? cost;
}

export function buildPricingContext({
  items = [],
  locInv = [],
  locations = [],
  packages = [],
  prepRecipes = [],
  sizeSets = [],
  choiceGroups = [],
  recipeModifiers = [],
}) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const packageById = new Map(packages.map((pkg) => [pkg.id, pkg]));
  const prepById = new Map(prepRecipes.map((recipe) => [recipe.id, recipe]));
  const sizeSetById = new Map(sizeSets.map((sizeSet) => [sizeSet.id, sizeSet]));
  const choiceGroupById = new Map(choiceGroups.map((choiceGroup) => [choiceGroup.id, choiceGroup]));
  const modifierById = new Map(recipeModifiers.map((modifier) => [modifier.id, modifier]));

  const unitCostByItemId = new Map();
  for (const item of items) {
    const stockRows = locInv.filter((stock) => stock.item_id === item.id);
    const totalQty = stockRows.reduce((sum, stock) => sum + toNumber(stock.on_hand_quantity), 0);
    const totalValue = stockRows.reduce((sum, stock) => {
      const location = locationById.get(stock.location_id);
      return sum + getInventoryItemValue(item, stock.on_hand_quantity || 0, location);
    }, 0);

    unitCostByItemId.set(item.id, totalQty > 0 && totalValue > 0 ? totalValue / totalQty : fallbackItemUnitCost(item));
  }

  const ctx = { itemById, locationById, packageById, prepById, sizeSetById, choiceGroupById, modifierById, unitCostByItemId };
  ctx.packageCost = (packageId) => calculatePackageCost(packageById.get(packageId), ctx);
  ctx.prepCost = (recipeId) => calculatePrepCost(prepById.get(recipeId), ctx);
  ctx.prepUnitCost = (recipeId) => {
    const recipe = prepById.get(recipeId);
    const total = calculatePrepCost(recipe, ctx);
    return total / Math.max(toNumber(recipe?.yield_quantity, 1), 1);
  };
  return ctx;
}

function sizeMenuPrice(priceEntry, fallback = 0) {
  if (priceEntry && typeof priceEntry === 'object') return toNumber(priceEntry.menu_price, fallback);
  if (priceEntry !== undefined && priceEntry !== null) return toNumber(priceEntry, fallback);
  return toNumber(fallback);
}

function sizeNameKey(size) {
  return String(size?.name || '').trim().toLowerCase();
}

function sizeConfigKey(size) {
  return [
    String(size?.base_size || size?.name || '').trim().toLowerCase(),
    String(size?.service_style || '').trim().toLowerCase(),
  ].join('|');
}

function remapAmountsToRecipeSizes(amounts = {}, sourceSizeSetId, recipeSizes = [], ctx = {}) {
  if (!sourceSizeSetId || !ctx.sizeSetById?.has(sourceSizeSetId) || !recipeSizes.length) return amounts || {};

  const sourceSizeSet = ctx.sizeSetById.get(sourceSizeSetId);
  const sourceByConfig = new Map((sourceSizeSet?.sizes || []).map((size) => [sizeConfigKey(size), size.id]));
  const sourceByName = new Map((sourceSizeSet?.sizes || []).map((size) => [sizeNameKey(size), size.id]));
  const remapped = { ...(amounts || {}) };

  for (const recipeSize of recipeSizes) {
    if (remapped[recipeSize.id] != null) continue;
    const sourceId = sourceByConfig.get(sizeConfigKey(recipeSize)) || sourceByName.get(sizeNameKey(recipeSize));
    if (sourceId && amounts?.[sourceId] != null) remapped[recipeSize.id] = amounts[sourceId];
  }

  return remapped;
}

export function resolveMenuRecipe(recipe, ctx = {}, options = {}) {
  if (!recipe) return recipe;

  let sizes = recipe.sizes || [];
  if (recipe.size_set_id && ctx.sizeSetById?.has(recipe.size_set_id)) {
    const sizeSet = ctx.sizeSetById.get(recipe.size_set_id);
    const selectedIds = !options.includeAllSizes && Array.isArray(recipe.selected_size_ids) && recipe.selected_size_ids.length
      ? new Set(recipe.selected_size_ids)
      : null;
    const priceBySizeId = recipe.size_prices || {};
    const legacySizes = recipe.sizes || [];

    sizes = (sizeSet?.sizes || [])
      .filter((size) => !selectedIds || selectedIds.has(size.id))
      .map((size) => {
        const legacy = legacySizes.find((entry) => entry.id === size.id || entry.name === size.name);
        return {
          ...size,
          menu_price: sizeMenuPrice(priceBySizeId[size.id], legacy?.menu_price ?? 0),
          package_id: size.package_id || legacy?.package_id || '',
        };
      });
  }

  const embeddedComponents = recipe.components || [];
  const selectedChoiceGroups = (recipe.choice_group_ids || [])
    .map((id) => ctx.choiceGroupById?.get(id))
    .filter(Boolean)
    .map((choiceGroup) => ({
      id: choiceGroup.id,
      library_id: choiceGroup.id,
      type: 'choice_group',
      label: choiceGroup.name,
      unit_of_measure: choiceGroup.unit_of_measure || 'fl-oz',
      amounts: remapAmountsToRecipeSizes(choiceGroup.amounts || {}, choiceGroup.size_set_id, sizes, ctx),
      options: (choiceGroup.options || []).map((option) => ({
        ...option,
        amounts: remapAmountsToRecipeSizes(option.amounts || {}, choiceGroup.size_set_id, sizes, ctx),
      })),
    }));

  const embeddedModifiers = recipe.modifiers || [];
  const selectedModifiers = (recipe.modifier_ids || [])
    .map((id) => ctx.modifierById?.get(id))
    .filter(Boolean)
    .map((modifier) => ({
      id: modifier.id,
      library_id: modifier.id,
      name: modifier.name,
      upcharge: modifier.upcharge,
      lines: (modifier.lines || []).map((line) => ({
        ...line,
        amounts: remapAmountsToRecipeSizes(line.amounts || {}, modifier.size_set_id, sizes, ctx),
      })),
    }));

  return {
    ...recipe,
    sizes,
    components: [...embeddedComponents, ...selectedChoiceGroups],
    modifiers: [...embeddedModifiers, ...selectedModifiers],
  };
}

export function calculateLineCost(line, ctx, sizeId) {
  return calculateLineCostDetail(line, ctx, sizeId).cost;
}

export function calculateLineCostDetail(line, ctx, sizeId) {
  const amount = lineAmount(line, sizeId);
  const emptyDetail = {
    amount,
    fromUom: normalizeUom(line?.unit_of_measure || ''),
    convertedAmount: amount,
    toUom: '',
    unitCost: 0,
    cost: 0,
    sourceName: '',
    sourceType: line?.type || 'item',
    conversionFailed: false,
  };
  if (!amount) return emptyDetail;

  if (line.type === 'package') {
    const packageId = line.package_id || line.source_id;
    const unitCost = ctx.packageCost(packageId);
    return {
      ...emptyDetail,
      unitCost,
      cost: amount * unitCost,
      sourceName: ctx.packageById.get(packageId)?.name || 'Package',
      sourceType: 'package',
      toUom: 'package',
    };
  }
  if (line.type === 'prep') {
    const recipeId = line.prep_recipe_id || line.source_id;
    const recipe = ctx.prepById.get(recipeId);
    const toUom = recipe?.yield_uom || '';
    const convertedAmount = convertQuantity(amount, line.unit_of_measure, toUom);
    const finalAmount = convertedAmount ?? amount;
    const unitCost = ctx.prepUnitCost(recipeId);
    return {
      ...emptyDetail,
      convertedAmount: finalAmount,
      toUom,
      unitCost,
      cost: finalAmount * unitCost,
      sourceName: recipe?.name || 'Prep recipe',
      sourceType: 'prep',
      conversionFailed: convertedAmount == null && !!line.unit_of_measure && !!toUom,
    };
  }

  const itemId = line.item_id || line.source_id;
  const item = ctx.itemById.get(itemId);
  const toUom = item?.unit_of_measure || '';
  const convertedAmount = convertQuantityForItem(item, amount, line.unit_of_measure, toUom);
  const finalAmount = convertedAmount ?? amount;
  const unitCost = toNumber(ctx.unitCostByItemId.get(itemId));
  return {
    ...emptyDetail,
    convertedAmount: finalAmount,
    toUom,
    unitCost,
    cost: finalAmount * unitCost,
    sourceName: item?.name || 'Inventory item',
    sourceType: 'item',
    conversionFailed: convertedAmount == null && !!line.unit_of_measure && !!toUom,
  };
}

export function calculatePackageCost(pkg, ctx) {
  if (!pkg) return 0;
  return (pkg.lines || []).reduce((sum, line) => sum + calculateLineCost({ ...line, type: 'item' }, ctx), 0);
}

export function calculatePrepCost(recipe, ctx) {
  if (!recipe) return 0;
  return (recipe.lines || []).reduce((sum, line) => sum + calculateLineCost({ ...line, type: line.type || 'item' }, ctx), 0);
}

export function resolveMarginSetting(recipe, marginSettings = []) {
  const setting = marginSettings.find((entry) => entry.category === recipe?.category);
  const targetMargin = recipe?.target_margin_override != null && recipe.target_margin_override !== ''
    ? toPercentNumber(recipe.target_margin_override)
    : toPercentNumber(setting?.target_margin, DEFAULT_TARGET_MARGIN);
  const wasteMargin = recipe?.waste_margin_override != null && recipe.waste_margin_override !== ''
    ? toPercentNumber(recipe.waste_margin_override)
    : toPercentNumber(setting?.waste_margin, DEFAULT_WASTE_MARGIN);
  const yellowMarginPoints = toPercentNumber(setting?.yellow_margin_points, DEFAULT_YELLOW_MARGIN_POINTS);
  return { targetMargin, wasteMargin, yellowMarginPoints };
}

function selectedChoiceOption(component, selections) {
  return component.options?.find((option) => option.id === selections?.[component.id]) ||
    component.options?.find((option) => option.is_base) ||
    component.options?.[0] ||
    null;
}

export function calculateMenuSize(recipe, size, ctx, marginSettings = [], selections = {}, selectedModifierIds = [], options = {}) {
  const pricedRecipe = resolveMenuRecipe(recipe, ctx, options);
  const margin = resolveMarginSetting(pricedRecipe, marginSettings);
  let cost = 0;
  let priceUpcharge = 0;

  if (size?.package_id) {
    cost += ctx.packageCost(size.package_id);
  }

  if (pricedRecipe?.category === 'Food') {
    if (pricedRecipe.food_prep_recipe_id) {
      cost += toNumber(pricedRecipe.food_prep_quantity, 1) * ctx.prepUnitCost(pricedRecipe.food_prep_recipe_id);
    }

    for (const line of pricedRecipe.food_extra_items || []) {
      cost += calculateLineCost({ ...line, type: 'item' }, ctx);
    }
  }

  for (const component of pricedRecipe?.components || []) {
    if (component.type === 'choice_group') {
      const option = selectedChoiceOption(component, selections);
      if (option) {
        const optionAmounts = Object.keys(option.amounts || {}).length ? option.amounts : component.amounts;
        cost += calculateLineCost({
          ...option,
          amounts: optionAmounts,
          quantity: component.quantity,
          unit_of_measure: option.unit_of_measure || component.unit_of_measure || 'fl-oz',
        }, ctx, size.id);
        priceUpcharge += toNumber(option.upcharge);
      }
      continue;
    }

    cost += calculateLineCost(component, ctx, size.id);
  }

  const selectedModifiers = (pricedRecipe?.modifiers || []).filter((modifier) => selectedModifierIds.includes(modifier.id));
  for (const modifier of selectedModifiers) {
    priceUpcharge += toNumber(modifier.upcharge);
    for (const line of modifier.lines || []) {
      cost += calculateLineCost(line, ctx, size.id);
    }
  }

  const setPrice = toNumber(size?.menu_price) + priceUpcharge;
  const wasteAdjustedCost = cost * (1 + margin.wasteMargin);
  const recommendedPrice = margin.targetMargin >= 1 ? 0 : wasteAdjustedCost / (1 - margin.targetMargin);
  const actualMargin = setPrice > 0 ? (setPrice - wasteAdjustedCost) / setPrice : 0;
  const gap = recommendedPrice - setPrice;
  const marginGap = margin.targetMargin - actualMargin;
  const greenFloor = margin.targetMargin - margin.yellowMarginPoints;
  const yellowFloor = greenFloor - RED_MARGIN_OFFSET_POINTS;
  const status = actualMargin >= greenFloor
    ? 'green'
    : actualMargin >= yellowFloor
      ? 'yellow'
      : 'red';

  return {
    cost,
    wasteAdjustedCost,
    setPrice,
    recommendedPrice,
    actualMargin,
    gap,
    marginGap,
    status,
    targetMargin: margin.targetMargin,
    wasteMargin: margin.wasteMargin,
    greenFloor,
    yellowFloor,
    selectedModifiers,
  };
}

export function choiceComponents(recipe, ctx) {
  const pricedRecipe = resolveMenuRecipe(recipe, ctx);
  return (pricedRecipe?.components || []).filter((component) => component.type === 'choice_group' && component.options?.length);
}

export function buildChoiceScenarios(recipe, max = 80, ctx) {
  if (max && typeof max === 'object') {
    ctx = max;
    max = 80;
  }
  const choices = choiceComponents(recipe, ctx);
  if (!choices.length) return [{ id: 'base', label: 'Base', selections: {} }];

  let scenarios = [{ id: 'base', label: '', selections: {} }];
  for (const choice of choices) {
    const baseOption = choice.options?.find((option) => option.is_base) || choice.options?.[0] || null;
    const orderedOptions = [
      ...(baseOption ? [baseOption] : []),
      ...(choice.options || []).filter((option) => option.id !== baseOption?.id),
    ];
    const next = [];
    for (const scenario of scenarios) {
      for (const option of orderedOptions) {
        const optionLabel = option.id === baseOption?.id
          ? `Base (${option.label || 'Included'})`
          : option.label;
        next.push({
          id: `${scenario.id}-${option.id}`,
          label: [scenario.label, optionLabel].filter(Boolean).join(' + '),
          selections: { ...scenario.selections, [choice.id]: option.id },
        });
      }
    }
    scenarios = next.slice(0, max);
  }

  return scenarios.map((scenario) => ({ ...scenario, label: scenario.label || 'Base' }));
}

export function statusClasses(status) {
  if (status === 'green') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'yellow') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

export function sourceLabel(line, ctx) {
  if (line.type === 'package') return ctx.packageById.get(line.package_id || line.source_id)?.name || 'Package';
  if (line.type === 'prep') return ctx.prepById.get(line.prep_recipe_id || line.source_id)?.name || 'Prep recipe';
  return ctx.itemById.get(line.item_id || line.source_id)?.name || 'Inventory item';
}
