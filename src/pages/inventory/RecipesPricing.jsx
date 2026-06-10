import { useEffect, useMemo, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  mergeInventoryCategories,
  salesItemCategoryNames,
} from '@/lib/inventoryCategories';
import {
  AlertTriangle,
  Calculator,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  DollarSign,
  ListChecks,
  Package,
  Plus,
  Ruler,
  Settings,
  SlidersHorizontal,
  Trash2,
  Utensils,
  X,
} from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DEFAULT_TARGET_MARGIN,
  DEFAULT_WASTE_MARGIN,
  DEFAULT_YELLOW_MARGIN_POINTS,
  RECIPE_UOM_OPTIONS,
  buildChoiceScenarios,
  buildPricingContext,
  calculateLineCostDetail,
  calculateMenuSize,
  calculatePackageCost,
  calculatePrepCost,
  emptyChoiceGroup,
  emptyMenuRecipe,
  emptyPackage,
  emptyPrepRecipe,
  emptyRecipeModifier,
  emptySizeSet,
  money,
  percent,
  resolveMenuRecipe,
  sourceLabel,
  statusClasses,
  toNumber,
  toPercentNumber,
} from '@/lib/recipePricing';

const tabItems = [
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'pricing', label: 'Pricing Matrix', icon: Calculator },
  { id: 'sizes', label: 'Sizes', icon: Ruler },
  { id: 'packages', label: 'Packages', icon: Package },
  { id: 'prep', label: 'Prep Recipes', icon: Utensils },
  { id: 'choiceGroups', label: 'Choice Groups', icon: ListChecks },
  { id: 'modifiers', label: 'Modifiers', icon: SlidersHorizontal },
  { id: 'menu', label: 'Menu Recipes', icon: DollarSign },
];

const sourceTypes = [
  { value: 'item', label: 'Inventory Item' },
  { value: 'package', label: 'Package' },
  { value: 'prep', label: 'Prep Recipe' },
];

const ingredientSourceTypes = [
  { value: 'item', label: 'Inventory Item' },
  { value: 'prep', label: 'Prep Recipe' },
];

const drinkStyles = [
  { value: 'hot', label: 'Hot' },
  { value: 'iced', label: 'Iced' },
];

const pctInput = (value, fallback = 0) => {
  const number = toPercentNumber(value, fallback);
  return Number.isFinite(number) ? (number * 100).toFixed(1).replace(/\.0$/, '') : '';
};

const fromPctInput = (value) => {
  if (value === '' || value == null) return null;
  return toNumber(value) / 100;
};

const AUTO_SAVE_DELAY_MS = 900;

const newId = () => crypto.randomUUID();

function sourceOptions(type, { items, packages, prepRecipes }) {
  if (type === 'package') return packages.map((pkg) => ({ id: pkg.id, label: pkg.name }));
  if (type === 'prep') return prepRecipes.map((recipe) => ({ id: recipe.id, label: recipe.name }));
  return items.map((item) => ({ id: item.id, label: `${item.name}${item.unit_of_measure ? ` (${item.unit_of_measure})` : ''}` }));
}

