import { useState, useEffect } from 'react';
import { roastery } from '@/api/roastery';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { calcWholesalePrice, calcActualMargin, formatCurrency } from '@/lib/roasteryPricingUtils';
import { TrendingUp, TrendingDown, Minus, DollarSign, Pencil, Check, X, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// Groups BlendComponentRotation records by go_live_date to represent recipe versions
function groupBlendByVersion(records) {
  const groups = {};
  for (const r of records) {
    const key = r.go_live_date || '__no_date__';
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }
  return groups;
}

const DEFAULT_BAG_SIZES = [
  { key: '10oz', label: '10 oz', fill_weight_lbs: 10 / 16 },
  { key: '2lb',  label: '2 lb',  fill_weight_lbs: 2 },
  { key: '5lb',  label: '5 lb',  fill_weight_lbs: 5 },
];

function marginColor(actual, target) {
  if (actual === null) return null;
  const diff = actual - target;
  if (diff >= -2) return 'green';
  if (diff >= -8) return 'yellow';
  return 'red';
}

function MarginIndicator({ actual, target, recommended }) {
  if (actual === null) return <span className="text-muted-foreground text-xs">—</span>;
  const color = marginColor(actual, target);
  const diff = actual - target;
  const cls = {
    green:  'text-green-700 bg-green-50 border-green-200',
    yellow: 'text-amber-700 bg-amber-50 border-amber-200',
    red:    'text-red-700 bg-red-50 border-red-200',
  }[color];
  const Icon = color === 'green' ? TrendingUp : color === 'yellow' ? Minus : TrendingDown;
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border', cls)}>
        <Icon className="w-3 h-3" />
        {actual.toFixed(1)}%
      </span>
      {color !== 'green' && recommended && (
        <span className="text-[10px] text-muted-foreground">rec: {formatCurrency(recommended)}</span>
      )}
    </div>
  );
}

