import { createContext, useContext } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { roastery } from '@/api/roastery';
import { useAuth } from '@/lib/AuthContext';

const RoasteryContext = createContext(null);

// Mirrors the company context the Roast & Source pages were written against:
// `company` carries the roastery's bag sizes and pricing defaults
// (stored per company in roastery_settings) plus the taskr company name.
export function RoasteryProvider({ children }) {
  const { user, hasRoasteryPermission } = useAuth();
  const queryClient = useQueryClient();
  const companyId = user?.company_id || null;

  const { data: companyInfo } = useQuery({
    queryKey: ['company-info'],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const res = await base44.functions.invoke('getCompanyInfo', {});
      return res.data.success ? res.data.company : null;
    },
  });

  const { data: settings, isLoading: loadingSettings } = useQuery({
    queryKey: ['roastery-settings', companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const rows = await roastery.entities.Settings.filter({ company_id: companyId });
      return rows[0] || null;
    },
  });

  const role = user?.role;
  const isAdmin = role === 'admin' || role === 'super_admin';
  const isManager = isAdmin || role === 'manager';

  const company = companyId
    ? {
        id: companyId,
        name: companyInfo?.name || '',
        bag_sizes: settings?.bag_sizes || [],
        pricing_defaults: settings?.pricing_defaults || {},
      }
    : null;

  const value = {
    company,
    settings: settings || null,
    companyId,
    currentUser: user,
    userRole: role,
    isAdmin,
    isManager,
    hasRoasteryPermission,
    // Can this user make inventory adjustments (managers/admins, or a granted
    // roastery 'inventory_adjustments' permission)?
    canAdjustInventory: hasRoasteryPermission('inventory_adjustments'),
    loading: Boolean(companyId) && loadingSettings,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['roastery-settings', companyId] }),
  };

  return <RoasteryContext.Provider value={value}>{children}</RoasteryContext.Provider>;
}

export const useCompany = () => useContext(RoasteryContext);
