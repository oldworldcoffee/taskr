import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { calcWholesalePrice, calcRetailPrice, calcRoastedCostPerLb, formatCurrency } from '@/lib/roasteryPricingUtils';

function MathBreakdown({ greenCost, bagCost, weightLossPct, targetMarginPct, fillWeightLbs }) {
  const roastedCostPerLb = greenCost / (1 - weightLossPct / 100);
  const coffeeCost = roastedCostPerLb * fillWeightLbs;
  const totalCost = coffeeCost + bagCost;
  const wholesale = totalCost / (1 - targetMarginPct / 100);

  return (
    <div className="mt-1 mb-2 ml-4 bg-muted/40 border border-border/60 rounded-md p-3 text-xs space-y-1 font-mono text-muted-foreground">
      <div className="text-[10px] font-sans font-semibold uppercase tracking-wide text-muted-foreground mb-2">Step-by-step</div>
      <div>Roasted cost/lb = {formatCurrency(greenCost)} ÷ (1 − {weightLossPct}%) = <strong className="text-foreground">{formatCurrency(roastedCostPerLb)}/lb</strong></div>
      <div>Coffee cost ({fillWeightLbs} lbs) = {formatCurrency(roastedCostPerLb)}/lb × {fillWeightLbs} lbs = <strong className="text-foreground">{formatCurrency(coffeeCost)}</strong></div>
      <div>Total cost = {formatCurrency(coffeeCost)} + {formatCurrency(bagCost)} bag = <strong className="text-foreground">{formatCurrency(totalCost)}</strong></div>
      <div>Wholesale = {formatCurrency(totalCost)} ÷ (1 − {targetMarginPct}%) = <strong className="text-foreground">{formatCurrency(wholesale)}</strong></div>
    </div>
  );
}

export default function PricingTable({ greenCost, params, bagSizes }) {
  const [expandedSize, setExpandedSize] = useState(null);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Calculated Pricing</p>
        <span className="text-xs text-muted-foreground">
          Roasted: <strong>{formatCurrency(calcRoastedCostPerLb(greenCost, params.weight_loss_pct))}/lb</strong>
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 text-xs font-medium text-muted-foreground">Size</th>
            <th className="text-right py-2 text-xs font-medium text-muted-foreground">Wholesale</th>
            <th className="text-right py-2 text-xs font-medium text-muted-foreground">Retail (MSRP)</th>
            <th className="w-6"></th>
          </tr>
        </thead>
        <tbody>
          {bagSizes.map(size => {
            const bagCost = params[`bag_cost_${size.key}`] ?? 0.8;
            const wholesale = calcWholesalePrice(greenCost, bagCost, params.target_margin_pct, params.weight_loss_pct, size.fill_weight_lbs);
            const retail = calcRetailPrice(wholesale, params.retail_markup_pct ?? 100);
            const isOpen = expandedSize === size.key;
            return (
              <React.Fragment key={size.key}>
                <tr className="border-b last:border-0">
                  <td className="py-2 font-medium">{size.label}</td>
                  <td className="py-2 text-right font-mono">{formatCurrency(wholesale)}</td>
                  <td className="py-2 text-right font-mono">{formatCurrency(retail)}</td>
                  <td className="py-2 pl-2">
                    <button
                      onClick={() => setExpandedSize(isOpen ? null : size.key)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="Show math"
                    >
                      {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={4} className="pb-2">
                      <MathBreakdown
                        greenCost={greenCost}
                        bagCost={bagCost}
                        weightLossPct={params.weight_loss_pct}
                        targetMarginPct={params.target_margin_pct}
                        fillWeightLbs={size.fill_weight_lbs}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      <div className="border-t border-border/50 pt-2 mt-1 text-xs text-muted-foreground">
        Wholesale target: <strong>{params.target_margin_pct}%</strong> · Retail markup: <strong>{params.retail_markup_pct ?? 100}%</strong> ({((params.retail_markup_pct ?? 100) / 100 + 1).toFixed(2)}× wholesale)
      </div>
    </div>
  );
}