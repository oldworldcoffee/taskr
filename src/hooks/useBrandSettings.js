import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";

export function useBrandSettings() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["brand_settings", user?.company_id],
    queryFn: async () => {
      if (!user?.company_id) return { business_name: "OWCR Operations", logo_url: null };
      const results = await base44.entities.BrandSettings.filter({ company_id: user.company_id });
      return results[0] || { business_name: "OWCR Operations", logo_url: null };
    },
    staleTime: 1000 * 60 * 5,
  });
}