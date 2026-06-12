import { useState, useEffect } from "react";
import { useAppContext } from "@/components/financial/FinancialContext";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Clock, Building2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

export default function Dashboard() {
  const { tenant, activeLocations, laborSettings, loading: contextLoading } = useAppContext();
  const [locationData, setLocationData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [salesMetric] = useState("rolling_3_week");

  useEffect(() => {
    if ((activeLocations || []).length > 0 && tenant) {
      loadLocationProjections();
    }
  }, [activeLocations, tenant, salesMetric]);

  const loadLocationProjections = async () => {
    setLoading(true);
    try {
      const promises = (activeLocations || []).map(async (loc) => {
        const locLaborSettings = laborSettings?.find(l => l.location_id === loc.id);
        
        // Get sales data for this location
        let salesData = null;
        if (tenant?.square_connected && loc.square_location_id) {
          try {
            const salesRes = await base44.functions.invoke("squareSalesData", {
              company_id: tenant.id,
              location_id: loc.square_location_id,
              metric: salesMetric,
              timezone: loc.timezone || "America/Los_Angeles",
              force_refresh: false,
            });
            salesData = salesRes.data;
          } catch (err) {
            console.error(`Failed to load sales for ${loc.name}:`, err);
          }
        }

        // Calculate projections based on template schedule
        const schedules = await base44.entities.FinancialSchedule.filter({
          company_id: tenant.id,
          location_id: loc.id
        });

        let templateShifts = [];
        const templateSchedule = schedules.find(s => s.is_template);
        if (templateSchedule) {
          const shifts = await base44.entities.FinancialShift.filter({ schedule_id: templateSchedule.id });
          templateShifts = shifts;
        } else if (schedules.length > 0) {
          const sorted = [...schedules].sort((a, b) => new Date(b.week_start_date) - new Date(a.week_start_date));
          for (const schedule of sorted) {
            const shifts = await base44.entities.FinancialShift.filter({ schedule_id: schedule.id });
            if (shifts.length > 0) {
              templateShifts = shifts;
              break;
            }
          }
        }

        // Calculate weekly hours (excluding managers)
        const weeklyHours = templateShifts.reduce((sum, s) => {
          if ((s.shift_type || s.employee_name) === "Manager") return sum;
          const start = parseInt(s.start_time.split(":")[0]);
          const end = parseInt(s.end_time.split(":")[0]);
          return sum + Math.max(0, end - start);
        }, 0);

        // Get effective hourly rate
        let effectiveRate = locLaborSettings?.hourly_rate || 18;
        if (locLaborSettings?.labor_cost_mode === "detailed") {
          const base = locLaborSettings.floor_hourly_rate || 0;
          const taxMult = 1 + (locLaborSettings.tax_percentage || 0) / 100;
          const benMult = 1 + (locLaborSettings.benefits_percentage || 0) / 100;
          effectiveRate = base * taxMult * benMult;
          
          const annualSalary = locLaborSettings.manager_compensation || 0;
          const allocatedHrs = locLaborSettings.manager_hours_allocated || 0;
          if (annualSalary && allocatedHrs) {
            const weeklyMgrCost = (annualSalary / 52) * (allocatedHrs / 40) * taxMult * benMult;
            const managerPerHour = weeklyHours > 0 ? weeklyMgrCost / weeklyHours : 0;
            effectiveRate += managerPerHour;
          }
        }

        const weeklyLaborCost = weeklyHours * effectiveRate;
        const monthlyLaborCost = weeklyLaborCost * 4.33;
        const monthlyHours = weeklyHours * 4.33;

        // Calculate projected monthly sales
        let monthlySales = 0;
        if (salesData?.by_day_hour) {
          let dailyTotal = 0;
          for (let dow = 0; dow < 7; dow++) {
            for (let h = 0; h < 24; h++) {
              dailyTotal += salesData.by_day_hour[`${dow}-${h}`] || 0;
            }
          }
          monthlySales = dailyTotal * 4.33;
        }

        const laborPct = monthlySales > 0 ? (monthlyLaborCost / monthlySales) * 100 : 0;
        const targetPct = locLaborSettings?.target_labor_pct || 25;
        const goalLaborCost = monthlySales * (targetPct / 100);
        const variance = monthlyLaborCost - goalLaborCost;

        return {
          location: loc,
          laborSettings: locLaborSettings,
          weeklyHours,
          weeklyLaborCost,
          monthlyHours,
          monthlyLaborCost,
          monthlySales,
          laborPct,
          targetPct,
          variance,
          hasSalesData: !!salesData,
          hasTemplate: templateShifts.length > 0,
        };
      });

      const results = await Promise.all(promises);
      setLocationData(results);
    } catch (err) {
      console.error("Failed to load location projections:", err);
    } finally {
      setLoading(false);
    }
  };

  // Calculate totals across all locations
  const totals = locationData.reduce(
    (acc, data) => ({
      monthlySales: acc.monthlySales + data.monthlySales,
      monthlyLaborCost: acc.monthlyLaborCost + data.monthlyLaborCost,
      monthlyHours: acc.monthlyHours + data.monthlyHours,
      variance: acc.variance + data.variance,
    }),
    { monthlySales: 0, monthlyLaborCost: 0, monthlyHours: 0, variance: 0 }
  );

  const totalGoalCost = locationData.reduce((sum, d) => sum + (d.monthlySales * (d.targetPct / 100)), 0);
  const totalVariance = totals.monthlyLaborCost - totalGoalCost;
  const totalLaborPct = totals.monthlySales > 0 ? (totals.monthlyLaborCost / totals.monthlySales) * 100 : 0;

  const getBadgeColor = (pct, target) => {
    if (pct <= target) return "bg-green-100 text-green-800";
    if (pct <= target * 1.1) return "bg-yellow-100 text-yellow-800";
    return "bg-red-100 text-red-800";
  };

  const fmt$ = (v) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const fmtPct = (v) => `${v.toFixed(1)}%`;

  if (contextLoading || loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span>Loading projections...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">Location performance projections and totals</p>
      </div>

      {/* Overall Totals */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Monthly Sales</CardDescription>
            <CardTitle className="text-2xl flex items-center gap-1">
              <DollarSign className="w-5 h-5" />
              {fmt$(totals.monthlySales)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Labor Hours</CardDescription>
            <CardTitle className="text-2xl flex items-center gap-1">
              <Clock className="w-5 h-5" />
              {totals.monthlyHours.toFixed(0)}h
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Labor Cost</CardDescription>
            <CardTitle className="text-2xl flex items-center gap-1">
              <DollarSign className="w-5 h-5" />
              {fmt$(totals.monthlyLaborCost)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Overall Labor %</CardDescription>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Badge className={getBadgeColor(totalLaborPct, 25)}>
                {fmtPct(totalLaborPct)}
              </Badge>
              <span className="text-xs font-normal text-muted-foreground">
                Goal: {fmtPct(25)}
              </span>
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Total Variance Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Total Monthly Variance</CardTitle>
          <CardDescription>
            Labor goal at 25%: <strong>{fmt$(totalGoalCost)}</strong>
            {" · "}Projected cost: <strong>{fmt$(totals.monthlyLaborCost)}</strong>
            {" · "}Variance:{" "}
            <strong className={totalVariance > 0 ? "text-red-600" : "text-green-600"}>
              {totalVariance > 0 ? "+" : ""}{fmt$(totalVariance)}
            </strong>
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Location Breakdown */}
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-4">Location Breakdown</h2>
        <div className="grid gap-4">
          {locationData.map((data) => (
            <Card key={data.location.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Building2 className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <CardTitle className="text-lg">{data.location.name}</CardTitle>
                      <CardDescription>
                        {!data.hasSalesData && tenant?.square_connected && (
                          <span className="text-amber-600">No sales data · </span>
                        )}
                        {!data.hasTemplate && (
                          <span className="text-amber-600">No schedule template · </span>
                        )}
                        {data.location.address}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link to={`/dashboard/financial/labor-settings?location_id=${data.location.id}`}>
                      <Button size="sm" variant="outline">
                        Settings
                      </Button>
                    </Link>
                    <Badge className={getBadgeColor(data.laborPct, data.targetPct)}>
                      {fmtPct(data.laborPct)} labor
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-5 mt-2">
                  <div>
                    <div className="text-xs text-muted-foreground">Monthly Sales</div>
                    <div className="font-semibold">{fmt$(data.monthlySales)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Labor Hours</div>
                    <div className="font-semibold">{data.monthlyHours.toFixed(0)}h</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Labor Cost</div>
                    <div className="font-semibold">{fmt$(data.monthlyLaborCost)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Labor Goal</div>
                    <div className="font-semibold text-muted-foreground">{fmt$(data.monthlySales * (data.targetPct / 100))}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Variance</div>
                    <div className={`font-semibold ${data.variance > 0 ? "text-red-600" : "text-green-600"}`}>
                      {data.variance > 0 ? "+" : ""}{fmt$(data.variance)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}