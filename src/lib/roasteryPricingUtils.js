/**
 * Pricing calculation utilities matching the spreadsheet logic
 * Green cost per lb → apply weight loss → add bag cost → apply markup → recommended wholesale
 * MSRP = wholesale * 2
 */

export function calcRoastedCostPerLb(greenCostPerLb, weightLossPct = 15) {
  const factor = 1 / (1 - weightLossPct / 100);
  return greenCostPerLb * factor;
}

// fillWeightLbs = fill weight of the bag in lbs (e.g. 10oz → 0.625, 2lb → 2, 250g → 0.5512)
export function calcWholesalePrice(greenCostPerLb, bagCost, targetMarginPct = 64, weightLossPct = 15, fillWeightLbs = 0.625) {
  const roastedCost = calcRoastedCostPerLb(greenCostPerLb, weightLossPct);
  const coffeeCost = roastedCost * fillWeightLbs;
  const totalCost = coffeeCost + bagCost;
  const wholesale = totalCost / (1 - targetMarginPct / 100);
  return wholesale;
}

// retailMarkupPct = markup over wholesale, e.g. 100 = 2×, 50 = 1.5×
export function calcRetailPrice(wholesalePrice, retailMarkupPct = 100) {
  return wholesalePrice * (1 + retailMarkupPct / 100);
}

export function calcActualMargin(actualPrice, greenCostPerLb, bagCost, weightLossPct = 15, fillWeightLbs = 0.625) {
  const roastedCost = calcRoastedCostPerLb(greenCostPerLb, weightLossPct);
  const coffeeCost = roastedCost * fillWeightLbs;
  const totalCost = coffeeCost + bagCost;
  if (actualPrice <= 0) return 0;
  return ((actualPrice - totalCost) / actualPrice) * 100;
}

// Parse a human-readable size string into fill weight lbs
// e.g. "10oz" → 0.625, "2lb" → 2, "250g" → 0.5512, "1kg" → 2.2046
export function parseSizeToLbs(str) {
  const s = str.toLowerCase().trim();
  const num = parseFloat(s);
  if (isNaN(num)) return null;
  if (s.includes('kg')) return num * 2.20462;
  if (s.includes('g') && !s.includes('lb')) return num / 453.592;
  if (s.includes('oz')) return num / 16;
  if (s.includes('lb')) return num;
  return null;
}

export function calcLandedCostPerLb(greenCostPerLb, freightTotal, tariffTotal, storageTotal, totalLbs) {
  if (totalLbs <= 0) return greenCostPerLb;
  const extraCostPerLb = (freightTotal + tariffTotal + storageTotal) / totalLbs;
  return greenCostPerLb + extraCostPerLb;
}

export function calcEstimatedRunoutDate(lbsOnHand, lbsWarehused, weeklyUsageLbs) {
  if (!weeklyUsageLbs || weeklyUsageLbs <= 0) return null;
  const totalLbs = (lbsOnHand || 0) + (lbsWarehused || 0);
  const weeksRemaining = totalLbs / weeklyUsageLbs;
  const runoutDate = new Date();
  runoutDate.setDate(runoutDate.getDate() + weeksRemaining * 7);
  return runoutDate;
}

export function formatCurrency(val, decimals = 2) {
  if (val === null || val === undefined) return '—';
  return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function formatLbs(val) {
  if (val === null || val === undefined) return '—';
  return `${Number(val).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} lbs`;
}