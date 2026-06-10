export const CATEGORY_GROUPS = [
  { value: 'sales_item', label: 'Sales Item' },
  { value: 'ingredient', label: 'Ingredient' },
  { value: 'supply', label: 'Supply' },
];

export const DEFAULT_INVENTORY_CATEGORIES = [
  { name: 'Drinks', main_category: 'sales_item', include_in_recipe_pricing: true },
  { name: 'Item Based Retail', main_category: 'sales_item', include_in_recipe_pricing: true },
  { name: 'Food', main_category: 'sales_item', include_in_recipe_pricing: true },
  { name: 'Food/Drink Based Retail', main_category: 'sales_item', include_in_recipe_pricing: true },
  { name: 'Dairy', main_category: 'ingredient', include_in_recipe_pricing: true },
  { name: 'Milk Alternatives', main_category: 'ingredient', include_in_recipe_pricing: true },
  { name: 'Coffee & Tea', main_category: 'ingredient', include_in_recipe_pricing: true },
  { name: 'Syrups & Sauces', main_category: 'ingredient', include_in_recipe_pricing: true },
  { name: 'Meat', main_category: 'ingredient', include_in_recipe_pricing: true },
  { name: 'Produce', main_category: 'ingredient', include_in_recipe_pricing: true },
  { name: 'Bakery', main_category: 'ingredient', include_in_recipe_pricing: true },
  { name: 'Dry Goods', main_category: 'ingredient', include_in_recipe_pricing: true },
  { name: 'Frozen', main_category: 'ingredient', include_in_recipe_pricing: true },
  { name: 'Drink Ingredients', main_category: 'ingredient', include_in_recipe_pricing: true },
  { name: 'Prep Ingredients', main_category: 'ingredient', include_in_recipe_pricing: true },
  { name: 'Packaging', main_category: 'supply', include_in_recipe_pricing: true },
  { name: 'Paper Goods', main_category: 'supply', include_in_recipe_pricing: true },
  { name: 'Service Supplies', main_category: 'supply', include_in_recipe_pricing: true },
  { name: 'Cleaning', main_category: 'supply', include_in_recipe_pricing: false },
  { name: 'Chemicals', main_category: 'supply', include_in_recipe_pricing: false },
  { name: 'Smallwares', main_category: 'supply', include_in_recipe_pricing: false },
  { name: 'Office Supplies', main_category: 'supply', include_in_recipe_pricing: false },
];

export function categoryGroupLabel(value) {
  return CATEGORY_GROUPS.find((group) => group.value === value)?.label || 'Ingredient';
}

export function defaultIncludeForCategory(mainCategory) {
  if (mainCategory === 'supply') return false;
  return true;
}

function cleanName(name) {
  return String(name || '').trim();
}

function keyedName(name) {
  return cleanName(name).toLowerCase();
}

export function mergeInventoryCategories(saved = [], items = []) {
  const byName = new Map();

  DEFAULT_INVENTORY_CATEGORIES.forEach((category, index) => {
    byName.set(keyedName(category.name), {
      ...category,
      id: null,
      is_active: true,
      sort_order: index,
      is_default: true,
    });
  });

  for (const item of items || []) {
    const name = cleanName(item.category);
    if (!name || byName.has(keyedName(name))) continue;
    byName.set(keyedName(name), {
      id: null,
      name,
      main_category: 'ingredient',
      include_in_recipe_pricing: true,
      is_active: true,
      sort_order: byName.size,
      is_from_catalog: true,
    });
  }

  for (const row of saved || []) {
    const name = cleanName(row.name);
    if (!name) continue;
    const key = keyedName(name);
    byName.set(key, {
      ...byName.get(key),
      ...row,
      name,
      main_category: row.main_category || byName.get(key)?.main_category || 'ingredient',
      include_in_recipe_pricing: row.include_in_recipe_pricing !== false,
      is_active: row.is_active !== false,
      sort_order: row.sort_order ?? byName.get(key)?.sort_order ?? byName.size,
    });
  }

  return [...byName.values()].sort((a, b) => {
    const groupCompare = categoryGroupLabel(a.main_category).localeCompare(categoryGroupLabel(b.main_category));
    if (groupCompare) return groupCompare;
    return (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name);
  });
}

export function categoryForName(categories = [], name) {
  const key = keyedName(name);
  return categories.find((category) => keyedName(category.name) === key);
}

export function categoryForItem(categories = [], item) {
  return categoryForName(categories, item?.category);
}

export function isRecipePricingCategory(categories = [], name) {
  const category = categoryForName(categories, name);
  if (!category) return true;
  return category.is_active !== false && category.include_in_recipe_pricing !== false;
}

export function recipePricingItems(items = [], categories = []) {
  return items.filter((item) => isRecipePricingCategory(categories, item.category));
}

export function salesItemCategoryNames(categories = []) {
  const names = categories
    .filter((category) => category.is_active !== false && category.main_category === 'sales_item')
    .map((category) => category.name);
  return names.length ? names : ['Drinks', 'Food'];
}
