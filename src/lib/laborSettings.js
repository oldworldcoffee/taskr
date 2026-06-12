// Shared shape + defaults for per-location financial labor settings.
// These settings are absorbed onto the location row (locations.financial_settings_json);
// this module is the single source of the field shape used by both the standalone
// Labor Settings page and the Master Location Control Panel.

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const defaultOperatingHours = {
  0: { open: "09:00", close: "22:00", enabled: true },
  1: { open: "09:00", close: "22:00", enabled: true },
  2: { open: "09:00", close: "22:00", enabled: true },
  3: { open: "09:00", close: "22:00", enabled: true },
  4: { open: "09:00", close: "22:00", enabled: true },
  5: { open: "09:00", close: "23:00", enabled: true },
  6: { open: "09:00", close: "23:00", enabled: true },
};

// Normalize a stored labor-settings blob (or row) into the controlled form shape.
export function settingsFromData(data) {
  return {
    labor_cost_mode: data?.labor_cost_mode || "simplified",
    hourly_rate: data?.hourly_rate ?? "",
    target_labor_pct: data?.target_labor_pct ?? "",
    floor_hourly_rate: data?.floor_hourly_rate ?? "",
    tax_percentage: data?.tax_percentage ?? "",
    benefits_percentage: data?.benefits_percentage ?? "",
    manager_compensation: data?.manager_compensation ?? "",
    manager_hours_allocated: data?.manager_hours_allocated ?? "",
    labor_cost_offset: data?.labor_cost_offset ?? "",
    yearly_sales_offset_pct: data?.yearly_sales_offset_pct ?? "",
    operating_hours: data?.operating_hours || defaultOperatingHours,
  };
}
