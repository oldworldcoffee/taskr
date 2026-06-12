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

  // Default the selected location to the first active one once locations load.
  useEffect(() => {
    if (locations.length > 0) {
      const valid = locations.find((l) => l.id === selectedLocation && l.is_active !== false);
      if (!valid) {
        const firstActive = locations.find((l) => l.is_active !== false) || locations[0];
        if (firstActive) updateSelectedLocation(firstActive.id);
      }
    }
  }, [locations]);  

  const activeLocations = locations.filter((l) => l.is_active !== false);

  // Synthetic tenant: id == company_id, plus Square connection fields.
  const tenant = companyId ? { id: companyId, ...(settings || {}) } : null;
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
