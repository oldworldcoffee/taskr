import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";

// Module-level context for the Financial Management module. Adapted from the
// base44 app's AppContext: the base44 tenant/membership model is replaced by
// taskr's company + role model. `tenant` is a synthetic object whose `id` is the
// company_id, merged with the company's Square connection settings (tokens
// stripped server-side), so ported pages keep working with minimal edits.
const FinancialContext = createContext(null);

export function FinancialProvider({ children }) {
  const { user, companyId } = useAuth();

  const [settings, setSettings] = useState(null);
  const [locations, setLocations] = useState([]);
  const [laborSettings, setLaborSettings] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedLocation, setSelectedLocation] = useState(
    () => localStorage.getItem("pref_financial_location") || ""
  );
  const [salesMetric, setSalesMetric] = useState(
    () => localStorage.getItem("pref_financial_sales_metric") || "rolling_3_week"
  );

  const updateSelectedLocation = (id) => {
    setSelectedLocation(id);
    localStorage.setItem("pref_financial_location", id);
  };

  const updateSalesMetric = (metric) => {
    setSalesMetric(metric);
    localStorage.setItem("pref_financial_sales_metric", metric);
  };

  const refresh = useCallback(async () => {
    if (!companyId) {
      setSettings(null);
      setLocations([]);
      setLaborSettings([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await base44.functions.invoke("financialGetContext", {});
      setSettings(res.data?.settings || null);
      setLocations(res.data?.locations || []);
      setLaborSettings(res.data?.laborSettings || []);
    } catch {
      setSettings(null);
      setLocations([]);
      setLaborSettings([]);
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Locations are "active" for Financial when they're active AND have the
  // Financial module enabled in the unified location config.
  const activeLocations = locations.filter((l) => l.is_active !== false && l.is_financial_enabled !== false);

  // Default the selected location to the first Financial-enabled one once loaded.
  useEffect(() => {
    if (activeLocations.length > 0) {
      const valid = activeLocations.find((l) => l.id === selectedLocation);
      if (!valid) updateSelectedLocation(activeLocations[0].id);
    }
  }, [locations]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Synthetic tenant: carries the Square connection fields, but id/company_id
  // MUST be the company id — spread settings first so the financial_settings
  // row's own primary key can't overwrite them (it would break every
  // company-scoped schedule/shift query).
  const tenant = companyId
    ? { ...(settings || {}), id: companyId, company_id: companyId }
    : null;
  // Synthetic membership from taskr role (admins/managers act as owners here).
  const membership = user
    ? { role: ["admin", "super_admin"].includes(user.role) ? "owner" : user.role }
    : null;

  return (
    <FinancialContext.Provider
      value={{
        companyId,
        tenant,
        settings,
        locations,
        activeLocations,
        laborSettings,
        membership,
        loading,
        refresh,
        selectedLocation,
        setSelectedLocation: updateSelectedLocation,
        salesMetric,
        setSalesMetric: updateSalesMetric,
      }}
    >
      {children}
    </FinancialContext.Provider>
  );
}

export function useFinancial() {
  return useContext(FinancialContext);
}

// Back-compat alias so lightly-edited ported pages can keep `useAppContext`.
export const useAppContext = useFinancial;