export default function SlotPricingPanel({ slot, coffees, rotations, blendCoffeeId, isManager, company, onSlotUpdated }) {
  const [editingPrices, setEditingPrices] = useState(false);
  const [draftPrices, setDraftPrices] = useState({});
  const [pricingRecords, setPricingRecords] = useState([]);
  const [blendComponentRotations, setBlendComponentRotations] = useState([]);

  const bagSizes = company?.bag_sizes?.length ? company.bag_sizes : DEFAULT_BAG_SIZES;
  const slotPrices = Object.fromEntries((slot.slot_prices || []).map(p => [p.size_key, p]));
  const coffeeMap = Object.fromEntries(coffees.map(c => [c.id, c]));

  // For blend slots, fetch BlendComponentRotation records
  useEffect(() => {
    if (!blendCoffeeId) { setBlendComponentRotations([]); return; }
    roastery.entities.BlendComponentRotation.filter({ blend_id: blendCoffeeId })
      .then(setBlendComponentRotations);
  }, [blendCoffeeId]);

  // Fetch pricing records for all relevant coffees (rotations + blend components)
  useEffect(() => {
    const rotationIds = rotations.map(r => r.green_coffee_id).filter(Boolean);
    const componentIds = blendComponentRotations.map(r => r.component_coffee_id).filter(Boolean);
    const coffeeIds = [...new Set([...rotationIds, ...componentIds])];
    if (!coffeeIds.length) return;
    Promise.all(
      coffeeIds.map(id =>
        roastery.entities.PricingRecord.filter({ company_id: slot.company_id, green_coffee_id: id }, '-created_date')
          .then(records => ({ coffeeId: id, record: records[0] || null }))
      )
    ).then(results => {
      setPricingRecords(Object.fromEntries(results.map(r => [r.coffeeId, r.record])));
    });
  }, [rotations, blendComponentRotations, slot.company_id]);

  const startEdit = () => {
    const draft = {};
    bagSizes.forEach(s => {
      draft[`ws_${s.key}`] = slotPrices[s.key]?.wholesale || '';
      draft[`rt_${s.key}`] = slotPrices[s.key]?.retail || '';
    });
    setDraftPrices(draft);
    setEditingPrices(true);
  };

  const savePrices = async () => {
    const newPrices = bagSizes.map(s => ({
      size_key: s.key,
      wholesale: parseFloat(draftPrices[`ws_${s.key}`]) || null,
      retail: parseFloat(draftPrices[`rt_${s.key}`]) || null,
    })).filter(p => p.wholesale || p.retail);
    await roastery.entities.CategorySlot.update(slot.id, { slot_prices: newPrices });
    toast.success('Slot prices saved');
    setEditingPrices(false);
    onSlotUpdated();
  };

  const cancelEdit = () => setEditingPrices(false);

  // For a single-origin coffee: margin check against slot price
  const getAlignmentForCoffee = (coffeeId, sizeKey, type) => {
    const size = bagSizes.find(s => s.key === sizeKey);
    if (!size) return null;
    const slotPrice = slotPrices[sizeKey]?.[type];
    if (!slotPrice) return null;
    const record = pricingRecords[coffeeId];
    if (!record) return null;

    const greenCost = record.green_cost_per_lb;
    const bagCost = record[`bag_cost_${sizeKey}`] ?? 0.8;
    const weightLoss = record.weight_loss_pct ?? 15;
    const target = record.target_margin_pct ?? 64;

    const actual = calcActualMargin(slotPrice, greenCost, bagCost, weightLoss, size.fill_weight_lbs);
    const recommended = calcWholesalePrice(greenCost, bagCost, target, weightLoss, size.fill_weight_lbs);
    return { actual, target, recommended: type === 'retail' ? recommended * 2 : recommended };
  };

  // For a blend recipe (array of {component_coffee_id, percentage}): compute weighted avg green cost → margin
  const getAlignmentForBlendRecipe = (components, sizeKey, type) => {
    const size = bagSizes.find(s => s.key === sizeKey);
    if (!size) return null;
    const slotPrice = slotPrices[sizeKey]?.[type];
    if (!slotPrice) return null;
    if (!components.length) return null;

    // Weighted average green cost
    let totalWeight = 0;
    let weightedCost = 0;
    let weightedBagCost = 0;
    let weightedWeightLoss = 0;
    let target = 64;

    for (const comp of components) {
      const record = pricingRecords[comp.component_coffee_id];
      if (!record) return null; // can't compute if any component is missing
      const pct = (parseFloat(comp.percentage) || 0) / 100;
      totalWeight += pct;
      weightedCost += (record.green_cost_per_lb || 0) * pct;
      weightedBagCost += ((record[`bag_cost_${sizeKey}`] ?? 0.8)) * pct;
      weightedWeightLoss += (record.weight_loss_pct ?? 15) * pct;
      target = record.target_margin_pct ?? 64; // use last component's target (all should share)
    }

    if (totalWeight === 0) return null;
    const greenCost = weightedCost / totalWeight;
    const bagCost = weightedBagCost / totalWeight;
    const weightLoss = weightedWeightLoss / totalWeight;

    const actual = calcActualMargin(slotPrice, greenCost, bagCost, weightLoss, size.fill_weight_lbs);
    const recommended = calcWholesalePrice(greenCost, bagCost, target, weightLoss, size.fill_weight_lbs);
    return { actual, target, recommended: type === 'retail' ? recommended * 2 : recommended, weightedGreenCost: greenCost };
  };

  const [marginView, setMarginView] = useState('current');

  const hasAnyPrices = (slot.slot_prices || []).length > 0;
  const isBlendSlot = !!blendCoffeeId;

  // For blend slots: group components into recipe versions for margin analysis
  // "current" = live recipe, "queued" = upcoming/waiting_for_input recipe versions
  let blendRecipes = []; // [{ label, components: [{component_coffee_id, percentage}], hasAllPricingData }]
  if (isBlendSlot) {
    const liveComponents = blendComponentRotations.filter(r => r.status === 'live');
    const upcomingComponents = blendComponentRotations.filter(r => r.status === 'upcoming' || r.status === 'waiting_for_input');
    if (marginView === 'current' && liveComponents.length > 0) {
      blendRecipes = [{ label: 'Live Recipe', components: liveComponents, dateLabel: null }];
    } else if (marginView === 'queued') {
      const groups = groupBlendByVersion(upcomingComponents);
      blendRecipes = Object.entries(groups).map(([dateKey, group]) => ({
        label: dateKey !== '__no_date__' ? `Go live: ${dateKey}` : 'Upcoming Recipe',
        components: group,
        dateLabel: dateKey !== '__no_date__' ? dateKey : null,
      }));
    }
  }

  // For single-origin slots
  const currentRotations = isBlendSlot ? [] : rotations.filter(r => ['live_in_store', 'live_online'].includes(r.status) && r.green_coffee_id);
  const queuedRotations  = isBlendSlot ? [] : rotations.filter(r => ['waiting_for_input', 'coming_soon'].includes(r.status) && r.green_coffee_id);
  const relevantRotations = marginView === 'current' ? currentRotations : queuedRotations;

  // Counts for toggle labels
  const currentCount = isBlendSlot
    ? (blendComponentRotations.filter(r => r.status === 'live').length > 0 ? 1 : 0)
    : currentRotations.length;
  const queuedCount = isBlendSlot
    ? Object.keys(groupBlendByVersion(blendComponentRotations.filter(r => r.status === 'upcoming' || r.status === 'waiting_for_input'))).length
    : queuedRotations.length;

  return (
    <div className="border border-border rounded-xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Slot Prices</span>
          {!hasAnyPrices && <span className="text-xs text-muted-foreground italic">not set</span>}
        </div>
        {isManager && !editingPrices && (
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2 gap-1" onClick={startEdit}>
            <Pencil className="w-3 h-3" /> {hasAnyPrices ? 'Edit' : 'Set Prices'}
          </Button>
        )}
        {editingPrices && (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-6 text-xs px-2 gap-1 text-green-700" onClick={savePrices}>
              <Check className="w-3 h-3" /> Save
            </Button>
            <Button variant="ghost" size="sm" className="h-6 text-xs px-2 gap-1 text-muted-foreground" onClick={cancelEdit}>
              <X className="w-3 h-3" /> Cancel
            </Button>
          </div>
        )}
      </div>

      {/* Price inputs (edit mode) */}
      {editingPrices && (
        <div className="space-y-2">
          <div className="grid text-xs font-medium text-muted-foreground pb-1" style={{ gridTemplateColumns: '5rem 1fr 1fr' }}>
            <span>Size</span><span>Wholesale</span><span>Retail</span>
          </div>
          {bagSizes.map(size => (
            <div key={size.key} className="grid items-center gap-2" style={{ gridTemplateColumns: '5rem 1fr 1fr' }}>
              <Label className="text-xs">{size.label}</Label>
              <Input type="number" step="0.01" placeholder="$0.00" className="h-7 text-xs"
                value={draftPrices[`ws_${size.key}`] || ''}
                onChange={e => setDraftPrices(d => ({ ...d, [`ws_${size.key}`]: e.target.value }))} />
              <Input type="number" step="0.01" placeholder="$0.00" className="h-7 text-xs"
                value={draftPrices[`rt_${size.key}`] || ''}
                onChange={e => setDraftPrices(d => ({ ...d, [`rt_${size.key}`]: e.target.value }))} />
            </div>
          ))}
        </div>
      )}

      {/* Price display + margin health per coffee */}
      {!editingPrices && hasAnyPrices && (
        <div className="space-y-3">
          {/* Set prices header row */}
          <div>
            <div className="grid text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1"
              style={{ gridTemplateColumns: '5rem 1fr 1fr' }}>
              <span>Size</span><span>Wholesale</span><span>Retail</span>
            </div>
            {bagSizes.map(size => {
              const p = slotPrices[size.key];
              if (!p?.wholesale && !p?.retail) return null;
              return (
                <div key={size.key} className="grid text-sm py-0.5" style={{ gridTemplateColumns: '5rem 1fr 1fr' }}>
                  <span className="text-xs text-muted-foreground">{size.label}</span>
                  <span className="font-mono text-xs">{p?.wholesale ? formatCurrency(p.wholesale) : '—'}</span>
                  <span className="font-mono text-xs">{p?.retail ? formatCurrency(p.retail) : '—'}</span>
                </div>
              );
            })}
          </div>

          {/* Per-coffee / per-recipe margin analysis */}
          {(currentCount > 0 || queuedCount > 0) && (
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Margin Check</p>
                <div className="flex rounded-md border border-border overflow-hidden text-[10px] font-medium">
                  <button
                    className={cn('px-2 py-0.5 transition-colors', marginView === 'current' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
                    onClick={() => setMarginView('current')}
                  >
                    Current ({currentCount})
                  </button>
                  <button
                    className={cn('px-2 py-0.5 transition-colors border-l border-border', marginView === 'queued' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
                    onClick={() => setMarginView('queued')}
                  >
                    In Queue ({queuedCount})
                  </button>
                </div>
              </div>

              {/* Blend slot: show one card per recipe version with weighted avg margin */}
              {isBlendSlot && blendRecipes.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No recipe in this view.</p>
              )}
              {isBlendSlot && blendRecipes.map((recipe, i) => {
                const missingPricing = recipe.components.some(c => !pricingRecords[c.component_coffee_id]);
                const issues = missingPricing ? [] : bagSizes.flatMap(size => {
                  const ws = getAlignmentForBlendRecipe(recipe.components, size.key, 'wholesale');
                  const rt = getAlignmentForBlendRecipe(recipe.components, size.key, 'retail');
                  return [ws, rt].filter(x => x && marginColor(x.actual, x.target) !== 'green');
                });

                return (
                  <div key={i} className="rounded-lg border border-border bg-background p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium">{recipe.label}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {recipe.components.map(c => `${coffeeMap[c.component_coffee_id]?.name || '?'} ${c.percentage}%`).join(' · ')}
                        </span>
                      </div>
                      {missingPricing ? (
                        <span className="text-[10px] text-amber-600 flex items-center gap-0.5">
                          <AlertTriangle className="w-3 h-3" /> Missing cost data
                        </span>
                      ) : issues.length === 0 ? (
                        <span className="text-[10px] text-green-700 font-medium">✓ margins OK</span>
                      ) : (
                        <span className="text-[10px] text-red-600 flex items-center gap-0.5">
                          <AlertTriangle className="w-3 h-3" /> {issues.length} issue{issues.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {!missingPricing && (
                      <div className="space-y-1">
                        <div className="grid text-[10px] text-muted-foreground" style={{ gridTemplateColumns: '5rem 1fr 1fr' }}>
                          <span></span><span>Wholesale</span><span>Retail</span>
                        </div>
                        {bagSizes.map(size => {
                          const p = slotPrices[size.key];
                          if (!p?.wholesale && !p?.retail) return null;
                          const ws = getAlignmentForBlendRecipe(recipe.components, size.key, 'wholesale');
                          const rt = getAlignmentForBlendRecipe(recipe.components, size.key, 'retail');
                          return (
                            <div key={size.key} className="grid items-center" style={{ gridTemplateColumns: '5rem 1fr 1fr' }}>
                              <span className="text-[10px] text-muted-foreground">{size.label}</span>
                              <MarginIndicator actual={ws?.actual ?? null} target={ws?.target ?? 64} recommended={ws?.recommended} />
                              <MarginIndicator actual={rt?.actual ?? null} target={rt?.target ?? 64} recommended={rt?.recommended} />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Single-origin slot: show one card per coffee rotation */}
              {!isBlendSlot && relevantRotations.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No coffees in this view.</p>
              )}
              {!isBlendSlot && relevantRotations.map(rotation => {
                const coffee = coffees.find(c => c.id === rotation.green_coffee_id);
                const record = pricingRecords[rotation.green_coffee_id];
                if (!coffee) return null;

                const issues = record ? bagSizes.flatMap(size => {
                  const ws = getAlignmentForCoffee(rotation.green_coffee_id, size.key, 'wholesale');
                  const rt = getAlignmentForCoffee(rotation.green_coffee_id, size.key, 'retail');
                  return [ws, rt].filter(x => x && marginColor(x.actual, x.target) !== 'green');
                }) : [];

                return (
                  <div key={rotation.id} className="rounded-lg border border-border bg-background p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">{coffee.name}</span>
                      {!record && (
                        <span className="text-[10px] text-amber-600 flex items-center gap-0.5">
                          <AlertTriangle className="w-3 h-3" /> No pricing record
                        </span>
                      )}
                      {record && issues.length === 0 && (
                        <span className="text-[10px] text-green-700 font-medium">✓ margins OK</span>
                      )}
                      {record && issues.length > 0 && (
                        <span className="text-[10px] text-red-600 flex items-center gap-0.5">
                          <AlertTriangle className="w-3 h-3" /> {issues.length} issue{issues.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {record && (
                      <div className="space-y-1">
                        <div className="grid text-[10px] text-muted-foreground" style={{ gridTemplateColumns: '5rem 1fr 1fr' }}>
                          <span></span><span>Wholesale</span><span>Retail</span>
                        </div>
                        {bagSizes.map(size => {
                          const p = slotPrices[size.key];
                          if (!p?.wholesale && !p?.retail) return null;
                          const ws = getAlignmentForCoffee(rotation.green_coffee_id, size.key, 'wholesale');
                          const rt = getAlignmentForCoffee(rotation.green_coffee_id, size.key, 'retail');
                          return (
                            <div key={size.key} className="grid items-center" style={{ gridTemplateColumns: '5rem 1fr 1fr' }}>
                              <span className="text-[10px] text-muted-foreground">{size.label}</span>
                              <MarginIndicator actual={ws?.actual ?? null} target={ws?.target ?? 64} recommended={ws?.recommended} />
                              <MarginIndicator actual={rt?.actual ?? null} target={rt?.target ?? 64} recommended={rt?.recommended} />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}