function Panel({ title, actions, children }) {
  return (
    <section className="border border-border rounded-lg bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function AutoSaveStatus({ status, canSave }) {
  if (!canSave) {
    return <span className="text-xs font-medium text-muted-foreground">Enter a name to autosave</span>;
  }

  const labels = {
    pending: 'Autosaving...',
    saving: 'Saving...',
    saved: 'Saved',
    error: 'Save failed',
  };
  const className = status === 'error'
    ? 'text-destructive'
    : status === 'saved'
      ? 'text-green-600'
      : 'text-muted-foreground';

  return (
    <span className={`inline-flex items-center rounded-md border border-border bg-muted/30 px-2 py-1 text-xs font-medium ${className}`}>
      {labels[status] || 'Autosaves'}
    </span>
  );
}

function StatusPill({ status }) {
  const label = status === 'green' ? 'Green' : status === 'yellow' ? 'Yellow' : 'Red';
  return <span className={`inline-flex px-2 py-0.5 rounded-full border text-xs font-semibold ${statusClasses(status)}`}>{label}</span>;
}

function RecipeList({ records, selectedId, onSelect, onNew, emptyLabel }) {
  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card">
      <div className="p-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Records</span>
        <Button size="sm" className="h-8 gap-1" onClick={onNew}><Plus className="w-3.5 h-3.5" /> New</Button>
      </div>
      <div className="divide-y divide-border max-h-[560px] overflow-y-auto">
        {records.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">{emptyLabel}</div>
        ) : records.map((record) => (
          <button
            key={record.id}
            type="button"
            onClick={() => onSelect(record)}
            className={`w-full text-left px-3 py-3 hover:bg-muted/40 transition-colors ${selectedId === record.id ? 'bg-primary/5' : ''}`}
          >
            <p className="text-sm font-medium">{record.name}</p>
            <p className="text-xs text-muted-foreground">{record.category || 'Uncategorized'}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function inventoryItemLabel(item) {
  if (!item) return '';
  return `${item.name}${item.unit_of_measure ? ` (${item.unit_of_measure})` : ''}`;
}

function compactNumber(value, digits = 4) {
  const number = toNumber(value);
  if (!number) return '0';
  return Number(number.toFixed(digits)).toString();
}

function mathLineText(detail) {
  const fromUom = detail.fromUom || detail.toUom || 'unit';
  const toUom = detail.toUom || fromUom;
  const amountText = `${compactNumber(detail.amount)} ${fromUom}`;
  const convertedText = `${compactNumber(detail.convertedAmount)} ${toUom}`;
  const conversionText = detail.fromUom && detail.toUom && detail.fromUom !== detail.toUom
    ? `${amountText} -> ${convertedText}`
    : convertedText;
  return `${conversionText} x ${money(detail.unitCost)}/${toUom || 'unit'} = ${money(detail.cost)}`;
}

function normalizeInventorySearch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/fluid\s+ounces?/g, 'oz')
    .replace(/fl[.\s-]*oz/g, 'oz')
    .replace(/ounces?/g, 'oz')
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
    .map((option) => [option.vendor_name, option.vendor_sku, option.unit_of_measure, option.inner_pack_name, option.inner_pack_uom].filter(Boolean).join(' '))
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

function matrixSizeKey(value) {
  return normalizeInventorySearch(value).replace(/\s+/g, '');
}

function matrixCategoryKey(value) {
  return String(value || '').trim().toLowerCase();
}

function matrixSizesMatch(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;

  const aName = matrixSizeKey(a.name);
  const bName = matrixSizeKey(b.name);
  if (aName && bName && (aName === bName || aName.includes(bName) || bName.includes(aName))) return true;

  const aBase = matrixSizeKey(a.base_size);
  const bBase = matrixSizeKey(b.base_size);
  const aStyle = matrixCategoryKey(a.service_style);
  const bStyle = matrixCategoryKey(b.service_style);
  return !!aBase && !!bBase && aBase === bBase && (!aStyle || !bStyle || aStyle === bStyle);
}

function scoreSizeSetForMatrix(recipe, sizeSet) {
  if (!sizeSet?.sizes?.length) return -1;
  let score = sizeSet.is_active === false ? 0 : 5;
  if (matrixCategoryKey(recipe.category) && matrixCategoryKey(recipe.category) === matrixCategoryKey(sizeSet.category)) score += 25;

  const legacySizes = recipe.sizes || [];
  for (const legacySize of legacySizes) {
    if ((sizeSet.sizes || []).some((size) => matrixSizesMatch(size, legacySize))) score += 20;
  }

  if ((sizeSet.sizes || []).length > 1) score += 2;
  return score;
}

function inferMatrixSizeSet(recipe, sizeSets = []) {
  if (!recipe) return null;

  return sizeSets
    .filter((sizeSet) => sizeSet?.sizes?.length)
    .map((sizeSet) => ({ sizeSet, score: scoreSizeSetForMatrix(recipe, sizeSet) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || (b.sizeSet.sizes?.length || 0) - (a.sizeSet.sizes?.length || 0))
    .at(0)?.sizeSet || null;
}

function matrixSourceSizes(recipe, linkedSizeSet) {
  const byId = new Map();
  for (const size of [...(recipe.sizes || []), ...(linkedSizeSet?.sizes || [])]) {
    if (size?.id) byId.set(size.id, size);
  }
  return [...byId.values()];
}

function matrixSizeOunces(size) {
  const text = String(size?.base_size || size?.name || '');
  const match = text.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function sortMatrixSizes(sizes = []) {
  const styleOrder = { hot: 0, iced: 1 };
  return [...sizes].sort((a, b) => {
    const ounceDiff = matrixSizeOunces(a) - matrixSizeOunces(b);
    if (Number.isFinite(ounceDiff) && ounceDiff !== 0) return ounceDiff;
    const styleDiff = (styleOrder[matrixCategoryKey(a.service_style)] ?? 9) - (styleOrder[matrixCategoryKey(b.service_style)] ?? 9);
    if (styleDiff !== 0) return styleDiff;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function uniqueMatrixSizes(sizeGroups = []) {
  const sizes = [];
  for (const group of sizeGroups) {
    for (const size of group || []) {
      if (size?.id && !sizes.some((existing) => matrixSizesMatch(existing, size))) sizes.push(size);
    }
  }
  return sortMatrixSizes(sizes);
}

function remapMatrixAmounts(amounts = {}, sourceSizes = [], targetSizes = []) {
  if (!amounts || !targetSizes.length || !sourceSizes.length) return amounts || {};

  const remapped = { ...amounts };
  for (const targetSize of targetSizes) {
    if (remapped[targetSize.id] != null) continue;
    const sourceSize = sourceSizes.find((size) => matrixSizesMatch(targetSize, size));
    if (sourceSize?.id && amounts[sourceSize.id] != null) remapped[targetSize.id] = amounts[sourceSize.id];
  }
  return remapped;
}

function remapMatrixSourceLine(line, sourceSizes, targetSizes) {
  return {
    ...line,
    amounts: remapMatrixAmounts(line.amounts || {}, sourceSizes, targetSizes),
  };
}

function remapMatrixComponent(component, sourceSizes, targetSizes) {
  return {
    ...remapMatrixSourceLine(component, sourceSizes, targetSizes),
    options: (component.options || []).map((option) => remapMatrixSourceLine(option, sourceSizes, targetSizes)),
  };
}

function matrixPriceEntryValue(priceEntry, fallback = 0) {
  if (priceEntry && typeof priceEntry === 'object') {
    return { ...priceEntry, menu_price: toNumber(priceEntry.menu_price, fallback) };
  }
  if (priceEntry !== undefined && priceEntry !== null && priceEntry !== '') {
    return { menu_price: toNumber(priceEntry, fallback) };
  }
  return null;
}

function matrixPriceForSize(size, recipe, sourceSizes = [], sizeSets = []) {
  const priceBySizeId = recipe.size_prices || {};
  const setPricingBySizeId = recipe.set_pricing || {};
  const allKnownSizes = [
    size,
    ...sourceSizes,
    ...(recipe.sizes || []),
    ...sizeSets.flatMap((sizeSet) => sizeSet.sizes || []),
  ].filter(Boolean);
  const matches = allKnownSizes.filter((candidate) => matrixSizesMatch(size, candidate));
  const prices = [];

  prices.push(matrixPriceEntryValue(priceBySizeId[size.id], size.menu_price));

  for (const candidate of matches) {
    prices.push(matrixPriceEntryValue(priceBySizeId[candidate.id], candidate.menu_price ?? size.menu_price));
    prices.push(matrixPriceEntryValue(candidate.menu_price, candidate.menu_price));
    prices.push(matrixPriceEntryValue(setPricingBySizeId[candidate.id], candidate.menu_price ?? size.menu_price));
  }

  const validPrices = prices.filter(Boolean);
  const nonZeroPrice = validPrices.find((price) => toNumber(price.menu_price) > 0);
  if (nonZeroPrice) return nonZeroPrice;

  return validPrices[0] || { menu_price: 0 };
}

function recipeForPricingMatrix(recipe, sizeSets = []) {
  if (!recipe) return recipe;

  const linkedSizeSet = recipe.size_set_id ? sizeSets.find((sizeSet) => sizeSet.id === recipe.size_set_id) : null;
  const sourceSizes = matrixSourceSizes(recipe, linkedSizeSet);
  const scoringRecipe = sourceSizes.length ? { ...recipe, sizes: sourceSizes } : recipe;
  const renderedSizeCount = linkedSizeSet?.sizes?.length || (recipe.sizes || []).length;
  const embeddedSizes = uniqueMatrixSizes([recipe.sizes || []]);
  const inferredSizeSet = inferMatrixSizeSet(scoringRecipe, linkedSizeSet ? sizeSets.filter((sizeSet) => sizeSet.id !== linkedSizeSet.id) : sizeSets);
  const targetSizes = embeddedSizes.length > renderedSizeCount
    ? embeddedSizes
    : uniqueMatrixSizes([sourceSizes, ...(inferredSizeSet ? [inferredSizeSet.sizes || []] : [])]);

  if (targetSizes.length <= renderedSizeCount) return recipe;

  const inferredPrices = Object.fromEntries(targetSizes.map((size) => [
    size.id,
    matrixPriceForSize(size, recipe, sourceSizes, sizeSets),
  ]));

  return {
    ...recipe,
    size_set_id: '',
    selected_size_ids: targetSizes.map((size) => size.id),
    size_prices: { ...inferredPrices, ...(recipe.size_prices || {}) },
    sizes: targetSizes.map((size) => ({
      ...size,
      ...matrixPriceForSize(size, recipe, sourceSizes, sizeSets),
    })),
    components: (recipe.components || []).map((component) => remapMatrixComponent(component, sourceSizes, targetSizes)),
    modifiers: (recipe.modifiers || []).map((modifier) => ({
      ...modifier,
      lines: (modifier.lines || []).map((line) => remapMatrixSourceLine(line, sourceSizes, targetSizes)),
    })),
  };
}

function InventoryItemSearch({ value, onChange, items }) {
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
          className="h-9 w-full justify-between px-3 font-normal"
        >
          <span className={`truncate ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>
            {selected ? inventoryItemLabel(selected) : 'Search inventory item'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(520px,calc(100vw-2rem))] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search by item, size, category, SKU..." />
          <CommandList>
            {visibleItems.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">No inventory item found.</div>
            ) : (
              <CommandGroup>
                {visibleItems.map((item) => (
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
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function InventoryLinesEditor({ lines, setLines, items, title = 'Lines' }) {
  const addLine = () => setLines([...(lines || []), { id: newId(), item_id: '', quantity: 1 }]);
  const updateLine = (idx, patch) => setLines((lines || []).map((line, lineIdx) => lineIdx === idx ? { ...line, ...patch } : line));
  const removeLine = (idx) => setLines((lines || []).filter((_, lineIdx) => lineIdx !== idx));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{title}</Label>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={addLine}><Plus className="w-3.5 h-3.5" /> Add Line</Button>
      </div>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Item</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-36">Amount</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(lines || []).map((line, idx) => (
              <tr key={line.id || idx}>
                <td className="px-3 py-2">
                  <InventoryItemSearch value={line.item_id || ''} onChange={(itemId) => updateLine(idx, { item_id: itemId })} items={items} />
                </td>
                <td className="px-3 py-2">
                  <Input type="number" step="0.01" value={line.quantity ?? ''} onChange={(e) => updateLine(idx, { quantity: e.target.value })} />
                </td>
                <td className="px-2 py-2">
                  <button type="button" onClick={() => removeLine(idx)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            {(lines || []).length === 0 && (
              <tr><td colSpan={3} className="px-3 py-4 text-sm text-muted-foreground">No lines yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SourceSelect({ value, type, onChange, data }) {
  if (type === 'item') {
    return <InventoryItemSearch value={value || ''} onChange={onChange} items={data.items} />;
  }

  const options = sourceOptions(type, data);
  return (
    <select className="w-full border border-input rounded-md px-2 py-1.5 bg-background" value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select source</option>
      {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
  );
}

function UomSelect({ value, onChange, placeholder = 'UOM' }) {
  return (
    <select className="w-full border border-input rounded-md px-2 py-2 bg-background text-sm" value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {RECIPE_UOM_OPTIONS.map((uom) => <option key={uom} value={uom}>{uom}</option>)}
    </select>
  );
}

function PackageSelect({ value, onChange, packages, placeholder = 'No package' }) {
  return (
    <select className="w-full border border-input rounded-md px-2 py-1.5 bg-background" value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {packages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.name}</option>)}
    </select>
  );
}

function PackageEditor({ form, setForm, items, onDelete, saving, pricingContext, autosaveStatus }) {
  const setLines = (next) => setForm((prev) => ({ ...prev, lines: next }));
  const cost = calculatePackageCost(form, pricingContext);

  return (
    <Panel
      title={form.id ? 'Edit Package' : 'New Package'}
      actions={<AutoSaveStatus status={autosaveStatus} canSave={!!form.name?.trim()} />}
    >
      <div className="grid gap-4">
        <div className="grid md:grid-cols-2 gap-3">
          <div><Label>Name</Label><Input className="mt-1" value={form.name || ''} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></div>
          <div><Label>Category</Label><Input className="mt-1" value={form.category || ''} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} /></div>
        </div>
        <div><Label>Description</Label><Textarea className="mt-1 h-20" value={form.description || ''} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></div>
        <InventoryLinesEditor lines={form.lines || []} setLines={setLines} items={items} title="Package Items" />
        <div className="flex items-center justify-between border-t border-border pt-3">
          <p className="text-sm font-semibold">Live package cost: <span className="text-primary">{money(cost)}</span></p>
          {form.id && <Button variant="outline" className="gap-1 text-destructive" disabled={saving} onClick={onDelete}><Trash2 className="w-4 h-4" /> Delete</Button>}
        </div>
      </div>
    </Panel>
  );
}

function PrepEditor({ form, setForm, items, onDelete, saving, pricingContext, autosaveStatus }) {
  const setLines = (next) => setForm((prev) => ({ ...prev, lines: next }));
  const cost = calculatePrepCost(form, pricingContext);
  const unitCost = cost / Math.max(toNumber(form.yield_quantity, 1), 1);

  return (
    <Panel
      title={form.id ? 'Edit Prep Recipe' : 'New Prep Recipe'}
      actions={<AutoSaveStatus status={autosaveStatus} canSave={!!form.name?.trim()} />}
    >
      <div className="grid gap-4">
        <div className="grid md:grid-cols-2 gap-3">
          <div><Label>Name</Label><Input className="mt-1" value={form.name || ''} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></div>
          <div><Label>Category</Label><Input className="mt-1" value={form.category || ''} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} /></div>
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          <div><Label>Yield Amount</Label><Input type="number" step="0.01" className="mt-1" value={form.yield_quantity ?? ''} onChange={(e) => setForm((p) => ({ ...p, yield_quantity: e.target.value }))} /></div>
          <div><Label>Yield UOM</Label><Input className="mt-1" value={form.yield_uom || ''} onChange={(e) => setForm((p) => ({ ...p, yield_uom: e.target.value }))} /></div>
          <div><Label>Category</Label><Input className="mt-1" value={form.category || ''} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} /></div>
        </div>
        <div><Label>Description</Label><Textarea className="mt-1 h-20" value={form.description || ''} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></div>
        <InventoryLinesEditor lines={form.lines || []} setLines={setLines} items={items} title="Prep Ingredients" />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <p className="text-sm font-semibold">Batch cost: <span className="text-primary">{money(cost)}</span> <span className="text-muted-foreground font-normal">/ {money(unitCost)} per {form.yield_uom || 'unit'}</span></p>
          {form.id && <Button variant="outline" className="gap-1 text-destructive" disabled={saving} onClick={onDelete}><Trash2 className="w-4 h-4" /> Delete</Button>}
        </div>
      </div>
    </Panel>
  );
}

function SizeSetEditor({ form, setForm, packages, onDelete, saving, autosaveStatus }) {
  const addSize = () => setForm((prev) => ({
    ...prev,
    sizes: [...(prev.sizes || []), { id: newId(), name: 'New Size', base_size: 'New Size', service_style: 'hot', package_id: '' }],
  }));
  const updateSize = (idx, patch) => setForm((prev) => ({
    ...prev,
    sizes: (prev.sizes || []).map((size, sizeIdx) => sizeIdx === idx ? { ...size, ...patch } : size),
  }));
  const removeSize = (idx) => setForm((prev) => ({
    ...prev,
    sizes: (prev.sizes || []).filter((_, sizeIdx) => sizeIdx !== idx),
  }));

  return (
    <Panel
      title={form.id ? 'Edit Size Set' : 'New Size Set'}
      actions={<AutoSaveStatus status={autosaveStatus} canSave={!!form.name?.trim()} />}
    >
      <div className="grid gap-4">
        <div className="grid md:grid-cols-2 gap-3">
          <div><Label>Name</Label><Input className="mt-1" value={form.name || ''} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></div>
          <div><Label>Category</Label><Input className="mt-1" value={form.category || ''} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} /></div>
        </div>
        <div><Label>Description</Label><Textarea className="mt-1 h-20" value={form.description || ''} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Standard Sizes</Label>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={addSize}><Plus className="w-3.5 h-3.5" /> Add Size</Button>
          </div>
          <div className="space-y-2">
            {(form.sizes || []).map((size, idx) => (
              <div key={size.id || idx} className="rounded-lg border border-border bg-background p-3 grid lg:grid-cols-[minmax(180px,1fr)_140px_minmax(220px,1.2fr)_28px] gap-2 items-end">
                <div>
                  <Label className="text-xs">Display Name</Label>
                  <Input className="mt-1" value={size.name || ''} onChange={(e) => updateSize(idx, { name: e.target.value, base_size: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Style</Label>
                  <select className="mt-1 w-full border border-input rounded-md px-2 py-2 bg-background text-sm" value={size.service_style || ''} onChange={(e) => updateSize(idx, { service_style: e.target.value })}>
                    <option value="">None</option>
                    {drinkStyles.map((style) => <option key={style.value} value={style.value}>{style.label}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Package</Label>
                  <div className="mt-1">
                    <PackageSelect value={size.package_id || ''} onChange={(packageId) => updateSize(idx, { package_id: packageId })} packages={packages} />
                  </div>
                </div>
                <button type="button" className="mb-2 text-muted-foreground hover:text-destructive" onClick={() => removeSize(idx)}><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            {(form.sizes || []).length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No sizes yet.</div>
            )}
          </div>
        </div>

        {form.id && (
          <div className="flex justify-end border-t border-border pt-3">
            <Button variant="outline" className="gap-1 text-destructive" disabled={saving} onClick={onDelete}><Trash2 className="w-4 h-4" /> Delete</Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function ChoiceGroupEditor({ form, setForm, data, pricingContext, onDelete, saving, autosaveStatus }) {
  const selectedSizeSet = data.sizeSets.find((sizeSet) => sizeSet.id === form.size_set_id);
  const sizes = selectedSizeSet?.sizes || [];
  const row = {
    id: form.id || 'draft-choice-group',
    type: 'choice_group',
    unit_of_measure: form.unit_of_measure || 'fl-oz',
    amounts: form.amounts || {},
    options: form.options || [],
  };

  const updateChoiceRow = (patch) => {
    setForm((prev) => ({
      ...prev,
      unit_of_measure: patch.unit_of_measure ?? prev.unit_of_measure,
      amounts: patch.amounts ?? prev.amounts,
      options: patch.options ?? prev.options,
    }));
  };

  return (
    <Panel
      title={form.id ? 'Edit Choice Group' : 'New Choice Group'}
      actions={<AutoSaveStatus status={autosaveStatus} canSave={!!form.name?.trim()} />}
    >
      <div className="grid gap-4">
        <div className="grid md:grid-cols-2 gap-3">
          <div><Label>Name</Label><Input className="mt-1" value={form.name || ''} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></div>
          <div><Label>Category</Label><Input className="mt-1" value={form.category || ''} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} /></div>
        </div>
        <div className="grid md:grid-cols-[1fr_150px] gap-3">
          <div>
            <Label>Size Set</Label>
            <select className="mt-1 w-full border border-input rounded-md px-3 py-2 bg-background" value={form.size_set_id || ''} onChange={(e) => setForm((p) => ({ ...p, size_set_id: e.target.value, amounts: {} }))}>
              <option value="">Any size set</option>
              {data.sizeSets.map((sizeSet) => <option key={sizeSet.id} value={sizeSet.id}>{sizeSet.name}</option>)}
            </select>
          </div>
          <div>
            <Label>Measure In</Label>
            <div className="mt-1">
              <UomSelect value={form.unit_of_measure || 'fl-oz'} onChange={(unit) => setForm((p) => ({ ...p, unit_of_measure: unit }))} placeholder="Item UOM" />
            </div>
          </div>
        </div>
        <div><Label>Description</Label><Textarea className="mt-1 h-20" value={form.description || ''} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></div>
        <div>
          <Label>Options</Label>
          <div className="mt-2">
            <ChoiceOptions row={row} sizes={sizes} pricingContext={pricingContext} updateRow={updateChoiceRow} data={data} />
          </div>
        </div>

        {form.id && (
          <div className="flex justify-end border-t border-border pt-3">
            <Button variant="outline" className="gap-1 text-destructive" disabled={saving} onClick={onDelete}><Trash2 className="w-4 h-4" /> Delete</Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function RecipeModifierEditor({ form, setForm, data, onDelete, saving, autosaveStatus }) {
  const selectedSizeSet = data.sizeSets.find((sizeSet) => sizeSet.id === form.size_set_id);
  const sizes = selectedSizeSet?.sizes || [];

  return (
    <Panel
      title={form.id ? 'Edit Modifier' : 'New Modifier'}
      actions={<AutoSaveStatus status={autosaveStatus} canSave={!!form.name?.trim()} />}
    >
      <div className="grid gap-4">
        <div className="grid md:grid-cols-2 gap-3">
          <div><Label>Category</Label><Input className="mt-1" value={form.category || ''} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} /></div>
          <div>
            <Label>Size Set</Label>
            <select className="mt-1 w-full border border-input rounded-md px-3 py-2 bg-background" value={form.size_set_id || ''} onChange={(e) => setForm((p) => ({ ...p, size_set_id: e.target.value, lines: (p.lines || []).map((line) => ({ ...line, amounts: {} })) }))}>
              <option value="">Any size set</option>
              {data.sizeSets.map((sizeSet) => <option key={sizeSet.id} value={sizeSet.id}>{sizeSet.name}</option>)}
            </select>
          </div>
        </div>
        <div><Label>Description</Label><Textarea className="mt-1 h-20" value={form.description || ''} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></div>
        <ModifierEditor
          modifier={form}
          sizes={sizes}
          data={data}
          onChange={(patch) => setForm((p) => ({ ...p, ...patch }))}
          onDelete={onDelete}
        />

        {form.id && (
          <div className="flex justify-end border-t border-border pt-3">
            <Button variant="outline" className="gap-1 text-destructive" disabled={saving} onClick={onDelete}><Trash2 className="w-4 h-4" /> Delete</Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function AmountInputs({ sizes, amounts = {}, onChange }) {
  if (!sizes.length) {
    return <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">No drink options yet.</div>;
  }

  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2">
      {sizes.map((size) => (
        <div key={size.id} className="rounded-md border border-border bg-background px-2 py-1.5">
          <span className="block truncate text-[11px] font-medium text-muted-foreground">{size.name}</span>
          <Input
            type="number"
            step="0.01"
            className="mt-1 h-8 text-xs"
            value={amounts?.[size.id] ?? ''}
            onChange={(e) => onChange({ ...(amounts || {}), [size.id]: e.target.value })}
          />
        </div>
      ))}
    </div>
  );
}

function MenuEditor({ form, setForm, data, menuCategories, onDelete, onSetPricing, saving, autosaveStatus, pricingContext, marginSettings }) {
  const category = menuCategories.includes(form.category) ? form.category : (menuCategories[0] || 'Drinks');
  const isDrinkCategory = category === 'Drinks';
  const recipeForPricing = resolveMenuRecipe({ ...form, category }, pricingContext);
  const sizes = recipeForPricing?.sizes || [];
  const previewRows = sizes.map((size) => calculateMenuSize({ ...form, category }, size, pricingContext, marginSettings, {}, []));
  const selectedSizeSet = data.sizeSets.find((sizeSet) => sizeSet.id === form.size_set_id);

  const updateCategory = (nextCategory) => {
    setForm((prev) => {
      if (nextCategory !== 'Drinks') {
        const existing = prev.sizes?.[0] || {};
        return {
          ...prev,
          category: nextCategory,
          size_set_id: '',
          selected_size_ids: [],
          size_prices: {},
          choice_group_ids: [],
          modifier_ids: [],
          sizes: [{
            id: existing.id || newId(),
            name: 'Standard',
            menu_price: existing.menu_price ?? 0,
            package_id: existing.package_id || '',
          }],
          food_prep_quantity: prev.food_prep_quantity || 1,
          food_extra_items: prev.food_extra_items || [],
        };
      }

      return {
        ...prev,
        category: nextCategory,
      };
    });
  };

  const selectSizeSet = (sizeSetId) => {
    const sizeSet = data.sizeSets.find((record) => record.id === sizeSetId);
    const sizeIds = (sizeSet?.sizes || []).map((size) => size.id);
    setForm((prev) => ({
      ...prev,
      size_set_id: sizeSetId,
      selected_size_ids: sizeIds,
    }));
  };

  const toggleSize = (sizeId) => {
    setForm((prev) => {
      const fallbackIds = (selectedSizeSet?.sizes || []).map((size) => size.id);
      const currentIds = Array.isArray(prev.selected_size_ids) ? prev.selected_size_ids : fallbackIds;
      const nextIds = currentIds.includes(sizeId)
        ? currentIds.filter((id) => id !== sizeId)
        : [...currentIds, sizeId];
      return { ...prev, selected_size_ids: nextIds };
    });
  };

  const updateSizePrice = (sizeId, patch) => {
    setForm((prev) => ({
      ...prev,
      size_prices: {
        ...(prev.size_prices || {}),
        [sizeId]: {
          ...((prev.size_prices || {})[sizeId] || {}),
          ...patch,
        },
      },
      sizes: (prev.sizes || []).map((size) => size.id === sizeId ? { ...size, ...patch } : size),
    }));
  };

  const updateComponent = (idx, patch) => setForm((prev) => ({ ...prev, components: (prev.components || []).map((row, i) => i === idx ? { ...row, ...patch } : row) }));
  const addComponent = (type = 'item') => setForm((prev) => ({
    ...prev,
    components: [
      ...(prev.components || []),
      {
        id: newId(),
        type,
        source_id: '',
        label: '',
        unit_of_measure: '',
        amounts: {},
      },
    ],
  }));
  const removeComponent = (idx) => setForm((prev) => ({ ...prev, components: (prev.components || []).filter((_, i) => i !== idx) }));

  const addLibraryId = (field, id) => {
    setForm((prev) => {
      const current = prev[field] || [];
      if (current.includes(id)) return prev;
      return {
        ...prev,
        [field]: [...current, id],
      };
    });
  };

  const removeLibraryId = (field, id) => {
    setForm((prev) => {
      const current = prev[field] || [];
      return {
        ...prev,
        [field]: current.filter((entry) => entry !== id),
      };
    });
  };

  const setFoodSize = (patch) => {
    setForm((prev) => {
      const existing = prev.sizes?.[0] || { id: newId(), name: 'Standard' };
      return { ...prev, sizes: [{ ...existing, name: 'Standard', ...patch }] };
    });
  };

  return (
    <Panel
      title={form.id ? 'Edit Menu Recipe' : 'New Menu Recipe'}
      actions={
        <div className="flex gap-2">
          {form.id && <Button variant="outline" className="gap-1" onClick={onSetPricing}><CheckCircle2 className="w-4 h-4" /> Set Menu Pricing</Button>}
          <AutoSaveStatus status={autosaveStatus} canSave={!!form.name?.trim()} />
        </div>
      }
    >
      <div className="grid gap-5">
        <div className="grid md:grid-cols-2 gap-3">
          <div><Label>Name</Label><Input className="mt-1" value={form.name || ''} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></div>
          <div>
            <Label>Category</Label>
            <select className="mt-1 w-full border border-input rounded-md px-3 py-2 bg-background" value={category} onChange={(e) => updateCategory(e.target.value)}>
              {menuCategories.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div><Label>Target Margin Override %</Label><Input className="mt-1" placeholder="Category default" value={form.target_margin_override == null ? '' : pctInput(form.target_margin_override)} onChange={(e) => setForm((p) => ({ ...p, target_margin_override: e.target.value }))} /></div>
          <div><Label>Waste Margin Override %</Label><Input className="mt-1" placeholder="Category default" value={form.waste_margin_override == null ? '' : pctInput(form.waste_margin_override)} onChange={(e) => setForm((p) => ({ ...p, waste_margin_override: e.target.value }))} /></div>
        </div>
        <div><Label>Description</Label><Textarea className="mt-1 h-20" value={form.description || ''} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></div>

        {isDrinkCategory ? (
          <>
            <DrinkMenuOptions
              sizeSetId={form.size_set_id || ''}
              sizeSets={data.sizeSets}
              selectedSizeSet={selectedSizeSet}
              selectedSizeIds={form.selected_size_ids || []}
              sizes={sizes}
              packages={data.packages}
              previewRows={previewRows}
              selectSizeSet={selectSizeSet}
              toggleSize={toggleSize}
              updateSizePrice={updateSizePrice}
            />
            <IngredientComponentsEditor
              title="Base Drink Ingredients"
              form={form}
              sizes={sizes}
              data={data}
              pricingContext={pricingContext}
              updateComponent={updateComponent}
              addComponent={addComponent}
              removeComponent={removeComponent}
            />
            <RecipeOptionsPicker
              choiceGroups={data.choiceGroups}
              modifiers={data.recipeModifiers}
              selectedChoiceGroupIds={form.choice_group_ids || []}
              selectedModifierIds={form.modifier_ids || []}
              onAddChoiceGroup={(id) => addLibraryId('choice_group_ids', id)}
              onRemoveChoiceGroup={(id) => removeLibraryId('choice_group_ids', id)}
              onAddModifier={(id) => addLibraryId('modifier_ids', id)}
              onRemoveModifier={(id) => removeLibraryId('modifier_ids', id)}
              selectedSizeSetId={form.size_set_id || ''}
              sizeSets={data.sizeSets}
            />
          </>
        ) : (
          <FoodMenuOptions
            form={form}
            setForm={setForm}
            size={sizes[0] || { id: newId(), name: 'Standard', menu_price: 0, package_id: '' }}
            result={previewRows[0]}
            data={data}
            updateSize={setFoodSize}
          />
        )}

        {form.id && (
          <div className="flex justify-end border-t border-border pt-3">
            <Button variant="outline" className="gap-1 text-destructive" disabled={saving} onClick={onDelete}><Trash2 className="w-4 h-4" /> Delete</Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function DrinkMenuOptions({ sizeSetId, sizeSets, selectedSizeSet, selectedSizeIds, sizes, packages, previewRows, selectSizeSet, toggleSize, updateSizePrice }) {
  const packageNameById = new Map(packages.map((pkg) => [pkg.id, pkg.name]));
  const activeIds = Array.isArray(selectedSizeIds) ? selectedSizeIds : [];

  return (
    <Panel title="Drink Options">
      <div className="grid gap-4">
        <div className="space-y-2">
          <Label>Size Set</Label>
          {sizeSets.length ? (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2">
              {sizeSets.map((sizeSet) => {
                const checked = sizeSet.id === sizeSetId;
                const setSizes = sizeSet.sizes || [];
                const selectedCount = checked ? activeIds.filter((id) => setSizes.some((size) => size.id === id)).length : 0;
                return (
                  <button
                    key={sizeSet.id}
                    type="button"
                    onClick={() => selectSizeSet(sizeSet.id)}
                    className={`rounded-lg border p-3 text-left transition-colors ${checked ? 'bg-primary/10 border-primary text-primary' : 'bg-card border-border hover:bg-muted/50'}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50'}`}>
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                      <span>
                        <span className="block text-sm font-medium">{sizeSet.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {checked ? `${selectedCount} of ${setSizes.length} sizes active` : `${setSizes.length} sizes`}
                        </span>
                      </span>
                    </span>
                    <span className="mt-2 flex flex-wrap gap-1">
                      {setSizes.map((size) => (
                        <span key={size.id} className="rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                          {size.name}
                        </span>
                      ))}
                      {setSizes.length === 0 && (
                        <span className="rounded-md border border-dashed border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">No sizes</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              Create size sets in the Sizes tab.
            </div>
          )}
        </div>

        {selectedSizeSet ? (
          <div className="space-y-2">
            <Label>What sizes do you offer this drink in?</Label>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {(selectedSizeSet.sizes || []).map((size) => {
                const sizeActive = activeIds.includes(size.id);
                return (
                  <label
                    key={size.id}
                    className={`rounded-lg border px-3 py-2 text-sm transition-colors cursor-pointer ${
                      sizeActive
                        ? 'bg-primary/10 border-primary text-primary'
                        : 'bg-card border-border hover:bg-muted/50'
                    }`}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={sizeActive}
                        onChange={() => toggleSize(size.id)}
                      />
                      {size.name}
                    </span>
                    <span className="mt-1 block pl-6 text-xs text-muted-foreground">
                      {size.package_id ? packageNameById.get(size.package_id) || 'Package' : 'No package'}
                    </span>
                  </label>
                );
              })}
              {(selectedSizeSet.sizes || []).length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No sizes in this set.</div>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            Create or select a standard size set before pricing drink options.
          </div>
        )}

        <div className="border border-border rounded-lg overflow-x-auto">
          <table className="w-full min-w-[940px] text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">Option</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">Package</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">Set Price</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">COGS</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">Recommended</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sizes.map((size, idx) => (
                <tr key={size.id}>
                  <td className="px-3 py-2 font-medium">{size.name}</td>
                  <td className="px-3 py-2">{size.package_id ? packageNameById.get(size.package_id) || 'Package' : <span className="text-muted-foreground">No package</span>}</td>
                  <td className="px-3 py-2"><Input type="number" step="0.01" value={size.menu_price ?? ''} onChange={(e) => updateSizePrice(size.id, { menu_price: e.target.value })} /></td>
                  <td className="px-3 py-2">
                    <p className="font-semibold">{money(previewRows[idx]?.cost)}</p>
                    <p className="text-xs text-muted-foreground">Waste {money(previewRows[idx]?.wasteAdjustedCost)}</p>
                  </td>
                  <td className="px-3 py-2">{money(previewRows[idx]?.recommendedPrice)}</td>
                  <td className="px-3 py-2"><StatusPill status={previewRows[idx]?.status || 'red'} /> <span className="ml-2 text-xs text-muted-foreground">{percent(previewRows[idx]?.actualMargin)}</span></td>
                </tr>
              ))}
              {sizes.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-sm text-muted-foreground">No active sizes selected.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}

function sizeSetName(sizeSets = [], sizeSetId) {
  return sizeSets.find((sizeSet) => sizeSet.id === sizeSetId)?.name || 'Different size set';
}

function isLibraryOptionCompatible(record, selectedSizeSetId) {
  return !selectedSizeSetId || !record.size_set_id || record.size_set_id === selectedSizeSetId;
}

function libraryOptionMeta(record, sizeSets, selectedSizeSetId, renderMeta) {
  if (!isLibraryOptionCompatible(record, selectedSizeSetId)) {
    return `Different size set: ${sizeSetName(sizeSets, record.size_set_id)}`;
  }
  return renderMeta?.(record) || (record.size_set_id ? sizeSetName(sizeSets, record.size_set_id) : 'Works with any size set');
}

function LibraryAddPicker({ label, records, selectedIds, onAdd, emptyLabel, selectedSizeSetId, sizeSets, renderMeta }) {
  const [open, setOpen] = useState(false);
  const availableRecords = records.filter((record) => !selectedIds.includes(record.id));
  const allSelected = records.length > 0 && availableRecords.length === 0;
  const triggerLabel = records.length === 0
    ? emptyLabel
    : allSelected
      ? `All ${label.toLowerCase()} selected`
      : `Add ${label.toLowerCase()}`;

  return (
    <div>
      <Label>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="mt-1 w-full justify-between font-normal">
            <span className="truncate">{triggerLabel}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(520px,calc(100vw-2rem))] p-0" align="start">
          <Command>
            <CommandInput placeholder={`Search ${label.toLowerCase()}...`} />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              {availableRecords.length ? (
                <CommandGroup>
                  {availableRecords.map((record) => {
                    return (
                      <CommandItem
                        key={record.id}
                        value={`${record.name} ${libraryOptionMeta(record, sizeSets, selectedSizeSetId, renderMeta)}`}
                        onSelect={() => {
                          onAdd(record.id);
                          setOpen(false);
                        }}
                      >
                        <Plus className="h-4 w-4" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{record.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {libraryOptionMeta(record, sizeSets, selectedSizeSetId, renderMeta)}
                          </span>
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {allSelected ? `All ${label.toLowerCase()} are selected.` : emptyLabel}
                </div>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function SelectedLibraryOptions({ title, records, selectedIds, onRemove, selectedSizeSetId, sizeSets, renderMeta, emptyLabel }) {
  const selectedRecords = selectedIds.map((id) => records.find((record) => record.id === id)).filter(Boolean);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <Label>{title}</Label>
        <span className="text-xs text-muted-foreground">{selectedRecords.length} selected</span>
      </div>
      <div className="mt-2 grid sm:grid-cols-2 gap-2">
        {selectedRecords.map((record) => (
          <div key={record.id} className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{record.name}</p>
                <p className="truncate text-xs text-muted-foreground">{libraryOptionMeta(record, sizeSets, selectedSizeSetId, renderMeta)}</p>
              </div>
              <button type="button" aria-label={`Remove ${record.name}`} className="text-muted-foreground hover:text-destructive" onClick={() => onRemove(record.id)}>
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
        {selectedRecords.length === 0 && (
          <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">{emptyLabel}</div>
        )}
      </div>
    </div>
  );
}

function RecipeOptionsPicker({
  choiceGroups,
  modifiers,
  selectedChoiceGroupIds,
  selectedModifierIds,
  onAddChoiceGroup,
  onRemoveChoiceGroup,
  onAddModifier,
  onRemoveModifier,
  selectedSizeSetId,
  sizeSets,
}) {
  const modifierMeta = (record) => `${toNumber(record.upcharge) ? `+${money(record.upcharge)} ` : ''}${record.size_set_id ? sizeSetName(sizeSets, record.size_set_id) : 'Works with any size set'}`;
  const selectedCount = selectedChoiceGroupIds.length + selectedModifierIds.length;

  return (
    <Panel title="Recipe Options" actions={<span className="text-xs font-medium text-muted-foreground">{selectedCount} selected</span>}>
      <div className="grid gap-4">
        <div className="grid md:grid-cols-2 gap-3">
          <LibraryAddPicker
            label="Choice Groups"
            records={choiceGroups}
            selectedIds={selectedChoiceGroupIds}
            onAdd={onAddChoiceGroup}
            emptyLabel={choiceGroups.length ? 'No matching choice groups' : 'No choice groups yet'}
            selectedSizeSetId={selectedSizeSetId}
            sizeSets={sizeSets}
          />
          <LibraryAddPicker
            label="Modifiers"
            records={modifiers}
            selectedIds={selectedModifierIds}
            onAdd={onAddModifier}
            emptyLabel={modifiers.length ? 'No matching modifiers' : 'No modifiers yet'}
            selectedSizeSetId={selectedSizeSetId}
            sizeSets={sizeSets}
            renderMeta={modifierMeta}
          />
        </div>
        <SelectedLibraryOptions
          title="Selected Choice Groups"
          records={choiceGroups}
          selectedIds={selectedChoiceGroupIds}
          onRemove={onRemoveChoiceGroup}
          selectedSizeSetId={selectedSizeSetId}
          sizeSets={sizeSets}
          emptyLabel="No choice groups selected."
        />
        <SelectedLibraryOptions
          title="Selected Modifiers"
          records={modifiers}
          selectedIds={selectedModifierIds}
          onRemove={onRemoveModifier}
          selectedSizeSetId={selectedSizeSetId}
          sizeSets={sizeSets}
          renderMeta={modifierMeta}
          emptyLabel="No modifiers selected."
        />
      </div>
    </Panel>
  );
}

function IngredientComponentsEditor({ title, form, sizes, data, pricingContext, updateComponent, addComponent, removeComponent }) {
  return (
    <Panel
      title={title}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={() => addComponent('item')}><Plus className="w-3.5 h-3.5" /> Item</Button>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={() => addComponent('prep')}><Plus className="w-3.5 h-3.5" /> Prep</Button>
        </div>
      }
    >
      <div className="space-y-3">
        {(form.components || []).map((row, idx) => (
          <div key={row.id || idx} className="rounded-lg border border-border bg-background p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex rounded-full bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">
                {row.type === 'choice_group' ? 'Choice Group' : row.type === 'prep' ? 'Prep Recipe' : 'Inventory Item'}
              </span>
              <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => removeComponent(idx)}><Trash2 className="w-4 h-4" /></button>
            </div>

            {row.type === 'choice_group' ? (
              <>
                <div className="grid md:grid-cols-[1fr_170px_130px] gap-3">
                  <div>
                    <Label>Choice Group Name</Label>
                    <Input className="mt-1" value={row.label || ''} placeholder="Milk choice" onChange={(e) => updateComponent(idx, { label: e.target.value })} />
                  </div>
                  <div>
                  <Label>Kind</Label>
                  <select className="mt-1 w-full border border-input rounded-md px-2 py-2 bg-background text-sm" value={row.type} onChange={(e) => updateComponent(idx, { type: e.target.value, source_id: '', unit_of_measure: e.target.value === 'choice_group' ? row.unit_of_measure || 'fl-oz' : row.unit_of_measure || '', options: e.target.value === 'choice_group' ? row.options || [] : undefined })}>
                      {ingredientSourceTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                      <option value="choice_group">Choice Group</option>
                    </select>
                  </div>
                  <div>
                    <Label>Measure In</Label>
                    <div className="mt-1">
                      <UomSelect value={row.unit_of_measure || 'fl-oz'} onChange={(unit) => updateComponent(idx, { unit_of_measure: unit })} placeholder="Item UOM" />
                    </div>
                  </div>
                </div>
                <div>
                  <Label>Options</Label>
                  <div className="mt-2">
                    <ChoiceOptions row={row} sizes={sizes} pricingContext={pricingContext} updateRow={(patch) => updateComponent(idx, patch)} data={data} />
                  </div>
                </div>
              </>
            ) : (
              <div className="grid lg:grid-cols-[170px_minmax(260px,1fr)_130px_minmax(180px,0.65fr)] gap-3">
                <div>
                  <Label>Kind</Label>
                  <select className="w-full border border-input rounded-md px-2 py-1.5 bg-background" value={row.type} onChange={(e) => updateComponent(idx, { type: e.target.value, source_id: '', unit_of_measure: e.target.value === 'choice_group' ? row.unit_of_measure || 'fl-oz' : row.unit_of_measure || '', options: e.target.value === 'choice_group' ? [] : undefined })}>
                    {ingredientSourceTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                    <option value="choice_group">Choice Group</option>
                  </select>
                </div>
                <div>
                  <Label>Source</Label>
                  <div className="mt-1">
                    <SourceSelect type={row.type} value={row.source_id} onChange={(value) => updateComponent(idx, { source_id: value })} data={data} />
                  </div>
                </div>
                <div>
                  <Label>Measure In</Label>
                  <div className="mt-1">
                    <UomSelect value={row.unit_of_measure || ''} onChange={(unit) => updateComponent(idx, { unit_of_measure: unit })} placeholder="Item UOM" />
                  </div>
                </div>
                <div>
                  <Label>Label</Label>
                  <Input className="mt-1" value={row.label || ''} placeholder="Optional" onChange={(e) => updateComponent(idx, { label: e.target.value })} />
                </div>
              </div>
            )}

            <div>
              <Label>Amounts by Drink Option{row.type === 'choice_group' ? ` (${row.unit_of_measure || 'fl-oz'})` : row.unit_of_measure ? ` (${row.unit_of_measure})` : ''}</Label>
              <div className="mt-2">
                <AmountInputs sizes={sizes} amounts={row.amounts || {}} onChange={(amounts) => updateComponent(idx, { amounts })} />
              </div>
            </div>
          </div>
        ))}
        {(form.components || []).length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No drink ingredients yet.</div>
        )}
      </div>
    </Panel>
  );
}

function FoodMenuOptions({ form, setForm, size, result, data, updateSize }) {
  const setExtraItems = (next) => setForm((prev) => ({ ...prev, food_extra_items: next }));

  return (
    <>
      <Panel title="Food Preparation">
        <div className="grid gap-4">
          <div className="grid md:grid-cols-[1fr_140px] gap-3">
            <div>
              <Label>Menu Preparation</Label>
              <SourceSelect type="prep" value={form.food_prep_recipe_id || ''} onChange={(value) => setForm((prev) => ({ ...prev, food_prep_recipe_id: value }))} data={data} />
            </div>
            <div>
              <Label>Amount</Label>
              <Input className="mt-1" type="number" step="0.01" value={form.food_prep_quantity ?? 1} onChange={(e) => setForm((prev) => ({ ...prev, food_prep_quantity: e.target.value }))} />
            </div>
          </div>
          <div className="grid md:grid-cols-[1fr_160px_140px_150px_170px] gap-3 items-end">
            <div>
              <Label>Package</Label>
              <PackageSelect value={size.package_id} onChange={(packageId) => updateSize({ package_id: packageId })} packages={data.packages} placeholder="Optional package" />
            </div>
            <div>
              <Label>Set Price</Label>
              <Input className="mt-1" type="number" step="0.01" value={size.menu_price ?? ''} onChange={(e) => updateSize({ menu_price: e.target.value })} />
            </div>
            <div>
              <Label>COGS</Label>
              <div className="h-10 flex flex-col justify-center text-sm">
                <span className="font-semibold">{money(result?.cost)}</span>
                <span className="text-xs text-muted-foreground">Waste {money(result?.wasteAdjustedCost)}</span>
              </div>
            </div>
            <div>
              <Label>Recommended</Label>
              <div className="h-10 flex items-center text-sm font-semibold">{money(result?.recommendedPrice)}</div>
            </div>
            <div>
              <Label>Margin</Label>
              <div className="h-10 flex items-center gap-2"><StatusPill status={result?.status || 'red'} /><span className="text-xs text-muted-foreground">{percent(result?.actualMargin)}</span></div>
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Additional Catalog Items">
        <InventoryLinesEditor lines={form.food_extra_items || []} setLines={setExtraItems} items={data.items} title="Catalog Items" />
      </Panel>
    </>
  );
}

function ChoiceOptions({ row, sizes, pricingContext, updateRow, data }) {
  const addOption = () => {
    const options = row.options || [];
    updateRow({
      options: [
        ...options,
        { id: newId(), label: 'New Option', type: 'item', source_id: '', amounts: {}, upcharge: 0, is_base: options.length === 0 },
      ],
    });
  };
  const updateOption = (idx, patch) => updateRow({ options: (row.options || []).map((option, i) => i === idx ? { ...option, ...patch } : option) });
  const setBaseOption = (idx) => updateRow({ options: (row.options || []).map((option, i) => ({ ...option, is_base: i === idx })) });
  const removeOption = (idx) => updateRow({ options: (row.options || []).filter((_, i) => i !== idx) });

  return (
    <div className="space-y-2">
      {(row.options || []).map((option, idx) => (
        <div key={option.id || idx} className="rounded-md border border-border bg-muted/20 p-2">
          <div className="grid lg:grid-cols-[84px_minmax(140px,0.8fr)_130px_minmax(220px,1.2fr)_110px_28px] gap-2 items-end">
            <label className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <input
                type="radio"
                name={`choice-base-${row.id}`}
                checked={option.is_base === true || (!(row.options || []).some((entry) => entry.is_base) && idx === 0)}
                onChange={() => setBaseOption(idx)}
              />
              Base
            </label>
            <div>
              <Label className="text-xs">Option</Label>
              <Input className="mt-1 h-8 text-xs" value={option.label || ''} onChange={(e) => updateOption(idx, { label: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Kind</Label>
              <select className="mt-1 h-8 w-full border border-input rounded-md px-2 bg-background text-xs" value={option.type || 'item'} onChange={(e) => updateOption(idx, { type: e.target.value, source_id: '' })}>
                {sourceTypes.map((type) => <option key={type.value} value={type.value}>{type.label.replace('Inventory ', '')}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Source</Label>
              <div className="mt-1">
                <SourceSelect type={option.type || 'item'} value={option.source_id} onChange={(value) => updateOption(idx, { source_id: value })} data={data} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Upcharge</Label>
              <Input className="mt-1 h-8 text-xs" type="number" step="0.01" value={option.upcharge ?? ''} onChange={(e) => updateOption(idx, { upcharge: e.target.value })} />
            </div>
            <button type="button" className="mb-2 text-muted-foreground hover:text-destructive" onClick={() => removeOption(idx)}><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
          <div className="mt-3">
            <Label className="text-xs">Amounts by Size ({row.unit_of_measure || option.unit_of_measure || 'fl-oz'})</Label>
            <div className="mt-2">
              <AmountInputs
                sizes={sizes}
                amounts={Object.keys(option.amounts || {}).length ? option.amounts : row.amounts || {}}
                onChange={(amounts) => updateOption(idx, { amounts })}
              />
            </div>
          </div>
          <details className="mt-2 rounded-md border border-border bg-background px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">Math</summary>
            {option.source_id ? (
              <div className="mt-2 space-y-1.5 text-xs">
                {sizes.map((size) => {
                  const optionAmounts = Object.keys(option.amounts || {}).length ? option.amounts : row.amounts || {};
                  const detail = calculateLineCostDetail({
                    ...option,
                    amounts: optionAmounts,
                    quantity: row.quantity,
                    unit_of_measure: option.unit_of_measure || row.unit_of_measure || 'fl-oz',
                  }, pricingContext, size.id);
                  return (
                    <div key={size.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-1.5 first:border-t-0 first:pt-0">
                      <span className="font-medium text-foreground">{size.name}</span>
                      <span className={detail.conversionFailed ? 'text-amber-700' : 'text-muted-foreground'}>
                        {mathLineText(detail)}
                        {toNumber(option.upcharge) > 0 ? `, markup +${money(option.upcharge)}` : ''}
                      </span>
                    </div>
                  );
                })}
                <p className="text-[11px] text-muted-foreground">Source: {calculateLineCostDetail({ ...option, unit_of_measure: row.unit_of_measure || option.unit_of_measure || 'fl-oz' }, pricingContext).sourceName}</p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">Select a source to see the math.</p>
            )}
          </details>
        </div>
      ))}
      {(row.options || []).length === 0 && (
        <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">No choices yet.</div>
      )}
      <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={addOption}><Plus className="w-3.5 h-3.5" /> Add Option</Button>
    </div>
  );
}

function ModifierEditor({ modifier, sizes, data, onChange, onDelete }) {
  const addLine = () => onChange({ lines: [...(modifier.lines || []), { id: newId(), type: 'item', source_id: '', unit_of_measure: '', amounts: {} }] });
  const updateLine = (idx, patch) => onChange({ lines: (modifier.lines || []).map((line, i) => i === idx ? { ...line, ...patch } : line) });
  const removeLine = (idx) => onChange({ lines: (modifier.lines || []).filter((_, i) => i !== idx) });

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="p-3 bg-muted/30 border-b border-border grid md:grid-cols-[minmax(220px,1fr)_160px_32px] gap-3 items-end">
        <div>
          <Label className="text-xs">Modifier Name</Label>
          <Input className="mt-1" value={modifier.name || ''} onChange={(e) => onChange({ name: e.target.value })} placeholder="e.g. Add Shot" />
        </div>
        <div>
          <Label className="text-xs">Menu Upcharge</Label>
          <Input className="mt-1" type="number" step="0.01" value={modifier.upcharge ?? ''} onChange={(e) => onChange({ upcharge: e.target.value })} placeholder="0.00" />
        </div>
        <button type="button" aria-label="Remove modifier" className="mb-2 text-muted-foreground hover:text-destructive" onClick={onDelete}><Trash2 className="w-4 h-4" /></button>
      </div>
      <div className="p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Label>Cost Lines</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Ingredients or prep added when this modifier is selected.</p>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={addLine}><Plus className="w-3.5 h-3.5" /> Add Cost Line</Button>
        </div>
        {(modifier.lines || []).map((line, idx) => (
          <div key={line.id || idx} className="rounded-md border border-border bg-background p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cost Line {idx + 1}</span>
              <button type="button" aria-label={`Remove cost line ${idx + 1}`} className="text-muted-foreground hover:text-destructive" onClick={() => removeLine(idx)}><Trash2 className="w-4 h-4" /></button>
            </div>
            <div className="grid lg:grid-cols-[150px_minmax(240px,1fr)_140px] gap-2 items-end">
              <div>
                <Label className="text-xs">Kind</Label>
                <select className="mt-1 h-9 w-full border border-input rounded-md px-2 bg-background text-sm" value={line.type || 'item'} onChange={(e) => updateLine(idx, { type: e.target.value, source_id: '' })}>
                  {sourceTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Source</Label>
                <div className="mt-1">
                  <SourceSelect type={line.type || 'item'} value={line.source_id} onChange={(value) => updateLine(idx, { source_id: value })} data={data} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Measure In</Label>
                <div className="mt-1">
                  <UomSelect value={line.unit_of_measure || ''} onChange={(unit) => updateLine(idx, { unit_of_measure: unit })} placeholder="Item UOM" />
                </div>
              </div>
            </div>
            <div>
              <Label className="text-xs">Amounts by Drink Option{line.unit_of_measure ? ` (${line.unit_of_measure})` : ''}</Label>
              <div className="mt-2">
                <AmountInputs sizes={sizes} amounts={line.amounts || {}} onChange={(amounts) => updateLine(idx, { amounts })} />
              </div>
            </div>
          </div>
        ))}
        {(modifier.lines || []).length === 0 && (
          <div className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">No cost lines yet. Add one if the modifier changes recipe cost.</div>
        )}
      </div>
    </div>
  );
}

function sanitizePackage(form) {
  return {
    name: form.name?.trim(),
    category: form.category?.trim() || null,
    description: form.description || null,
    is_active: form.is_active !== false,
    lines: (form.lines || []).filter((line) => line.item_id && toNumber(line.quantity) > 0).map((line) => ({
      id: line.id || newId(),
      item_id: line.item_id,
      quantity: toNumber(line.quantity),
    })),
  };
}

function sanitizePrepRecipe(form) {
  return {
    name: form.name?.trim(),
    category: form.category?.trim() || null,
    description: form.description || null,
    yield_quantity: Math.max(toNumber(form.yield_quantity, 1), 0.0001),
    yield_uom: form.yield_uom || null,
    is_active: form.is_active !== false,
    lines: (form.lines || []).filter((line) => line.item_id && toNumber(line.quantity) > 0).map((line) => ({
      id: line.id || newId(),
      item_id: line.item_id,
      quantity: toNumber(line.quantity),
    })),
  };
}

function sanitizeAmounts(amounts = {}) {
  return Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, toNumber(value)]));
}

function sanitizeSourceLine(line) {
  return {
    id: line.id || newId(),
    type: line.type || 'item',
    source_id: line.source_id || '',
    unit_of_measure: line.unit_of_measure || null,
    amounts: sanitizeAmounts(line.amounts || {}),
  };
}

function sanitizeSizeSet(form) {
  return {
    name: form.name?.trim(),
    category: form.category?.trim() || null,
    description: form.description || null,
    sizes: (form.sizes || []).filter((size) => size.name?.trim()).map((size) => ({
      id: size.id || newId(),
      name: size.name.trim(),
      base_size: size.base_size || size.name.trim(),
      service_style: size.service_style || null,
      package_id: size.package_id || null,
    })),
    is_active: form.is_active !== false,
  };
}

function sanitizeChoiceGroup(form) {
  return {
    name: form.name?.trim(),
    category: form.category?.trim() || null,
    description: form.description || null,
    size_set_id: form.size_set_id || null,
    unit_of_measure: form.unit_of_measure || 'fl-oz',
    amounts: sanitizeAmounts(form.amounts || {}),
    options: (form.options || []).filter((option) => option.source_id).map((option) => ({
      id: option.id || newId(),
      label: option.label || '',
      type: option.type || 'item',
      source_id: option.source_id,
      unit_of_measure: option.unit_of_measure || null,
      amounts: sanitizeAmounts(option.amounts || {}),
      upcharge: toNumber(option.upcharge),
      is_base: option.is_base === true,
    })),
    is_active: form.is_active !== false,
  };
}

function sanitizeRecipeModifier(form) {
  return {
    name: form.name?.trim(),
    category: form.category?.trim() || null,
    description: form.description || null,
    size_set_id: form.size_set_id || null,
    upcharge: toNumber(form.upcharge),
    lines: (form.lines || []).filter((line) => line.source_id).map(sanitizeSourceLine),
    is_active: form.is_active !== false,
  };
}

function sanitizeSizePrices(sizePrices = {}) {
  return Object.fromEntries(Object.entries(sizePrices || {}).map(([sizeId, value]) => {
    const menuPrice = value && typeof value === 'object' ? value.menu_price : value;
    return [sizeId, { menu_price: toNumber(menuPrice) }];
  }));
}

function sanitizeMenuRecipe(form, menuCategories = ['Drinks', 'Food']) {
  return {
    name: form.name?.trim(),
    category: menuCategories.includes(form.category) ? form.category : (menuCategories[0] || 'Drinks'),
    description: form.description || null,
    target_margin_override: form.target_margin_override === '' || form.target_margin_override == null ? null : fromPctInput(form.target_margin_override),
    waste_margin_override: form.waste_margin_override === '' || form.waste_margin_override == null ? null : fromPctInput(form.waste_margin_override),
    size_set_id: form.size_set_id || null,
    selected_size_ids: Array.isArray(form.selected_size_ids) ? form.selected_size_ids : [],
    size_prices: sanitizeSizePrices(form.size_prices || {}),
    sizes: (form.sizes || []).filter((size) => size.name?.trim()).map((size) => ({
      id: size.id || newId(),
      name: size.name.trim(),
      base_size: size.base_size || null,
      service_style: size.service_style || null,
      menu_price: toNumber(size.menu_price),
      package_id: size.package_id || null,
    })),
    drink_base_sizes: (form.drink_base_sizes || []).map((size) => String(size).trim()).filter(Boolean),
    drink_service_styles: (form.drink_service_styles || []).filter(Boolean),
    food_prep_recipe_id: form.food_prep_recipe_id || null,
    food_prep_quantity: toNumber(form.food_prep_quantity, 1),
    food_extra_items: (form.food_extra_items || []).filter((line) => line.item_id && toNumber(line.quantity) > 0).map((line) => ({
      id: line.id || newId(),
      item_id: line.item_id,
      quantity: toNumber(line.quantity),
    })),
    components: (form.components || []).filter((row) => row.type === 'choice_group' ? row.options?.length : row.source_id).map((row) => ({
      id: row.id || newId(),
      type: row.type || 'item',
      source_id: row.type === 'choice_group' ? undefined : row.source_id,
      label: row.label || '',
      unit_of_measure: row.unit_of_measure || (row.type === 'choice_group' ? 'fl-oz' : null),
      amounts: sanitizeAmounts(row.amounts || {}),
      options: row.type === 'choice_group'
        ? (row.options || []).filter((option) => option.source_id).map((option) => ({
          id: option.id || newId(),
          label: option.label || sourceLabel(option, {
            itemById: new Map(),
            packageById: new Map(),
            prepById: new Map(),
          }),
          type: option.type || 'item',
          source_id: option.source_id,
          unit_of_measure: option.unit_of_measure || null,
          amounts: sanitizeAmounts(option.amounts || {}),
          upcharge: toNumber(option.upcharge),
          is_base: option.is_base === true,
        }))
        : undefined,
    })),
    choice_group_ids: Array.isArray(form.choice_group_ids) ? form.choice_group_ids : [],
    modifiers: (form.modifiers || []).filter((modifier) => modifier.name?.trim()).map((modifier) => ({
      id: modifier.id || newId(),
      name: modifier.name.trim(),
      upcharge: toNumber(modifier.upcharge),
      lines: (modifier.lines || []).filter((line) => line.source_id).map(sanitizeSourceLine),
    })),
    modifier_ids: Array.isArray(form.modifier_ids) ? form.modifier_ids : [],
    set_pricing: form.set_pricing || {},
    is_active: form.is_active !== false,
  };
}

function stableSignature(value) {
  return JSON.stringify(value ?? null);
}

function buildMarginPayloads(settings = []) {
  return settings
    .filter((setting) => setting.category)
    .map((setting) => ({
      category: setting.category,
      target_margin: toPercentNumber(setting.target_margin, DEFAULT_TARGET_MARGIN),
      waste_margin: toPercentNumber(setting.waste_margin, DEFAULT_WASTE_MARGIN),
      yellow_margin_points: toPercentNumber(setting.yellow_margin_points, DEFAULT_YELLOW_MARGIN_POINTS),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

function sortByName(records = []) {
  return [...records].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export default function RecipesPricing() {
  const { companyId, user } = useAuth();
  const [activeTab, setActiveTab] = useState('pricing');
  const [items, setItems] = useState([]);
  const [locInv, setLocInv] = useState([]);
  const [locations, setLocations] = useState([]);
  const [sizeSets, setSizeSets] = useState([]);
  const [packages, setPackages] = useState([]);
  const [prepRecipes, setPrepRecipes] = useState([]);
  const [choiceGroups, setChoiceGroups] = useState([]);
  const [recipeModifiers, setRecipeModifiers] = useState([]);
  const [menuRecipes, setMenuRecipes] = useState([]);
  const [marginSettings, setMarginSettings] = useState([]);
  const [inventoryCategories, setInventoryCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [sizeSetForm, setSizeSetForm] = useState(emptySizeSet());
  const [packageForm, setPackageForm] = useState(emptyPackage());
  const [prepForm, setPrepForm] = useState(emptyPrepRecipe());
  const [choiceGroupForm, setChoiceGroupForm] = useState(emptyChoiceGroup());
  const [modifierForm, setModifierForm] = useState(emptyRecipeModifier());
  const [menuForm, setMenuForm] = useState(emptyMenuRecipe());
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [exploreRecipeId, setExploreRecipeId] = useState('');
  const [selectedModifierIds, setSelectedModifierIds] = useState([]);
  const [autoSaveStatus, setAutoSaveStatus] = useState({
    sizeSet: 'idle',
    package: 'idle',
    prep: 'idle',
    choiceGroup: 'idle',
    modifier: 'idle',
    menu: 'idle',
    margins: 'idle',
  });
  const autoSaveBaselinesRef = useRef({
    sizeSet: stableSignature(sanitizeSizeSet(emptySizeSet())),
    package: stableSignature(sanitizePackage(emptyPackage())),
    prep: stableSignature(sanitizePrepRecipe(emptyPrepRecipe())),
    choiceGroup: stableSignature(sanitizeChoiceGroup(emptyChoiceGroup())),
    modifier: stableSignature(sanitizeRecipeModifier(emptyRecipeModifier())),
    menu: stableSignature(sanitizeMenuRecipe(emptyMenuRecipe(), ['Drinks', 'Food'])),
    margins: stableSignature([]),
  });
  const latestAutoSaveSignatureRef = useRef({});
  const autoSaveRequestRef = useRef({});

  const load = async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError('');
    try {
      const [itms, stock, locs, sets, pkgs, prep, groups, modifiers, menus, margins, cats] = await Promise.all([
        base44.entities.InventoryItem.filter({ company_id: companyId, is_active: true }),
        base44.entities.LocationInventory.filter({ company_id: companyId }),
        base44.entities.Location.filter({ company_id: companyId, is_active: true }),
        base44.entities.RecipeSizeSet.filter({ company_id: companyId, is_active: true }, 'name'),
        base44.entities.RecipePackage.filter({ company_id: companyId, is_active: true }, 'name'),
        base44.entities.PrepRecipe.filter({ company_id: companyId, is_active: true }, 'name'),
        base44.entities.RecipeChoiceGroup.filter({ company_id: companyId, is_active: true }, 'name'),
        base44.entities.RecipeModifier.filter({ company_id: companyId, is_active: true }, 'name'),
        base44.entities.MenuRecipe.filter({ company_id: companyId, is_active: true }, 'name'),
        base44.entities.RecipeMarginSetting.filter({ company_id: companyId }, 'category'),
        base44.entities.InventoryCategory.filter({ company_id: companyId }).catch(() => []),
      ]);
      setItems(itms);
      setLocInv(stock);
      setLocations(locs);
      setSizeSets(sets);
      setPackages(pkgs);
      setPrepRecipes(prep);
      setChoiceGroups(groups);
      setRecipeModifiers(modifiers);
      setMenuRecipes(menus);
      setMarginSettings(margins);
      setInventoryCategories(cats);
      autoSaveBaselinesRef.current.margins = stableSignature(buildMarginPayloads(margins));
      setExploreRecipeId((current) => current || menus[0]?.id || '');
    } catch (error) {
      console.error('Failed to load recipes and pricing', error);
      setLoadError(error.message || 'Unable to load recipes and pricing.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [companyId]);

  const categorySettings = useMemo(
    () => mergeInventoryCategories(inventoryCategories, items),
    [inventoryCategories, items]
  );
  const menuCategoryOptions = useMemo(
    () => salesItemCategoryNames(categorySettings),
    [categorySettings]
  );
  const pricingContext = useMemo(
    () => buildPricingContext({ items, locInv, locations, packages, prepRecipes, sizeSets, choiceGroups, recipeModifiers }),
    [items, locInv, locations, packages, prepRecipes, sizeSets, choiceGroups, recipeModifiers]
  );

  const data = { items, packages, prepRecipes, sizeSets, choiceGroups, recipeModifiers };
  const categories = useMemo(() => {
    const names = new Set(menuCategoryOptions);
    menuRecipes.forEach((record) => {
      if (record.category) names.add(record.category);
    });
    return [...names].sort();
  }, [menuCategoryOptions, menuRecipes]);

  const setAutoStatus = (key, status) => {
    setAutoSaveStatus((current) => ({ ...current, [key]: status }));
  };

  const rememberBaseline = (key, payload) => {
    autoSaveBaselinesRef.current[key] = stableSignature(payload);
  };

  const mergeSavedRecord = (setRecords, saved) => {
    if (!saved?.id) return;
    setRecords((current) => {
      const exists = current.some((record) => record.id === saved.id);
      const next = exists
        ? current.map((record) => record.id === saved.id ? { ...record, ...saved } : record)
        : [...current, saved];
      return sortByName(next);
    });
  };

  const saveAutoRecord = async ({ key, entity, form, payload, signature, setForm, setRecords }) => {
    const requestId = (autoSaveRequestRef.current[key] || 0) + 1;
    autoSaveRequestRef.current[key] = requestId;
    setAutoStatus(key, 'saving');

    try {
      const saved = form.id
        ? await base44.entities[entity].update(form.id, payload)
        : await base44.entities[entity].create(payload);
      if (autoSaveRequestRef.current[key] !== requestId) return;

      autoSaveBaselinesRef.current[key] = signature;
      mergeSavedRecord(setRecords, saved);
      if (!form.id && saved?.id) {
        setForm((current) => current.id ? current : { ...current, id: saved.id });
      }
      setAutoStatus(key, latestAutoSaveSignatureRef.current[key] === signature ? 'saved' : 'pending');
    } catch (error) {
      console.error(`Auto-save failed for ${entity}`, error);
      setAutoStatus(key, 'error');
    }
  };

  const selectSizeSet = (record) => {
    const next = { ...record, sizes: record.sizes || [] };
    rememberBaseline('sizeSet', sanitizeSizeSet(next));
    setAutoStatus('sizeSet', 'idle');
    setSizeSetForm(next);
  };

  const newSizeSet = () => {
    const next = emptySizeSet();
    rememberBaseline('sizeSet', sanitizeSizeSet(next));
    setAutoStatus('sizeSet', 'idle');
    setSizeSetForm(next);
  };

  const selectPackage = (record) => {
    const next = { ...record, lines: record.lines || [] };
    rememberBaseline('package', sanitizePackage(next));
    setAutoStatus('package', 'idle');
    setPackageForm(next);
  };

  const newPackage = () => {
    const next = emptyPackage();
    rememberBaseline('package', sanitizePackage(next));
    setAutoStatus('package', 'idle');
    setPackageForm(next);
  };

  const selectPrepRecipe = (record) => {
    const next = { ...record, lines: record.lines || [] };
    rememberBaseline('prep', sanitizePrepRecipe(next));
    setAutoStatus('prep', 'idle');
    setPrepForm(next);
  };

  const selectChoiceGroup = (record) => {
    const next = {
      ...record,
      size_set_id: record.size_set_id || '',
      amounts: record.amounts || {},
      options: record.options || [],
    };
    rememberBaseline('choiceGroup', sanitizeChoiceGroup(next));
    setAutoStatus('choiceGroup', 'idle');
    setChoiceGroupForm(next);
  };

  const newChoiceGroup = () => {
    const next = emptyChoiceGroup();
    rememberBaseline('choiceGroup', sanitizeChoiceGroup(next));
    setAutoStatus('choiceGroup', 'idle');
    setChoiceGroupForm(next);
  };

  const selectModifier = (record) => {
    const next = {
      ...record,
      size_set_id: record.size_set_id || '',
      lines: record.lines || [],
    };
    rememberBaseline('modifier', sanitizeRecipeModifier(next));
    setAutoStatus('modifier', 'idle');
    setModifierForm(next);
  };

  const newModifier = () => {
    const next = emptyRecipeModifier();
    rememberBaseline('modifier', sanitizeRecipeModifier(next));
    setAutoStatus('modifier', 'idle');
    setModifierForm(next);
  };

  const newPrepRecipe = () => {
    const next = emptyPrepRecipe();
    rememberBaseline('prep', sanitizePrepRecipe(next));
    setAutoStatus('prep', 'idle');
    setPrepForm(next);
  };

  const selectMenuRecipe = (record) => {
    const next = {
      ...emptyMenuRecipe(),
      ...record,
      size_set_id: record.size_set_id || '',
      selected_size_ids: record.selected_size_ids || [],
      size_prices: record.size_prices || {},
      sizes: record.sizes || [],
      drink_base_sizes: record.drink_base_sizes || [],
      drink_service_styles: record.drink_service_styles || [],
      food_prep_recipe_id: record.food_prep_recipe_id || '',
      food_prep_quantity: record.food_prep_quantity || 1,
      food_extra_items: record.food_extra_items || [],
      components: record.components || [],
      choice_group_ids: record.choice_group_ids || [],
      modifiers: record.modifiers || [],
      modifier_ids: record.modifier_ids || [],
      set_pricing: record.set_pricing || {},
    };
    rememberBaseline('menu', sanitizeMenuRecipe(next, menuCategoryOptions));
    setAutoStatus('menu', 'idle');
    setMenuForm(next);
  };

  const newMenuRecipe = () => {
    const next = emptyMenuRecipe();
    rememberBaseline('menu', sanitizeMenuRecipe(next, menuCategoryOptions));
    setAutoStatus('menu', 'idle');
    setMenuForm(next);
  };

  const selectedExploreRecipe = menuRecipes.find((recipe) => recipe.id === exploreRecipeId) || menuRecipes[0] || null;
  const selectedExploreMatrixRecipe = selectedExploreRecipe ? recipeForPricingMatrix(selectedExploreRecipe, sizeSets) : null;
  const selectedExploreRecipeForPricing = selectedExploreMatrixRecipe
    ? resolveMenuRecipe(selectedExploreMatrixRecipe, pricingContext, { includeAllSizes: true })
    : null;
  const scenarios = selectedExploreMatrixRecipe ? buildChoiceScenarios(selectedExploreMatrixRecipe, 80, pricingContext) : [];
  const pricingRows = menuRecipes.flatMap((recipe) => {
    const matrixRecipe = recipeForPricingMatrix(recipe, sizeSets);
    return (resolveMenuRecipe(matrixRecipe, pricingContext, { includeAllSizes: true })?.sizes || []).map((size) => {
      const result = calculateMenuSize(matrixRecipe, size, pricingContext, marginSettings, {}, [], { includeAllSizes: true });
      const snapshot = recipe.set_pricing?.[size.id];
      return { recipe: matrixRecipe, sourceRecipe: recipe, size, result, snapshot };
    });
  });
  const offPricingRows = pricingRows.filter((row) => row.result.status !== 'green');
  const yellowPricingCount = offPricingRows.filter((row) => row.result.status === 'yellow').length;
  const redPricingCount = offPricingRows.filter((row) => row.result.status === 'red').length;

  useEffect(() => {
    if (!companyId) return;
    const payload = sanitizeSizeSet(sizeSetForm);
    const signature = stableSignature(payload);
    latestAutoSaveSignatureRef.current.sizeSet = signature;
    if (signature === autoSaveBaselinesRef.current.sizeSet) return;
    if (!sizeSetForm.name?.trim()) {
      setAutoStatus('sizeSet', 'idle');
      return;
    }

    setAutoStatus('sizeSet', 'pending');
    const timeout = window.setTimeout(() => {
      saveAutoRecord({
        key: 'sizeSet',
        entity: 'RecipeSizeSet',
        form: sizeSetForm,
        payload,
        signature,
        setForm: setSizeSetForm,
        setRecords: setSizeSets,
      });
    }, AUTO_SAVE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [companyId, sizeSetForm]);

  useEffect(() => {
    if (!companyId) return;
    const payload = sanitizePackage(packageForm);
    const signature = stableSignature(payload);
    latestAutoSaveSignatureRef.current.package = signature;
    if (signature === autoSaveBaselinesRef.current.package) return;
    if (!packageForm.name?.trim()) {
      setAutoStatus('package', 'idle');
      return;
    }

    setAutoStatus('package', 'pending');
    const timeout = window.setTimeout(() => {
      saveAutoRecord({
        key: 'package',
        entity: 'RecipePackage',
        form: packageForm,
        payload,
        signature,
        setForm: setPackageForm,
        setRecords: setPackages,
      });
    }, AUTO_SAVE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [companyId, packageForm]);

  useEffect(() => {
    if (!companyId) return;
    const payload = sanitizePrepRecipe(prepForm);
    const signature = stableSignature(payload);
    latestAutoSaveSignatureRef.current.prep = signature;
    if (signature === autoSaveBaselinesRef.current.prep) return;
    if (!prepForm.name?.trim()) {
      setAutoStatus('prep', 'idle');
      return;
    }

    setAutoStatus('prep', 'pending');
    const timeout = window.setTimeout(() => {
      saveAutoRecord({
        key: 'prep',
        entity: 'PrepRecipe',
        form: prepForm,
        payload,
        signature,
        setForm: setPrepForm,
        setRecords: setPrepRecipes,
      });
    }, AUTO_SAVE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [companyId, prepForm]);

  useEffect(() => {
    if (!companyId) return;
    const payload = sanitizeChoiceGroup(choiceGroupForm);
    const signature = stableSignature(payload);
    latestAutoSaveSignatureRef.current.choiceGroup = signature;
    if (signature === autoSaveBaselinesRef.current.choiceGroup) return;
    if (!choiceGroupForm.name?.trim()) {
      setAutoStatus('choiceGroup', 'idle');
      return;
    }

    setAutoStatus('choiceGroup', 'pending');
    const timeout = window.setTimeout(() => {
      saveAutoRecord({
        key: 'choiceGroup',
        entity: 'RecipeChoiceGroup',
        form: choiceGroupForm,
        payload,
        signature,
        setForm: setChoiceGroupForm,
        setRecords: setChoiceGroups,
      });
    }, AUTO_SAVE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [companyId, choiceGroupForm]);

  useEffect(() => {
    if (!companyId) return;
    const payload = sanitizeRecipeModifier(modifierForm);
    const signature = stableSignature(payload);
    latestAutoSaveSignatureRef.current.modifier = signature;
    if (signature === autoSaveBaselinesRef.current.modifier) return;
    if (!modifierForm.name?.trim()) {
      setAutoStatus('modifier', 'idle');
      return;
    }

    setAutoStatus('modifier', 'pending');
    const timeout = window.setTimeout(() => {
      saveAutoRecord({
        key: 'modifier',
        entity: 'RecipeModifier',
        form: modifierForm,
        payload,
        signature,
        setForm: setModifierForm,
        setRecords: setRecipeModifiers,
      });
    }, AUTO_SAVE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [companyId, modifierForm]);

  useEffect(() => {
    if (!companyId) return;
    const payload = sanitizeMenuRecipe(menuForm, menuCategoryOptions);
    const signature = stableSignature(payload);
    latestAutoSaveSignatureRef.current.menu = signature;
    if (signature === autoSaveBaselinesRef.current.menu) return;
    if (!menuForm.name?.trim()) {
      setAutoStatus('menu', 'idle');
      return;
    }

    setAutoStatus('menu', 'pending');
    const timeout = window.setTimeout(() => {
      saveAutoRecord({
        key: 'menu',
        entity: 'MenuRecipe',
        form: menuForm,
        payload,
        signature,
        setForm: setMenuForm,
        setRecords: setMenuRecipes,
      });
    }, AUTO_SAVE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [companyId, menuForm, menuCategoryOptions]);

  const requestDelete = (entity, form, resetForm, label) => {
    if (!form.id) return;
    setDeleteTarget({
      entity,
      id: form.id,
      name: form.name,
      resetForm,
      label,
    });
  };

  const confirmDelete = async () => {
    if (!deleteTarget?.id) return;
    setSaving(true);
    try {
      await base44.entities[deleteTarget.entity].update(deleteTarget.id, { is_active: false });
      toast.success(`${deleteTarget.label} deleted`);
      deleteTarget.resetForm();
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(error.message || 'Delete failed');
    } finally {
      setSaving(false);
    }
  };

  const saveMargin = async (category, patch) => {
    const existing = marginSettings.find((setting) => setting.category === category);
    const payload = {
      category,
      target_margin: toPercentNumber(patch.target_margin, DEFAULT_TARGET_MARGIN),
      waste_margin: toPercentNumber(patch.waste_margin, DEFAULT_WASTE_MARGIN),
      yellow_margin_points: toPercentNumber(patch.yellow_margin_points, DEFAULT_YELLOW_MARGIN_POINTS),
    };
    if (existing?.id) return base44.entities.RecipeMarginSetting.update(existing.id, payload);
    return base44.entities.RecipeMarginSetting.create(payload);
  };

  useEffect(() => {
    if (!companyId) return;
    const payloads = buildMarginPayloads(marginSettings);
    const signature = stableSignature(payloads);
    latestAutoSaveSignatureRef.current.margins = signature;
    if (signature === autoSaveBaselinesRef.current.margins) return;
    if (!payloads.length) {
      setAutoStatus('margins', 'idle');
      return;
    }

    setAutoStatus('margins', 'pending');
    const timeout = window.setTimeout(async () => {
      const requestId = (autoSaveRequestRef.current.margins || 0) + 1;
      autoSaveRequestRef.current.margins = requestId;
      setAutoStatus('margins', 'saving');
      try {
        const savedRows = [];
        for (const payload of payloads) {
          const saved = await saveMargin(payload.category, payload);
          if (saved) savedRows.push(saved);
        }
        if (autoSaveRequestRef.current.margins !== requestId) return;

        autoSaveBaselinesRef.current.margins = signature;
        if (savedRows.length) {
          setMarginSettings((current) => current.map((setting) => {
            const saved = savedRows.find((row) => row.category === setting.category);
            return saved ? { ...setting, ...saved } : setting;
          }));
        }
        setAutoStatus('margins', latestAutoSaveSignatureRef.current.margins === signature ? 'saved' : 'pending');
      } catch (error) {
        console.error('Auto-save failed for margin settings', error);
        setAutoStatus('margins', 'error');
      }
    }, AUTO_SAVE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [companyId, marginSettings]);

  const setMenuPricing = async (recipe) => {
    const set_pricing = {};
    const matrixRecipe = recipeForPricingMatrix(recipe, sizeSets);
    const recipeForPricing = resolveMenuRecipe(matrixRecipe, pricingContext, { includeAllSizes: true });
    for (const size of recipeForPricing?.sizes || []) {
      const result = calculateMenuSize(matrixRecipe, size, pricingContext, marginSettings, {}, [], { includeAllSizes: true });
      set_pricing[size.id] = {
        menu_price: result.setPrice,
        cost: result.cost,
        waste_adjusted_cost: result.wasteAdjustedCost,
        recommended_price: result.recommendedPrice,
        actual_margin: result.actualMargin,
        target_margin: result.targetMargin,
        waste_margin: result.wasteMargin,
        set_at: new Date().toISOString(),
        set_by: user?.email || null,
      };
    }
    const saved = await base44.entities.MenuRecipe.update(recipe.id, { set_pricing });
    toast.success('Menu pricing set');
    setMenuForm((current) => current.id === saved.id ? { ...current, set_pricing: saved.set_pricing || set_pricing } : current);
    mergeSavedRecord(setMenuRecipes, saved);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );

  if (loadError) {
    const missingTable = loadError.toLowerCase().includes('could not find the table');
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
        <PageHeader title="Recipes & Pricing" subtitle="Live COGS, packages, prep recipes, menu pricing, and variation margins" />
        <div className="border border-destructive/30 bg-destructive/5 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive mt-0.5" />
            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-destructive">Unable to load Recipes & Pricing</h2>
                <p className="text-sm text-muted-foreground mt-1">{loadError}</p>
                {missingTable && (
                  <p className="text-sm text-muted-foreground mt-2">
                    Run the Recipes & Pricing Supabase migration, then reload this page.
                  </p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={load}>Retry</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <PageHeader title="Recipes & Pricing" subtitle="Live COGS, packages, prep recipes, menu pricing, and variation margins" />

      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabItems.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium whitespace-nowrap ${
                activeTab === tab.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:bg-muted/50'
              }`}
            >
              <Icon className="w-4 h-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'settings' && (
        <div className="space-y-5">
          <MarginSettingsTable categories={categories} settings={marginSettings} setSettings={setMarginSettings} autosaveStatus={autoSaveStatus.margins} />
        </div>
      )}

      {activeTab === 'pricing' && (
        <div className="space-y-5">
          <Panel
            title="Pricing Issues"
            actions={
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">{yellowPricingCount} Yellow</span>
                <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-red-700">{redPricingCount} Red</span>
              </div>
            }
          >
            {offPricingRows.length > 0 ? (
              <div className="space-y-2">
                {offPricingRows.map(({ recipe, size, result }) => (
                  <div key={`${recipe.id}-${size.id}`} className={`border rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2 ${statusClasses(result.status)}`}>
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="text-sm font-medium">{recipe.name} - {size.name}</span>
                      <span className="text-xs">Set {money(result.setPrice)} recommends {money(result.recommendedPrice)}</span>
                      {result.gap > 0 && <span className="text-xs">Gap {money(result.gap)}</span>}
                    </div>
                    <StatusPill status={result.status} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">All built menu pricing is green.</div>
            )}
          </Panel>

          <Panel title="Set Menu Pricing vs Recommended">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    {['Recipe', 'Size', 'Live COGS', 'Waste COGS', 'Set Price', 'Recommended', 'Margin', 'Status', ''].map((heading) => (
                      <th key={heading} className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pricingRows.map(({ recipe, size, result }) => (
                    <tr key={`${recipe.id}-${size.id}`}>
                      <td className="px-3 py-2 font-medium">{recipe.name}</td>
                      <td className="px-3 py-2">{size.name}</td>
                      <td className="px-3 py-2">{money(result.cost)}</td>
                      <td className="px-3 py-2">{money(result.wasteAdjustedCost)}</td>
                      <td className="px-3 py-2">{money(result.setPrice)}</td>
                      <td className="px-3 py-2 font-semibold">{money(result.recommendedPrice)}</td>
                      <td className="px-3 py-2">{percent(result.actualMargin)}</td>
                      <td className="px-3 py-2"><StatusPill status={result.status} /></td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="outline" size="sm" className="h-8" onClick={() => setMenuPricing(recipe)}>Set Menu Pricing</Button>
                      </td>
                    </tr>
                  ))}
                  {menuRecipes.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-muted-foreground">No menu recipes yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            title="Choice Pricing Matrix"
            actions={
              <select className="border border-input rounded-md px-3 py-2 bg-background text-sm" value={selectedExploreRecipe?.id || ''} onChange={(e) => { setExploreRecipeId(e.target.value); setSelectedModifierIds([]); }}>
                {menuRecipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}
              </select>
            }
          >
            {selectedExploreRecipe ? (
              <div className="space-y-4">
                {(selectedExploreRecipeForPricing?.modifiers || []).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {(selectedExploreRecipeForPricing?.modifiers || []).map((modifier) => {
                      const checked = selectedModifierIds.includes(modifier.id);
                      return (
                        <button
                          key={modifier.id}
                          type="button"
                          onClick={() => setSelectedModifierIds((current) => checked ? current.filter((id) => id !== modifier.id) : [...current, modifier.id])}
                          className={`px-3 py-1.5 rounded-lg border text-sm ${checked ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:bg-muted/50'}`}
                        >
                          {modifier.name} {toNumber(modifier.upcharge) ? `+${money(modifier.upcharge)}` : ''}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[920px] text-sm">
                    <thead className="bg-muted/30">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Variation</th>
                        {(selectedExploreRecipeForPricing?.sizes || []).map((size) => <th key={size.id} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{size.name}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {scenarios.map((scenario) => (
                        <tr key={scenario.id}>
                          <td className="px-3 py-3 font-medium">{scenario.label}</td>
                          {(selectedExploreRecipeForPricing?.sizes || []).map((size) => {
                            const result = calculateMenuSize(selectedExploreMatrixRecipe, size, pricingContext, marginSettings, scenario.selections, selectedModifierIds, { includeAllSizes: true });
                            return (
                              <td key={size.id} className="px-3 py-3 align-top">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2"><StatusPill status={result.status} /><span className="text-xs text-muted-foreground">{percent(result.actualMargin)}</span></div>
                                  <p className="text-xs text-muted-foreground">COGS {money(result.wasteAdjustedCost)}</p>
                                  <p className="text-xs font-semibold">Rec {money(result.recommendedPrice)}</p>
                                  {result.gap > 0 && <p className="text-xs text-red-600">Gap {money(result.gap)}</p>}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Create a menu recipe to explore variations.</p>
            )}
          </Panel>
        </div>
      )}

      {activeTab === 'sizes' && (
        <div className="grid lg:grid-cols-[280px_1fr] gap-4">
          <RecipeList records={sizeSets} selectedId={sizeSetForm.id} onSelect={selectSizeSet} onNew={newSizeSet} emptyLabel="No size sets yet." />
          <SizeSetEditor
            form={sizeSetForm}
            setForm={setSizeSetForm}
            packages={packages}
            onDelete={() => requestDelete('RecipeSizeSet', sizeSetForm, () => setSizeSetForm(emptySizeSet()), 'Size set')}
            saving={saving}
            autosaveStatus={autoSaveStatus.sizeSet}
          />
        </div>
      )}

      {activeTab === 'packages' && (
        <div className="grid lg:grid-cols-[280px_1fr] gap-4">
          <RecipeList records={packages} selectedId={packageForm.id} onSelect={selectPackage} onNew={newPackage} emptyLabel="No packages yet." />
          <PackageEditor
            form={packageForm}
            setForm={setPackageForm}
            items={items}
            onDelete={() => requestDelete('RecipePackage', packageForm, () => setPackageForm(emptyPackage()), 'Package')}
            saving={saving}
            pricingContext={pricingContext}
            autosaveStatus={autoSaveStatus.package}
          />
        </div>
      )}

      {activeTab === 'prep' && (
        <div className="grid lg:grid-cols-[280px_1fr] gap-4">
          <RecipeList records={prepRecipes} selectedId={prepForm.id} onSelect={selectPrepRecipe} onNew={newPrepRecipe} emptyLabel="No prep recipes yet." />
          <PrepEditor
            form={prepForm}
            setForm={setPrepForm}
            items={items}
            onDelete={() => requestDelete('PrepRecipe', prepForm, () => setPrepForm(emptyPrepRecipe()), 'Prep recipe')}
            saving={saving}
            pricingContext={pricingContext}
            autosaveStatus={autoSaveStatus.prep}
          />
        </div>
      )}

      {activeTab === 'choiceGroups' && (
        <div className="grid lg:grid-cols-[280px_1fr] gap-4">
          <RecipeList records={choiceGroups} selectedId={choiceGroupForm.id} onSelect={selectChoiceGroup} onNew={newChoiceGroup} emptyLabel="No choice groups yet." />
          <ChoiceGroupEditor
            form={choiceGroupForm}
            setForm={setChoiceGroupForm}
            data={data}
            pricingContext={pricingContext}
            onDelete={() => requestDelete('RecipeChoiceGroup', choiceGroupForm, () => setChoiceGroupForm(emptyChoiceGroup()), 'Choice group')}
            saving={saving}
            autosaveStatus={autoSaveStatus.choiceGroup}
          />
        </div>
      )}

      {activeTab === 'modifiers' && (
        <div className="grid lg:grid-cols-[280px_1fr] gap-4">
          <RecipeList records={recipeModifiers} selectedId={modifierForm.id} onSelect={selectModifier} onNew={newModifier} emptyLabel="No modifiers yet." />
          <RecipeModifierEditor
            form={modifierForm}
            setForm={setModifierForm}
            data={data}
            onDelete={() => requestDelete('RecipeModifier', modifierForm, () => setModifierForm(emptyRecipeModifier()), 'Modifier')}
            saving={saving}
            autosaveStatus={autoSaveStatus.modifier}
          />
        </div>
      )}

      {activeTab === 'menu' && (
        <div className="grid lg:grid-cols-[280px_1fr] gap-4">
          <RecipeList records={menuRecipes} selectedId={menuForm.id} onSelect={selectMenuRecipe} onNew={newMenuRecipe} emptyLabel="No menu recipes yet." />
          <MenuEditor
            form={menuForm}
            setForm={setMenuForm}
            data={data}
            menuCategories={menuCategoryOptions}
            onDelete={() => requestDelete('MenuRecipe', menuForm, () => setMenuForm(emptyMenuRecipe()), 'Menu recipe')}
            onSetPricing={() => setMenuPricing(menuForm)}
            saving={saving}
            autosaveStatus={autoSaveStatus.menu}
            pricingContext={pricingContext}
            marginSettings={marginSettings}
          />
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.label}</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove {deleteTarget?.name ? `"${deleteTarget.name}"` : 'this record'} from active recipes and pricing. You can recreate it later, but it will no longer appear in recipe builders.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              disabled={saving}
              onClick={(event) => {
                event.preventDefault();
                confirmDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MarginSettingsTable({ categories, settings, setSettings, autosaveStatus }) {
  const getSetting = (category) => settings.find((setting) => setting.category === category) || {
    category,
    target_margin: DEFAULT_TARGET_MARGIN,
    waste_margin: DEFAULT_WASTE_MARGIN,
    yellow_margin_points: DEFAULT_YELLOW_MARGIN_POINTS,
  };
  const updateSetting = (category, patch) => {
    setSettings((current) => {
      const existing = current.find((setting) => setting.category === category);
      if (existing) return current.map((setting) => setting.category === category ? { ...setting, ...patch } : setting);
      return [...current, { category, ...patch }];
    });
  };

  return (
    <Panel title="Category Margin Settings" actions={<AutoSaveStatus status={autosaveStatus} canSave />}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Category</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Target Margin %</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Waste Margin %</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Yellow Window %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {categories.map((category) => {
              const setting = getSetting(category);
              return (
                <tr key={category}>
                  <td className="px-3 py-2 font-medium">{category}</td>
                  <td className="px-3 py-2"><Input type="number" step="0.1" value={pctInput(setting.target_margin, DEFAULT_TARGET_MARGIN)} onChange={(e) => updateSetting(category, { target_margin: fromPctInput(e.target.value) })} /></td>
                  <td className="px-3 py-2"><Input type="number" step="0.1" value={pctInput(setting.waste_margin, DEFAULT_WASTE_MARGIN)} onChange={(e) => updateSetting(category, { waste_margin: fromPctInput(e.target.value) })} /></td>
                  <td className="px-3 py-2"><Input type="number" step="0.1" value={pctInput(setting.yellow_margin_points, DEFAULT_YELLOW_MARGIN_POINTS)} onChange={(e) => updateSetting(category, { yellow_margin_points: fromPctInput(e.target.value) })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
