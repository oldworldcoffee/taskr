import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { AlertTriangle, X, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Link } from "react-router-dom";
import { differenceInDays, parseISO } from "date-fns";

export default function TrialBanner() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  const { data: company } = useQuery({
    queryKey: ['company-info'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getCompanyInfo', {});
      return res.data.success ? res.data.company : (res.data.trial_expired ? res.data : null);
    },
    enabled: !!user?.company_id && user?.role === 'admin',
  });

  if (user?.role !== 'admin') return null;
  if (dismissed || !company) return null;

  const tier = company.subscription_tier || 'trial';
  if (tier !== 'trial') return null;

  const trialEndDate = company.trial_end_date ? parseISO(company.trial_end_date) : null;
  const daysLeft = trialEndDate ? differenceInDays(trialEndDate, new Date()) : null;
  const isExpired = daysLeft !== null && daysLeft < 0;

  // Only show banner if 7 days or fewer remain, or expired
  if (daysLeft !== null && daysLeft > 7) return null;

  const bgColor = isExpired ? "bg-destructive" : daysLeft <= 3 ? "bg-orange-500" : "bg-warning";
  const message = isExpired
    ? "Your trial has expired. Upgrade to continue using TaskrApp."
    : daysLeft === 0
    ? "Your trial expires today!"
    : `Your trial expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`;

  return (
    <div className={`${bgColor} text-white px-4 py-2.5 flex items-center justify-between gap-4 text-sm`}>
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        <span className="font-medium">{message}</span>
      </div>
      <div className="flex items-center gap-2">
        <Link to="/dashboard/settings">
          <Button size="sm" variant="secondary" className="h-7 text-xs gap-1.5 bg-white/20 hover:bg-white/30 text-white border-0">
            <CreditCard className="h-3.5 w-3.5" />
            Upgrade Now
          </Button>
        </Link>
        {!isExpired && (
          <button onClick={() => setDismissed(true)} className="opacity-70 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}