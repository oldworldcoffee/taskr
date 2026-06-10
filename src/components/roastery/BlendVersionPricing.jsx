import React, { useState, useEffect } from 'react';
import { roastery } from '@/api/roastery';
import { formatCurrency } from '@/lib/roasteryPricingUtils';
import { cn } from '@/lib/utils';
import { Layers, AlertTriangle } from 'lucide-react';
import PricingTable from '@/components/roastery/PricingTable';

const STAGE_CONFIG = {
  live:              { label: 'Live',          color: 'bg-green-100 text-green-700 border-green-200' },
  upcoming:          { label: 'Scheduled',     color: 'bg-purple-100 text-purple-700 border-purple-200' },
  waiting_for_input: { label: 'Needs Review',  color: 'bg-amber-100 text-amber-700 border-amber-200' },
};

function groupByVersion(records) {
  const groups = {};
  for (const r of records) {
    const key = r.status === 'live' ? '__live__' : (r.go_live_date || '__no_date__');
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }
  return groups;
}

function pct(components) {
  return components.reduce((s, c) => s + (parseFloat(c.percentage) || 0), 0);
}


export default function BlendVersionPricing({ blend, lots, params, bagSizes, coffees }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState('__live__');

  const coffeeMap = Object.fromEntries(coffees.map(c => [c.id, c]));
  const lotMap = Object.fromEntries(lots.map(l => [l.green_coffee_id, l]));

  useEffect(() => {
    if (!blend?.id) return;
    setLoading(true);
    roastery.entities.BlendComponentRotation.filter({ blend_id: blend.id })
      .then(data => {
        setRecords(data.filter(r => r.status !== 'retired'));
        setLoading(false);
      });
  }, [blend?.id]);

  if (loading) return <div className="flex justify-center py-4"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  const allGroups = groupByVersion(records);

  // Sort: live first, then waiting_for_input, then upcoming by date
  const sortedKeys = Object.keys(allGroups).sort((a, b) => {
    if (a === '__live__') return -1;
    if (b === '__live__') return 1;
    const aStatus = allGroups[a][0]?.status;
    const bStatus = allGroups[b][0]?.status;
    const order = { waiting_for_input: 0, upcoming: 1 };
    const aOrd = order[aStatus] ?? 2;
    const bOrd = order[bStatus] ?? 2;
    if (aOrd !== bOrd) return aOrd - bOrd;
    return a.localeCompare(b);
  });

  if (sortedKeys.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground text-sm">
        <Layers className="w-6 h-6 mx-auto mb-2 opacity-30" />
        No blend recipe versions found. Use the Release Schedule to add recipe changes.
      </div>
    );
  }

  // Ensure selected version is valid
  const activeKey = sortedKeys.includes(selectedVersion) ? selectedVersion : sortedKeys[0];
  const activeGroup = allGroups[activeKey] || [];
  const activeStatus = activeKey === '__live__' ? 'live' : (activeGroup[0]?.status || 'upcoming');

  // Calculate weighted average landed cost for this version
  const calcBlendCost = (group) => {
    let totalPct = 0;
    let weightedCost = 0;
    const missing = [];
    for (const comp of group) {
      const lot = lotMap[comp.component_coffee_id];
      const pctVal = parseFloat(comp.percentage) || 0;
      if (lot?.landed_cost_per_lb && pctVal > 0) {
        weightedCost += lot.landed_cost_per_lb * pctVal;
        totalPct += pctVal;
      } else if (pctVal > 0) {
        missing.push(coffeeMap[comp.component_coffee_id]?.name || comp.component_coffee_id);
      }
    }
    const cost = totalPct > 0 ? weightedCost / totalPct : null;
    return { cost, missing };
  };

  const { cost: blendCost, missing } = calcBlendCost(activeGroup);
  const greenCost = blendCost;

  return (
    <div className="space-y-4">
      {/* Version tabs */}
      {sortedKeys.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {sortedKeys.map(key => {
            const group = allGroups[key];
            const status = key === '__live__' ? 'live' : (group[0]?.status || 'upcoming');
            const cfg = STAGE_CONFIG[status] || STAGE_CONFIG.upcoming;
            const label = key === '__live__' ? 'Live Recipe' : (key === '__no_date__' ? 'Scheduled (no date)' : `Go Live: ${key}`);
            return (
              <button
                key={key}
                onClick={() => setSelectedVersion(key)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                  activeKey === key ? cfg.color : 'border-border bg-background text-muted-foreground hover:border-primary/40'
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Selected version: components + pricing */}
      <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-4">
        {/* Components */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Recipe Components</p>
          <div className="space-y-1">
            {activeGroup.map(comp => {
              const coffee = coffeeMap[comp.component_coffee_id];
              const lot = lotMap[comp.component_coffee_id];
              return (
                <div key={comp.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span>{coffee?.name || 'Unknown'}</span>
                    {lot?.landed_cost_per_lb
                      ? <span className="text-xs text-muted-foreground">({formatCurrency(lot.landed_cost_per_lb)}/lb landed)</span>
                      : <span className="text-xs text-amber-600 flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" />no lot</span>}
                  </div>
                  <span className="font-medium text-primary">{comp.percentage}%</span>
                </div>
              );
            })}
            <div className="border-t border-border/50 pt-1 flex justify-between text-xs text-muted-foreground">
              <span>Total</span>
              <span className={pct(activeGroup) === 100 ? 'text-primary font-medium' : 'text-destructive font-medium'}>
                {pct(activeGroup)}%
              </span>
            </div>
          </div>
        </div>

        {/* Pricing table */}
        {greenCost ? (
          <PricingTable greenCost={greenCost} params={params} bagSizes={bagSizes} />
        ) : (
          <div className="text-sm text-amber-700 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {missing.length > 0
              ? `Can't calculate cost — no inventory lots for: ${missing.join(', ')}`
              : 'No component lots found to calculate blend cost.'}
          </div>
        )}
      </div>
    </div>
  );
}