// Shared money-input helpers for location forms (DashboardSettings + the Master
// Location Control Panel).

export const normalizeMoney = (value) => Math.max(0, Number.parseFloat(value) || 0);

export const normalizeOptionalMoney = (value) =>
  String(value).trim() === "" ? null : normalizeMoney(value);

export const formatMoneyInput = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : "";
};

export const preventNegativeAmountKey = (event) => {
  if (["-", "+", "e", "E"].includes(event.key)) {
    event.preventDefault();
  }
};

export const hasLocationDrawerOverride = (loc) =>
  loc?.cash_drawer_amount !== null && loc?.cash_drawer_amount !== undefined;
