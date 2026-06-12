import { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useAppContext } from "@/components/financial/FinancialContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, DollarSign, Clock, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, getDaysInMonth, getDay, addMonths, subMonths, startOfWeek } from "date-fns";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MANAGER_SHIFT_TYPE = "Manager";

export default function MonthlyForecast() {
  const { tenant, activeLocations, laborSettings, selectedLocation, setSelectedLocation, salesMetric, setSalesMetric } = useAppContext();
  const [salesData, setSalesData] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const locationLaborSettings = laborSettings?.find(l => l.location_id === selectedLocation);

  useEffect(() => {
    if (activeLocations.length > 0 && !selectedLocation) {
      setSelectedLocation(activeLocations[0].id);
    }
    if (selectedLocation && tenant) {
      loadData();
    }
  }, [activeLocations, selectedLocation, salesMetric, tenant]);

  const loadData = async () => {
    setLoading(true);
    try {
      const location = activeLocations.find(l => l.id === selectedLocation);
      const [salesRes, schedulesRes] = await Promise.all([
        base44.functions.invoke("squareSalesData", {
          company_id: tenant.id,
          location_id: location.square_location_id,
          metric: salesMetric,
          timezone: location.timezone || "America/Los_Angeles",
          force_refresh: false,
        }),
        base44.entities.FinancialSchedule.filter({ company_id: tenant.id, location_id: selectedLocation }),
      ]);

      setSalesData(salesRes.data);

      const allShifts = await Promise.all(
        schedulesRes.map(s => base44.entities.FinancialShift.filter({ schedule_id: s.id }))
      );
      const flatShifts = allShifts.flat();
      console.log("[MonthlyForecast] schedules:", schedulesRes.length, "shifts:", flatShifts.length, schedulesRes.map(s => s.week_start_date));
      setSchedules(schedulesRes);
      setShifts(flatShifts);
    } catch (err) {
      console.error("Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  };

  // Build a map of week_start_date -> shifts for quick lookup
  const shiftsByWeek = useMemo(() => {
    if (!schedules.length || !shifts.length) return {};
    const map = {};
    for (const schedule of schedules) {
      const weekShifts = shifts.filter(s => s.schedule_id === schedule.id);
      if (weekShifts.length > 0) {
        map[schedule.week_start_date] = weekShifts;
      }
    }
    return map;
  }, [schedules, shifts]);

  // Get the "template week" shifts - prefer the active template schedule, fall back to most recent with shifts
  const templateShiftsByDow = useMemo(() => {
    if (!schedules.length || !shifts.length) return {};

    // Prefer the explicitly marked template
    const templateSchedule = schedules.find(s => s.is_template);
    if (templateSchedule) {
      const tmplShifts = shifts.filter(s => s.schedule_id === templateSchedule.id);
      if (tmplShifts.length > 0) {
        const byDow = {};
        for (const shift of tmplShifts) {
          if (!byDow[shift.day_of_week]) byDow[shift.day_of_week] = [];
          byDow[shift.day_of_week].push(shift);
        }
        return byDow;
      }
    }

    // Fallback: most recent schedule that has shifts
    const sorted = [...schedules].sort((a, b) =>
      new Date(b.week_start_date) - new Date(a.week_start_date)
    );
    let templateShifts = [];
    for (const schedule of sorted) {
      const schedShifts = shifts.filter(s => s.schedule_id === schedule.id);
      if (schedShifts.length > 0) { templateShifts = schedShifts; break; }
    }

    if (!templateShifts.length) return {};
    const byDow = {};
    for (const shift of templateShifts) {
      if (!byDow[shift.day_of_week]) byDow[shift.day_of_week] = [];
      byDow[shift.day_of_week].push(shift);
    }
    return byDow;
  }, [schedules, shifts]);

  // Build month rows: each day of the selected month
  const monthRows = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const daysInMonth = getDaysInMonth(currentMonth);
    const targetPct = locationLaborSettings?.target_labor_pct || 25;

    // ---- Labor rate calculations (inline so we always use fresh locationLaborSettings) ----
    const getWeeklyManagerCost = () => {
      if (!locationLaborSettings) return 0;
      const annualSalary = locationLaborSettings.manager_compensation || 0;
      const allocatedHrs = locationLaborSettings.manager_hours_allocated || 0;
      if (!annualSalary || !allocatedHrs) return 0;
      const taxMult = 1 + (locationLaborSettings.tax_percentage || 0) / 100;
      const benMult = 1 + (locationLaborSettings.benefits_percentage || 0) / 100;
      return (annualSalary / 52) * (allocatedHrs / 40) * taxMult * benMult;
    };

    const getFloorHourlyRate = () => {
      if (!locationLaborSettings) return 18;
      if (locationLaborSettings.labor_cost_mode === "detailed") {
        const base = locationLaborSettings.floor_hourly_rate || 0;
        const taxMult = 1 + (locationLaborSettings.tax_percentage || 0) / 100;
        const benMult = 1 + (locationLaborSettings.benefits_percentage || 0) / 100;
        return base * taxMult * benMult;
      }
      return locationLaborSettings.hourly_rate || 18;
    };

    // Helper: floor hours for a given day from actual schedule or template
    const getDowFloorHours = (dow, date) => {
      // Check if this date's week has its own saved schedule
      const weekStart = startOfWeek(date);
      const weekStartStr = format(weekStart, "yyyy-MM-dd");
      const weekShifts = shiftsByWeek[weekStartStr];
      
      let dayShifts;
      if (weekShifts) {
        // Use actual saved shifts for this week
        dayShifts = weekShifts.filter(s => s.day_of_week === dow && (s.shift_type || s.employee_name) !== MANAGER_SHIFT_TYPE);
      } else {
        // Fall back to template
        dayShifts = (templateShiftsByDow[dow] || []).filter(
          s => (s.shift_type || s.employee_name) !== MANAGER_SHIFT_TYPE
        );
      }
      
      return dayShifts.reduce((sum, s) => {
        const start = parseInt(s.start_time.split(":")[0]);
        const end = parseInt(s.end_time.split(":")[0]);
        return sum + Math.max(0, end - start);
      }, 0);
    };

    // Weekly total hours (for manager overhead spread) - use template for baseline
    const weeklyFloorHours = [0,1,2,3,4,5,6].reduce((sum, dow) => sum + getDowFloorHours(dow, new Date(year, month, 1)), 0);

    // Effective hourly rate
    const floor = getFloorHourlyRate();
    let effectiveRate = floor;
    if (locationLaborSettings?.labor_cost_mode === "detailed") {
      const weeklyMgr = getWeeklyManagerCost();
      const managerPerHour = weeklyFloorHours > 0 ? weeklyMgr / weeklyFloorHours : 0;
      effectiveRate = floor + managerPerHour + (locationLaborSettings.labor_cost_offset || 0);
    }

    // Projected sales for a given day-of-week
    const getDowProjectedSales = (dow) => {
      if (!salesData?.by_day_hour) return 0;
      let total = 0;
      for (let h = 0; h < 24; h++) {
        total += salesData.by_day_hour[`${dow}-${h}`] || 0;
      }
      // Apply yearly offset only for quarterly projections
      if (salesMetric === "quarterly" && locationLaborSettings?.yearly_sales_offset_pct) {
        const offset = locationLaborSettings.yearly_sales_offset_pct / 100;
        total = total * (1 + offset);
      }
      return total;
    };

    const rows = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dow = getDay(date);
      const weekStart = startOfWeek(date);
      const weekStartStr = format(weekStart, "yyyy-MM-dd");
      const weekShifts = shiftsByWeek[weekStartStr];
      
      const opHours = locationLaborSettings?.operating_hours?.[dow] ?? locationLaborSettings?.operating_hours?.[String(dow)];
      // If operating_hours is configured, respect the enabled flag. Otherwise fall back to whether there are shifts.
      const isOpen = opHours
        ? opHours.enabled === true
        : (weekShifts ? weekShifts.some(s => s.day_of_week === dow) : templateShiftsByDow[dow]?.length > 0);

      const projectedSales = isOpen ? getDowProjectedSales(dow) : 0;
      const floorHours = isOpen ? getDowFloorHours(dow, date) : 0;
      const laborCost = floorHours * effectiveRate;
      const laborPct = projectedSales > 0 ? (laborCost / projectedSales) * 100 : 0;
      const goalLaborCost = projectedSales * (targetPct / 100);
      const variance = laborCost - goalLaborCost;

      rows.push({
        date,
        dow,
        day,
        projectedSales,
        floorHours,
        laborCost,
        laborPct,
        goalLaborCost,
        variance,
        isOpen,
      });
    }
    return rows;
  }, [currentMonth, salesData, templateShiftsByDow, shiftsByWeek, locationLaborSettings]);

  // Week groupings
  const weekGroups = useMemo(() => {
    const groups = [];
    let currentGroup = [];
    for (const row of monthRows) {
      currentGroup.push(row);
      if (row.dow === 6 || row === monthRows[monthRows.length - 1]) {
        groups.push(currentGroup);
        currentGroup = [];
      }
    }
    return groups;
  }, [monthRows]);

  // Month totals
  const monthTotals = useMemo(() => {
    return monthRows.reduce(
      (acc, r) => ({
        projectedSales: acc.projectedSales + r.projectedSales,
        floorHours: acc.floorHours + r.floorHours,
        laborCost: acc.laborCost + r.laborCost,
        goalLaborCost: acc.goalLaborCost + r.goalLaborCost,
        variance: acc.variance + r.variance,
      }),
      { projectedSales: 0, floorHours: 0, laborCost: 0, goalLaborCost: 0, variance: 0 }
    );
  }, [monthRows]);

  const monthLaborPct =
    monthTotals.projectedSales > 0
      ? (monthTotals.laborCost / monthTotals.projectedSales) * 100
      : 0;

  const targetPct = locationLaborSettings?.target_labor_pct || 25;

  const getLaborColor = (pct) => {
    if (pct <= targetPct) return "text-green-600";
    if (pct <= targetPct * 1.1) return "text-yellow-600";
    return "text-red-600";
  };

  const getBadgeColor = (pct) => {
    if (pct <= targetPct) return "bg-green-100 text-green-800";
    if (pct <= targetPct * 1.1) return "bg-yellow-100 text-yellow-800";
    return "bg-red-100 text-red-800";
  };

  const fmt$ = (v) => `$${v.toFixed(0)}`;
  const fmtPct = (v) => `${v.toFixed(1)}%`;

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold">Monthly Forecast</h1>
          <p className="text-muted-foreground">
            Predicted labor & sales for {format(currentMonth, "MMMM yyyy")} based on your schedule template
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Month navigation */}
          <Button variant="outline" size="icon" onClick={() => setCurrentMonth(m => subMonths(m, 1))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium w-32 text-center">{format(currentMonth, "MMMM yyyy")}</span>
          <Button variant="outline" size="icon" onClick={() => setCurrentMonth(m => addMonths(m, 1))}>
            <ChevronRight className="w-4 h-4" />
          </Button>

          {/* Location */}
          {activeLocations.length > 1 && (
            <Select value={selectedLocation} onValueChange={setSelectedLocation}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {activeLocations.map(loc => (
                  <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Metric toggle */}
          <div className="flex items-center border rounded-md overflow-hidden text-sm">
            {[
              { value: "rolling_3_week", label: "3-Week Avg" },
              { value: "quarterly", label: "Current Quarter (Avg)" },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSalesMetric(opt.value)}
                className={`px-3 py-1.5 transition-colors ${salesMetric === opt.value ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading forecast data...</span>
        </div>
      )}

      {!loading && !salesData && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No sales data available. Make sure Square is connected and you have sales history.
          </CardContent>
        </Card>
      )}

      {!loading && salesData && (
        <>
          {/* Month Summary Cards */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Projected Sales</CardDescription>
                <CardTitle className="text-2xl flex items-center gap-1">
                  <DollarSign className="w-5 h-5" />
                  {fmt$(monthTotals.projectedSales)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Labor Hours</CardDescription>
                <CardTitle className="text-2xl flex items-center gap-1">
                  <Clock className="w-5 h-5" />
                  {monthTotals.floorHours.toFixed(0)}h
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Labor Cost</CardDescription>
                <CardTitle className="text-2xl flex items-center gap-1">
                  <DollarSign className="w-5 h-5" />
                  {fmt$(monthTotals.laborCost)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Labor %</CardDescription>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <Badge className={getBadgeColor(monthLaborPct)}>
                    {fmtPct(monthLaborPct)}
                  </Badge>
                  <span className="text-xs font-normal text-muted-foreground">
                    target {targetPct}%
                  </span>
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          {/* Variance summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Monthly Labor Budget Variance</CardTitle>
              <CardDescription>
                Labor goal at {targetPct}%: <strong>{fmt$(monthTotals.goalLaborCost)}</strong>
                {" · "}Projected cost: <strong>{fmt$(monthTotals.laborCost)}</strong>
                {" · "}Variance:{" "}
                <strong className={monthTotals.variance > 0 ? "text-red-600" : "text-green-600"}>
                  {monthTotals.variance > 0 ? "+" : ""}{fmt$(monthTotals.variance)}
                </strong>
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Calendar grid */}
          <Card>
            <CardHeader>
              <CardTitle>Day-by-Day Forecast</CardTitle>
              <CardDescription>
                Based on your most recent schedule template and {salesMetric === "quarterly" ? "current quarter (prior year)" : "3-week rolling"} sales averages.
                {!Object.keys(templateShiftsByDow).length && (
                  <span className="text-yellow-600 ml-1">No schedule found — add shifts in Schedule Builder first.</span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Day headers */}
              <div className="grid grid-cols-7 gap-1 mb-1">
                {DAYS.map(d => (
                  <div key={d} className="text-xs font-semibold text-muted-foreground text-center py-1">{d}</div>
                ))}
              </div>

              {/* Week rows */}
              <div className="space-y-1">
                {weekGroups.map((week, wi) => {
                  // Pad first week
                  const firstDow = week[0].dow;
                  return (
                    <div key={wi} className="grid grid-cols-7 gap-1">
                      {/* Leading empty cells */}
                      {wi === 0 && Array.from({ length: firstDow }).map((_, i) => (
                        <div key={`pad-${i}`} />
                      ))}
                      {week.map(row => (
                        <div
                          key={row.day}
                          className={`rounded-lg border p-2 text-xs min-h-[90px] ${row.isOpen ? "bg-card" : "bg-muted/30"}`}
                        >
                          <div className="font-bold text-sm mb-1">{row.day}</div>
                          {row.isOpen ? (
                            <div className="space-y-0.5">
                              <div className="text-muted-foreground">
                                Sales: <span className="text-foreground font-medium">{fmt$(row.projectedSales)}</span>
                              </div>
                              <div className="text-muted-foreground">
                                Hours: <span className="text-foreground font-medium">{row.floorHours}h</span>
                              </div>
                              <div className="text-muted-foreground">
                                Cost: <span className="text-foreground font-medium">{fmt$(row.laborCost)}</span>
                              </div>
                              <div className={`font-semibold ${getLaborColor(row.laborPct)}`}>
                                {fmtPct(row.laborPct)}
                              </div>
                            </div>
                          ) : (
                            <div className="text-muted-foreground italic">Closed</div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Week-by-week breakdown table */}
          <Card>
            <CardHeader>
              <CardTitle>Weekly Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-left">
                      <th className="pb-2 pr-4">Week</th>
                      <th className="pb-2 pr-4 text-right">Proj. Sales</th>
                      <th className="pb-2 pr-4 text-right">Hours</th>
                      <th className="pb-2 pr-4 text-right">Labor Cost</th>
                      <th className="pb-2 pr-4 text-right">Goal</th>
                      <th className="pb-2 pr-4 text-right">Variance</th>
                      <th className="pb-2 text-right">Labor %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weekGroups.map((week, wi) => {
                      const weekStart = week[0].date;
                      const weekEnd = week[week.length - 1].date;
                      const totals = week.reduce(
                        (acc, r) => ({
                          projectedSales: acc.projectedSales + r.projectedSales,
                          floorHours: acc.floorHours + r.floorHours,
                          laborCost: acc.laborCost + r.laborCost,
                          goalLaborCost: acc.goalLaborCost + r.goalLaborCost,
                          variance: acc.variance + r.variance,
                        }),
                        { projectedSales: 0, floorHours: 0, laborCost: 0, goalLaborCost: 0, variance: 0 }
                      );
                      const wkPct = totals.projectedSales > 0 ? (totals.laborCost / totals.projectedSales) * 100 : 0;
                      return (
                        <tr key={wi} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-medium">
                            {format(weekStart, "MMM d")} – {format(weekEnd, "MMM d")}
                          </td>
                          <td className="py-2 pr-4 text-right">{fmt$(totals.projectedSales)}</td>
                          <td className="py-2 pr-4 text-right">{totals.floorHours.toFixed(0)}h</td>
                          <td className="py-2 pr-4 text-right">{fmt$(totals.laborCost)}</td>
                          <td className="py-2 pr-4 text-right text-muted-foreground">{fmt$(totals.goalLaborCost)}</td>
                          <td className={`py-2 pr-4 text-right font-medium ${totals.variance > 0 ? "text-red-600" : "text-green-600"}`}>
                            {totals.variance > 0 ? "+" : ""}{fmt$(totals.variance)}
                          </td>
                          <td className="py-2 text-right">
                            <Badge className={getBadgeColor(wkPct)}>{fmtPct(wkPct)}</Badge>
                          </td>
                        </tr>
                      );
                    })}
                    {/* Month total row */}
                    <tr className="border-t-2 font-bold">
                      <td className="pt-3 pr-4">Month Total</td>
                      <td className="pt-3 pr-4 text-right">{fmt$(monthTotals.projectedSales)}</td>
                      <td className="pt-3 pr-4 text-right">{monthTotals.floorHours.toFixed(0)}h</td>
                      <td className="pt-3 pr-4 text-right">{fmt$(monthTotals.laborCost)}</td>
                      <td className="pt-3 pr-4 text-right text-muted-foreground">{fmt$(monthTotals.goalLaborCost)}</td>
                      <td className={`pt-3 pr-4 text-right ${monthTotals.variance > 0 ? "text-red-600" : "text-green-600"}`}>
                        {monthTotals.variance > 0 ? "+" : ""}{fmt$(monthTotals.variance)}
                      </td>
                      <td className="pt-3 text-right">
                        <Badge className={getBadgeColor(monthLaborPct)}>{fmtPct(monthLaborPct)}</Badge>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}