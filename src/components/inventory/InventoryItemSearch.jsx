import { useState, useMemo } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

export function inventoryItemLabel(item) {
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
      option.vendor_item_number,
      option.item_code,
      option.supplier_item_number,
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

export default function InventoryItemSearch({ value, onChange, items, extractedName = '' }) {
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
