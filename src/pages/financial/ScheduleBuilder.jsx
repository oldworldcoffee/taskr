import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAppContext } from "@/components/financial/FinancialContext";
import { useAuth } from "@/lib/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Calendar, Clock, DollarSign, Plus, ChevronLeft, ChevronRight, Loader2, Settings2 } from "lucide-react";
import { format, addWeeks, subWeeks, startOfWeek } from "date-fns";
import DraggableShiftTimeline from "@/components/financial/DraggableShiftTimeline";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const DEFAULT_SHIFT_TYPES = ["Opener", "Closer", "Midshift", "Kitchen", "Bakery", "Lead", "Manager"];
const MANAGER_SHIFT_TYPE = "Manager"; // Manager shifts excluded from floor labor calculations

const getOperatingHours = (laborSettings, dayIndex) => {
  if (!laborSettings?.operating_hours) return null;
  const dayHours = laborSettings.operating_hours[dayIndex] ?? laborSettings.operating_hours[String(dayIndex)];
  if (!dayHours?.enabled) return null;
  const open = parseInt(dayHours.open.split(":")[0]);
  const close = parseInt(dayHours.close.split(":")[0]);
  return { open, close, enabled: true };
};

export default function ScheduleBuilder() {
  const { tenant, activeLocations, laborSettings, selectedLocation, setSelectedLocation, salesMetric, setSalesMetric } = useAppContext();
  const { canAccessLocation } = useAuth();

  // Restrict to the taskr locations this user can access (admins/managers see all).
  const accessibleActiveLocations = activeLocations.filter((l) => canAccessLocation(l.id));

  // If the currently selected location is not accessible to this user, switch to their first accessible one
  useEffect(() => {
    if (accessibleActiveLocations.length > 0 && !accessibleActiveLocations.find(l => l.id === selectedLocation)) {
      setSelectedLocation(accessibleActiveLocations[0].id);
    }
  }, [accessibleActiveLocations.length, selectedLocation]);

  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date()));
  const [shifts, setShifts] = useState([]);
  const [salesData, setSalesData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isTemplateWeek, setIsTemplateWeek] = useState(false);
  const [templateScheduleId, setTemplateScheduleId] = useState(null);
  const [isAddShiftOpen, setIsAddShiftOpen] = useState(false);
  const [isEditShiftOpen, setIsEditShiftOpen] = useState(false);
  const [editingShift, setEditingShift] = useState(null);
  const [selectedDay, setSelectedDay] = useState(0);
  // Get labor settings for selected location
  const locationLaborSettings = laborSettings?.find(l => l.location_id === selectedLocation);

  const [shiftTypes, setShiftTypes] = useState(DEFAULT_SHIFT_TYPES);
  const [newCustomType, setNewCustomType] = useState("");

  const [newShift, setNewShift] = useState({
    shift_type: "Opener",
    days: [],
    start_time: "09:00",
    end_time: "17:00",
    notes: ""
  });

  const [editShift, setEditShift] = useState({
    shift_type: "Opener",
    days: [],
    start_time: "09:00",
    end_time: "17:00",
    notes: ""
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (selectedLocation) {
      loadSchedule(currentWeekStart);
      loadSalesData();
    }
  }, [selectedLocation, currentWeekStart, salesMetric]);

  const [scheduleId, setScheduleId] = useState(null);

  const handleRefresh = () => {
    loadSchedule(currentWeekStart);
    loadSalesData();
  };

  const loadSchedule = async (weekStart) => {
    setLoading(true);
    try {
      const weekStartStr = format(weekStart, "yyyy-MM-dd");

      // Check if an explicit schedule exists for this week
      const schedules = await base44.entities.FinancialSchedule.filter({
        company_id: tenant.id,
        location_id: selectedLocation,
        week_start_date: weekStartStr
      });

      let foundEmptySchedule = false;
      
      if (schedules.length > 0) {
        const schedule = schedules[0];
        const scheduleShifts = await base44.entities.FinancialShift.filter({ schedule_id: schedule.id });

        // If there's a real schedule with shifts, show it normally
        if (scheduleShifts.length > 0 || schedule.is_template) {
          setScheduleId(schedule.id);
          setIsTemplateWeek(!!schedule.is_template);
          setTemplateScheduleId(schedule.is_template ? schedule.id : null);
          // Sort shifts by display_order
          const sortedShifts = [...scheduleShifts].sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
          setShifts(sortedShifts);
          return;
        }
        // Empty non-template schedule — keep the id so edits save here, but fall through to load template
        setScheduleId(schedule.id);
        setIsTemplateWeek(false);
        foundEmptySchedule = true;
      }

      // No schedule with shifts (or empty schedule) — look for the active template to pre-populate
      const allSchedules = await base44.entities.FinancialSchedule.filter({
        company_id: tenant.id,
        location_id: selectedLocation
      });

      console.log("[ScheduleBuilder] No shifts for week", weekStartStr, "— all schedules for location:", allSchedules.map(s => ({ id: s.id, week: s.week_start_date, is_template: s.is_template, effective_from: s.template_effective_from })));

      // Find the most recent template whose effective_from <= this week
      const applicableTemplates = allSchedules
        .filter(s => s.is_template === true && (!s.template_effective_from || s.template_effective_from <= weekStartStr))
        .sort((a, b) => (b.template_effective_from || "") > (a.template_effective_from || "") ? 1 : -1);

      console.log("[ScheduleBuilder] Applicable templates:", applicableTemplates.map(s => ({ id: s.id, is_template: s.is_template, effective_from: s.template_effective_from })));

      if (applicableTemplates.length > 0) {
        const tmpl = applicableTemplates[0];
        setTemplateScheduleId(tmpl.id);
        setIsTemplateWeek(false);
        const tmplShifts = await base44.entities.FinancialShift.filter({ schedule_id: tmpl.id });
        console.log("[ScheduleBuilder] Template shifts loaded:", tmplShifts.length);
        const mappedShifts = tmplShifts.map(s => ({ ...s, _fromTemplate: true, id: `tmpl-${s.id}` }));
        // Sort template shifts by display_order
        const sortedMapped = [...mappedShifts].sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
        console.log("[ScheduleBuilder] Mapped shifts:", sortedMapped.map(s => ({ id: s.id, employee_name: s.employee_name, day_of_week: s.day_of_week })));
        setShifts(sortedMapped);
      } else {
        if (!foundEmptySchedule) setScheduleId(null);
        setIsTemplateWeek(false);
        setTemplateScheduleId(null);
        setShifts([]);
      }
    } catch (err) {
      console.error("Failed to load schedule:", err);
    } finally {
      setLoading(false);
    }
  };

  // Ensure a schedule record exists and return its ID
  // If the week was showing template shifts, materialize them as real shifts for this week
  const ensureSchedule = async () => {
    const weekStartStr = format(currentWeekStart, "yyyy-MM-dd");
    const existing = await base44.entities.FinancialSchedule.filter({
      company_id: tenant.id,
      location_id: selectedLocation,
      week_start_date: weekStartStr
    });
    
    let scheduleIdToUse;
    if (existing.length > 0) {
      scheduleIdToUse = existing[0].id;
      setScheduleId(scheduleIdToUse);
      
      // Check if this existing schedule has any shifts
      const existingShifts = await base44.entities.FinancialShift.filter({ schedule_id: scheduleIdToUse });
      
      // If it's empty AND we're showing template shifts, materialize them
      if (existingShifts.length === 0 && shifts.some(s => s._fromTemplate)) {
        const templateShifts = shifts.filter(s => s._fromTemplate);
        const saved = await Promise.all(templateShifts.map(s =>
          base44.entities.FinancialShift.create({
            schedule_id: scheduleIdToUse,
            company_id: tenant.id,
            location_id: selectedLocation,
            employee_name: s.employee_name,
            shift_type: s.shift_type,
            day_of_week: s.day_of_week,
            start_time: s.start_time,
            end_time: s.end_time,
            notes: s.notes || "",
            hourly_rate: 0
          })
        ));
        setShifts(saved);
        return scheduleIdToUse;
      }
      
      return scheduleIdToUse;
    }
    
    const created = await base44.entities.FinancialSchedule.create({
      company_id: tenant.id,
      location_id: selectedLocation,
      week_start_date: weekStartStr,
      status: "draft"
    });
    const newId = created.id;
    setScheduleId(newId);
    scheduleIdToUse = newId;

    // If we were previewing template shifts, save them as real shifts for this new week
    const templateShifts = shifts.filter(s => s._fromTemplate);
    if (templateShifts.length > 0) {
      const saved = await Promise.all(templateShifts.map(s =>
        base44.entities.FinancialShift.create({
          schedule_id: newId,
          company_id: tenant.id,
          location_id: selectedLocation,
          employee_name: s.employee_name,
          shift_type: s.shift_type,
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
          notes: s.notes || "",
          hourly_rate: 0
        })
      ));
      setShifts(saved);
    }

    return newId;
  };

  const loadSalesData = async () => {
    try {
      const location = accessibleActiveLocations.find(l => l.id === selectedLocation);
      if (!location) return;
      const res = await base44.functions.invoke("squareSalesData", {
        company_id: tenant.id,
        location_id: location.square_location_id,
        metric: salesMetric,
        timezone: location.timezone || 'America/Los_Angeles',
        force_refresh: false
      });
      setSalesData(res.data);
    } catch (err) {
      console.error("Failed to load sales data:", err);
    }
  };

  const handleAddShift = async () => {
    setSaving(true);
    try {
      // First, ensure we have a real schedule (materialize template if needed)
      const sid = await ensureSchedule();
      // Add the new shift(s)
      const created = await Promise.all(newShift.days.map(dayIndex =>
        base44.entities.FinancialShift.create({
          schedule_id: sid,
          company_id: tenant.id,
          location_id: selectedLocation,
          employee_name: newShift.shift_type,
          shift_type: newShift.shift_type,
          day_of_week: dayIndex,
          start_time: newShift.start_time,
          end_time: newShift.end_time,
          notes: newShift.notes,
          hourly_rate: 0
        })
      ));
      // Reload to show the saved shifts
      await loadSchedule(currentWeekStart);
    } catch (err) {
      console.error("Failed to add shift:", err);
    } finally {
      setSaving(false);
    }
    setIsAddShiftOpen(false);
    setNewShift({ shift_type: "Opener", days: [], start_time: "09:00", end_time: "17:00", notes: "" });
  };

  const handleDeleteShift = async (shiftId) => {
    // If it's a template preview shift (not yet saved), just remove from UI
    if (String(shiftId).startsWith("tmpl-")) {
      setShifts(prev => prev.filter(s => s.id !== shiftId));
      return;
    }
    setShifts(prev => prev.filter(s => s.id !== shiftId));
    try {
      await base44.entities.FinancialShift.delete(shiftId);
    } catch (err) {
      console.error("Failed to delete shift:", err);
    }
  };

  const handleReorderShifts = async (newDayOrder) => {
    // Only update display_order for shifts on the selected day
    // Keep all other shifts in their current positions
    setShifts(prev => {
      const otherShifts = prev.filter(s => s.day_of_week !== selectedDay);
      const dayShifts = prev.filter(s => s.day_of_week === selectedDay);
      
      // Map the new order to get updated display_order values
      const updatedDayShifts = newDayOrder.map((shift, index) => ({
        ...shift,
        display_order: index
      }));
      
      return [...otherShifts, ...updatedDayShifts];
    });
    
    // Update the display_order field for each shift on this day
    try {
      await Promise.all(
        newDayOrder.map((shift, index) => {
          // Skip template shifts (not saved yet)
          if (String(shift.id).startsWith("tmpl-")) return Promise.resolve();
          return base44.entities.FinancialShift.update(shift.id, { display_order: index });
        })
      );
    } catch (err) {
      console.error("Failed to reorder shifts:", err);
    }
  };

  // Save current week's schedule as the new template going forward
  const handleSaveAsTemplate = async () => {
    const sid = await ensureSchedule();
    const weekStartStr = format(currentWeekStart, "yyyy-MM-dd");

    // Un-template any existing templates for this location
    const existing = await base44.entities.FinancialSchedule.filter({
      company_id: tenant.id,
      location_id: selectedLocation
    });
    const templated = existing.filter(s => s.is_template === true);
    await Promise.all(templated.map(s =>
      base44.entities.FinancialSchedule.update(s.id, { is_template: false })
    ));

    // Mark current schedule as the new template effective from this week
    await base44.entities.FinancialSchedule.update(sid, {
      is_template: true,
      template_effective_from: weekStartStr
    });
    setIsTemplateWeek(true);
    setTemplateScheduleId(sid);
  };

  const handleEditShift = (shift) => {
    setEditingShift(shift);
    setEditShift({
      shift_type: shift.shift_type || shift.employee_name || "Opener",
      days: [shift.day_of_week],
      start_time: shift.start_time,
      end_time: shift.end_time,
      notes: shift.notes || ""
    });
    setIsEditShiftOpen(true);
  };

  const handleSaveEditShift = async () => {
    try {
      // If editing a single existing shift and user selected multiple days, create new shifts for additional days
      if (editShift.days.length > 1 && editingShift && !String(editingShift.id).startsWith("tmpl-")) {
        // Delete the original shift
        await base44.entities.FinancialShift.delete(editingShift.id);
        setShifts(prev => prev.filter(s => s.id !== editingShift.id));
        
        // Create new shifts for each selected day
        const created = await Promise.all(
          editShift.days.map(dayIndex =>
            base44.entities.FinancialShift.create({
              schedule_id: editingShift.schedule_id,
              company_id: tenant.id,
              location_id: selectedLocation,
              employee_name: editShift.shift_type,
              shift_type: editShift.shift_type,
              day_of_week: dayIndex,
              start_time: editShift.start_time,
              end_time: editShift.end_time,
              notes: editShift.notes,
              hourly_rate: 0,
              display_order: editingShift.display_order || 0
            })
          )
        );
        setShifts(prev => [...prev, ...created].sort((a, b) => (a.display_order || 0) - (b.display_order || 0)));
      } else {
        // Single day update (or template shift)
        const updated = {
          shift_type: editShift.shift_type,
          employee_name: editShift.shift_type,
          day_of_week: editShift.days[0],
          start_time: editShift.start_time,
          end_time: editShift.end_time,
          notes: editShift.notes
        };
        
        if (String(editingShift.id).startsWith("tmpl-")) {
          // Template shift - just update UI
          setShifts(prev => prev.map(s => s.id === editingShift.id ? { ...s, ...updated } : s));
        } else {
          // Real shift - update database
          await base44.entities.FinancialShift.update(editingShift.id, updated);
          setShifts(prev => prev.map(s => s.id === editingShift.id ? { ...s, ...updated } : s));
        }
      }
      setIsEditShiftOpen(false);
      setEditingShift(null);
    } catch (err) {
      console.error("Failed to update shift:", err);
    }
  };

  // Compute weekly manager allocation cost for this location
  // Formula: (annual salary / 52) × (allocated hrs / 40)
  const getWeeklyManagerCost = () => {
    if (!locationLaborSettings) return 0;
    const annualSalary = locationLaborSettings.manager_compensation || 0;
    const allocatedHrs = locationLaborSettings.manager_hours_allocated || 0;
    if (!annualSalary || !allocatedHrs) return 0;
    const taxMult = 1 + (locationLaborSettings.tax_percentage || 0) / 100;
    const benMult = 1 + (locationLaborSettings.benefits_percentage || 0) / 100;
    const weeklyRaw = (annualSalary / 52) * (allocatedHrs / 40);
    return weeklyRaw * taxMult * benMult;
  };

  // Total scheduled floor hours for the week (Manager shifts excluded - they're salaried)
  const getTotalScheduledHours = () => {
    return shifts.reduce((sum, s) => {
      if ((s.shift_type || s.employee_name) === MANAGER_SHIFT_TYPE) return sum;
      const start = parseInt(s.start_time.split(":")[0]);
      const end = parseInt(s.end_time.split(":")[0]);
      return sum + Math.max(0, end - start);
    }, 0);
  };

  // Effective hourly rate = (floor labor + manager weekly cost) / total scheduled hours
  // Manager cost slides based on actual scheduled hours so total cost stays accurate
  const getEffectiveHourlyRate = () => {
    if (!locationLaborSettings) return 18;
    if (locationLaborSettings.labor_cost_mode === "detailed") {
      const base = locationLaborSettings.floor_hourly_rate || 0;
      const taxMult = 1 + (locationLaborSettings.tax_percentage || 0) / 100;
      const benMult = 1 + (locationLaborSettings.benefits_percentage || 0) / 100;
      const floorLoaded = base * taxMult * benMult;

      const totalHrs = getTotalScheduledHours();
      const weeklyManagerCost = getWeeklyManagerCost();
      const managerPerHour = totalHrs > 0 ? weeklyManagerCost / totalHrs : 0;

      const offset = locationLaborSettings.labor_cost_offset || 0;
      return floorLoaded + managerPerHour + offset;
    }
    return locationLaborSettings.hourly_rate || 18;
  };

  const getProjectedSales = (dayIndex, hour) => {
    if (!salesData?.by_day_hour) return 0;
    let sales = salesData.by_day_hour[`${dayIndex}-${hour}`] || 0;
    // Apply yearly offset only for quarterly projections
    if (salesMetric === "quarterly" && locationLaborSettings?.yearly_sales_offset_pct) {
      const offset = locationLaborSettings.yearly_sales_offset_pct / 100;
      sales = sales * (1 + offset);
    }
    return sales;
  };

  const calculateHourlyLabor = (dayIndex, hour) => {
    const dayShifts = shifts.filter(s => s.day_of_week === dayIndex);
    const effectiveRate = getEffectiveHourlyRate();
    let laborCost = 0;
    
    dayShifts.forEach(shift => {
      // Manager shifts are salaried - already accounted for in manager compensation, skip
      if ((shift.shift_type || shift.employee_name) === MANAGER_SHIFT_TYPE) return;
      const start = parseInt(shift.start_time.split(":")[0]);
      const end = parseInt(shift.end_time.split(":")[0]);
      if (hour >= start && hour < end) {
        laborCost += effectiveRate;
      }
    });
    
    return laborCost;
  };

  const getShiftsForHour = (dayIndex, hour) => {
    return shifts.filter(s => {
      const start = parseInt(s.start_time.split(":")[0]);
      const end = parseInt(s.end_time.split(":")[0]);
      return s.day_of_week === dayIndex && hour >= start && hour < end;
    });
  };

  const calculateHourlyLaborPct = (dayIndex, hour) => {
    const sales = getProjectedSales(dayIndex, hour);
    const labor = calculateHourlyLabor(dayIndex, hour);
    return sales > 0 ? (labor / sales) * 100 : 0;
  };

  const calculateHourlyLaborGoal = (dayIndex, hour) => {
    const sales = getProjectedSales(dayIndex, hour);
    const targetPct = locationLaborSettings?.target_labor_pct || 25;
    return sales * (targetPct / 100);
  };

  const calculateRequiredSalesPerHour = (dayIndex, hour) => {
    const actualLabor = calculateHourlyLabor(dayIndex, hour);
    const targetPct = locationLaborSettings?.target_labor_pct || 25;
    return actualLabor / (targetPct / 100);
  };

  const calculateDayLaborGoal = (dayIndex) => {
    let totalGoal = 0;
    let totalSales = 0;
    for (let hour = 0; hour < 24; hour++) {
      const sales = getProjectedSales(dayIndex, hour);
      totalSales += sales;
    }
    const targetPct = locationLaborSettings?.target_labor_pct || 25;
    return totalSales * (targetPct / 100);
  };

  const calculateDayLaborVariance = (dayIndex) => {
    const dayShifts = shifts.filter(s => s.day_of_week === dayIndex);
    const effectiveRate = getEffectiveHourlyRate();
    let actualLabor = 0;
    
    dayShifts.forEach(shift => {
      if ((shift.shift_type || shift.employee_name) === MANAGER_SHIFT_TYPE) return;
      const start = parseInt(shift.start_time.split(":")[0]);
      const end = parseInt(shift.end_time.split(":")[0]);
      actualLabor += (end - start) * effectiveRate;
    });
    
    const goal = calculateDayLaborGoal(dayIndex);
    const variance = actualLabor - goal;
    const targetPct = locationLaborSettings?.target_labor_pct || 25;
    const actualPct = calculateDayStats(dayIndex).laborPct;
    const variancePct = actualPct - targetPct;
    return { actual: actualLabor, goal, variance, variancePct, actualPct, targetPct };
  };

  const calculateShiftCost = (shift) => {
    if ((shift.shift_type || shift.employee_name) === MANAGER_SHIFT_TYPE) return 0;
    const start = parseInt(shift.start_time.split(":")[0]);
    const end = parseInt(shift.end_time.split(":")[0]);
    const hours = end - start;
    return hours * getEffectiveHourlyRate();
  };

  const calculateDayStats = (dayIndex) => {
    const dayShifts = shifts.filter(s => s.day_of_week === dayIndex);
    const laborCost = dayShifts.reduce((sum, s) => sum + calculateShiftCost(s), 0);
    const hours = dayShifts.reduce((sum, s) => {
      if ((s.shift_type || s.employee_name) === MANAGER_SHIFT_TYPE) return sum;
      const start = parseInt(s.start_time.split(":")[0]);
      const end = parseInt(s.end_time.split(":")[0]);
      return sum + (end - start);
    }, 0);
    
    const projectedSales = HOURS.reduce((sum, hour) => sum + getProjectedSales(dayIndex, hour), 0);
    const laborPct = projectedSales > 0 ? (laborCost / projectedSales) * 100 : 0;

    return { laborCost, hours, projectedSales, laborPct };
  };

  const calculateWeekStats = () => {
    let totalLaborCost = 0;
    let totalHours = 0;
    let totalProjectedSales = 0;

    for (let day = 0; day < 7; day++) {
      const stats = calculateDayStats(day);
      totalLaborCost += stats.laborCost;
      totalHours += stats.hours;
      totalProjectedSales += stats.projectedSales;
    }

    const laborPct = totalProjectedSales > 0 ? (totalLaborCost / totalProjectedSales) * 100 : 0;
    return { totalLaborCost, totalHours, totalProjectedSales, laborPct };
  };

  const getLaborColor = (laborPct) => {
    const target = locationLaborSettings?.target_labor_pct || 25;
    if (laborPct <= target) return "bg-green-100 text-green-800";
    if (laborPct <= target * 1.1) return "bg-yellow-100 text-yellow-800";
    return "bg-red-100 text-red-800";
  };

  const weekStats = calculateWeekStats();

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Schedule Builder</h1>
          <p className="text-muted-foreground">
            Week of {format(currentWeekStart, "MMM d, yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentWeekStart(subWeeks(currentWeekStart, 1))}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentWeekStart(addWeeks(currentWeekStart, 1))}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          {accessibleActiveLocations.length > 1 ? (
            <Select value={selectedLocation} onValueChange={setSelectedLocation}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {accessibleActiveLocations.map(loc => (
                  <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : accessibleActiveLocations.length === 1 && (
            <span className="text-sm font-medium text-muted-foreground border rounded-md px-3 py-1.5 bg-muted/40">
              {accessibleActiveLocations[0].name}
            </span>
          )}
          <Dialog open={isAddShiftOpen} onOpenChange={setIsAddShiftOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add Shift
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Shift</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Shift Type</Label>
                  <Select value={newShift.shift_type} onValueChange={(v) => setNewShift({...newShift, shift_type: v})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select shift type" />
                    </SelectTrigger>
                    <SelectContent>
                      {shiftTypes.map(type => (
                        <SelectItem key={type} value={type}>
                          {type}{type === MANAGER_SHIFT_TYPE ? " (salaried — excluded from floor cost)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2 mt-1">
                    <Input
                      value={newCustomType}
                      onChange={(e) => setNewCustomType(e.target.value)}
                      placeholder="Add custom type..."
                      className="text-xs h-7"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs px-2"
                      disabled={!newCustomType.trim() || shiftTypes.includes(newCustomType.trim())}
                      onClick={() => {
                        const t = newCustomType.trim();
                        setShiftTypes([...shiftTypes, t]);
                        setNewShift({...newShift, shift_type: t});
                        setNewCustomType("");
                      }}
                    >
                      Add
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Select Days</Label>
                  <div className="flex flex-wrap gap-2">
                    {DAYS.map((day, index) => (
                      <Button
                        key={day}
                        type="button"
                        variant={newShift.days.includes(index) ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          const newDays = newShift.days.includes(index)
                            ? newShift.days.filter(d => d !== index)
                            : [...newShift.days, index];
                          setNewShift({...newShift, days: newDays});
                        }}
                      >
                        {day}
                      </Button>
                    ))}
                  </div>
                  {newShift.days.length === 0 && (
                    <p className="text-xs text-muted-foreground">Select at least one day</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Start Time</Label>
                    <Input
                      type="time"
                      value={newShift.start_time}
                      onChange={(e) => setNewShift({...newShift, start_time: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>End Time</Label>
                    <Input
                      type="time"
                      value={newShift.end_time}
                      onChange={(e) => setNewShift({...newShift, end_time: e.target.value})}
                    />
                  </div>
                </div>
                <Button 
                  onClick={handleAddShift} 
                  className="w-full"
                  disabled={newShift.days.length === 0 || !newShift.shift_type}
                >
                  Add Shift{newShift.days.length > 1 ? ` (${newShift.days.length} days)` : ''}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={isEditShiftOpen} onOpenChange={setIsEditShiftOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Shift</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Shift Type</Label>
                  <Select value={editShift.shift_type} onValueChange={(v) => setEditShift({...editShift, shift_type: v})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select shift type" />
                    </SelectTrigger>
                    <SelectContent>
                      {shiftTypes.map(type => (
                        <SelectItem key={type} value={type}>
                          {type}{type === MANAGER_SHIFT_TYPE ? " (salaried)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Select Days</Label>
                  <div className="flex flex-wrap gap-2">
                    {DAYS.map((day, index) => (
                      <Button
                        key={day}
                        type="button"
                        variant={editShift.days.includes(index) ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          const newDays = editShift.days.includes(index)
                            ? editShift.days.filter(d => d !== index)
                            : [...editShift.days, index];
                          setEditShift({...editShift, days: newDays});
                        }}
                      >
                        {day}
                      </Button>
                    ))}
                  </div>
                  {editShift.days.length === 0 && (
                    <p className="text-xs text-muted-foreground">Select at least one day</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Start Time</Label>
                    <Input
                      type="time"
                      value={editShift.start_time}
                      onChange={(e) => setEditShift({...editShift, start_time: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>End Time</Label>
                    <Input
                      type="time"
                      value={editShift.end_time}
                      onChange={(e) => setEditShift({...editShift, end_time: e.target.value})}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Input
                    value={editShift.notes}
                    onChange={(e) => setEditShift({...editShift, notes: e.target.value})}
                    placeholder="Optional notes"
                  />
                </div>
                <Button 
                  onClick={handleSaveEditShift} 
                  className="w-full"
                  disabled={!editShift.shift_type || editShift.days.length === 0}
                >
                  Save Changes{editShift.days.length > 1 ? ` (${editShift.days.length} days)` : ''}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <div className="flex items-center border rounded-md overflow-hidden text-sm">
            {[
              { value: "rolling_3_week", label: "3-Week Avg" },
              { value: "quarterly", label: "Quarterly Avg" },
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
          {!isTemplateWeek && (
            <Button onClick={handleSaveAsTemplate} variant="outline" size="sm" className="text-blue-700 border-blue-300 hover:bg-blue-50">
              <Calendar className="w-4 h-4 mr-2" />
              Set as Template
            </Button>
          )}
          <Button onClick={handleRefresh} variant="outline" disabled={loading}>
            <Loader2 className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {saving && (
            <Badge variant="outline" className="text-xs">
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              Saving...
            </Badge>
          )}
        </div>
      </div>

      {/* Template banner */}
      {isTemplateWeek && (
        <div className="flex items-center gap-2 text-xs bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2">
          <Calendar className="w-3.5 h-3.5 shrink-0" />
          <span><strong>This is the active template.</strong> Future weeks with no saved schedule will inherit these shifts. Changes here update the template going forward — past weeks keep their historical shifts.</span>
        </div>
      )}
      {!isTemplateWeek && shifts.some(s => s._fromTemplate) && (
        <div className="flex items-center gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
          <Calendar className="w-3.5 h-3.5 shrink-0" />
          <span><strong>Showing template shifts (preview).</strong> Any edits will be saved as a new schedule for this week only.</span>
        </div>
      )}
      {!isTemplateWeek && !shifts.some(s => s._fromTemplate) && shifts.length > 0 && (
        <div className="flex items-center gap-2 text-xs bg-muted/40 rounded-lg px-3 py-2 text-muted-foreground">
          <Calendar className="w-3.5 h-3.5 shrink-0" />
          <span>This week has its own saved schedule. <button className="underline font-medium text-blue-600 hover:text-blue-800" onClick={handleSaveAsTemplate}>Set as template going forward</button></span>
        </div>
      )}

      {/* Labor Cost Mode Indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
        <Settings2 className="w-3.5 h-3.5 shrink-0" />
        {locationLaborSettings?.labor_cost_mode === "detailed" ? (() => {
          const totalHrs = getTotalScheduledHours();
          const weeklyMgr = getWeeklyManagerCost();
          const taxMult = 1 + (locationLaborSettings.tax_percentage || 0) / 100;
          const benMult = 1 + (locationLaborSettings.benefits_percentage || 0) / 100;
          const floorLoaded = (locationLaborSettings.floor_hourly_rate || 0) * taxMult * benMult;
          const offset = locationLaborSettings.labor_cost_offset || 0;
          const effectiveRate = getEffectiveHourlyRate();
          return (
            <span>
              <strong>Detailed mode</strong>
              {" — "}Floor: <strong>${floorLoaded.toFixed(2)}/hr</strong>
              {weeklyMgr > 0 && (
                <> + Mgr: <strong>${weeklyMgr.toFixed(2)}/wk</strong>
                {totalHrs > 0
                  ? <> ÷ <strong>{totalHrs}hrs</strong></>
                  : <span className="italic"> (add shifts to see effective rate)</span>
                }</>
              )}
              {offset !== 0 && <> + Offset: <strong>${offset.toFixed(2)}/hr</strong></>}
              {(weeklyMgr > 0 ? totalHrs > 0 : true) && <> = <strong className="text-foreground">${effectiveRate.toFixed(2)}/hr effective</strong></>}
            </span>
          );
        })() : (
          <span>
            <strong>Simplified mode</strong>
            {" — "}Rate: <strong>${getEffectiveHourlyRate().toFixed(2)}/hr</strong>
          </span>
        )}
      </div>

      {/* Week Summary */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Hours</CardDescription>
            <CardTitle className="text-2xl">
              <Clock className="inline w-5 h-5 mr-1" />
              {weekStats.totalHours.toFixed(1)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Labor Cost</CardDescription>
            <CardTitle className="text-2xl">
              <DollarSign className="inline w-5 h-5 mr-1" />
              {weekStats.totalLaborCost.toFixed(2)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Projected Sales</CardDescription>
            <CardTitle className="text-2xl">
              <DollarSign className="inline w-5 h-5 mr-1" />
              {weekStats.totalProjectedSales.toFixed(2)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Labor %</CardDescription>
            <CardTitle className="text-2xl">
              <Badge className={getLaborColor(weekStats.laborPct)}>
                {weekStats.laborPct.toFixed(1)}%
              </Badge>
              {locationLaborSettings?.target_labor_pct && (
                <span className="text-xs text-muted-foreground ml-2">
                  (Target: {locationLaborSettings.target_labor_pct}%)
                </span>
              )}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Day Selector with Daily Wrap-up */}
      <div className="space-y-2">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {DAYS.map((day, index) => {
            const stats = calculateDayStats(index);
            const opHours = getOperatingHours(locationLaborSettings, index);
            const variance = calculateDayLaborVariance(index);
            const isOver = variance.variance > 0;
            return (
              <Button
                key={day}
                variant={selectedDay === index ? "default" : "outline"}
                onClick={() => setSelectedDay(index)}
                className="flex-shrink-0 h-auto py-2 px-3"
              >
                <div className="flex flex-col items-center gap-1">
                  <div className="font-semibold text-sm">{day}</div>
                  {opHours ? (
                    <div className="text-xs text-muted-foreground whitespace-nowrap">{opHours.open}:00-{opHours.close}:00</div>
                  ) : (
                    <div className="text-xs text-muted-foreground">Closed</div>
                  )}
                  <div className={`text-xs font-bold ${isOver ? 'text-red-500' : 'text-green-500'}`}>
                    {variance.variancePct === 0 ? 'On' : variance.variancePct > 0 ? '+' : ''}{variance.variancePct.toFixed(1)}%
                  </div>
                </div>
              </Button>
            );
          })}
        </div>
        <div className="text-xs text-muted-foreground px-2">
          Daily wrap-up: Shows how much over (+) or under (-) labor budget for each day
        </div>
      </div>

      {/* Store Hours & Shift Timeline */}
      <Card>
        <CardHeader>
          <CardTitle>
            {DAYS[selectedDay]} Schedule - {(() => {
              const opHours = getOperatingHours(locationLaborSettings, selectedDay);
              return opHours ? `Store Hours: ${opHours.open}:00 - ${opHours.close}:00` : "Closed";
            })()}
          </CardTitle>
          <CardDescription>Shifts aligned with store hours and projected sales</CardDescription>
        </CardHeader>
        <CardContent>
          {(() => {
            const opHours = getOperatingHours(locationLaborSettings, selectedDay);
            if (!opHours) {
              return <p className="text-muted-foreground">Store is closed on {DAYS[selectedDay]}.</p>;
            }
            const dayShifts = shifts.filter(s => s.day_of_week === selectedDay);
            const displayHours = HOURS.filter(h => h >= opHours.open && h < opHours.close);
            
            return (
              <div className="space-y-4">
                {/* Hour Headers */}
                <div className="flex border-b pb-2">
                  <div className="w-32 flex-shrink-0 text-sm font-medium text-muted-foreground">Time</div>
                  <div className="flex-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${displayHours.length}, 1fr)` }}>
                    {displayHours.map(hour => (
                      <div key={hour} className="text-xs text-center text-muted-foreground">
                        {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : hour > 12 ? `${hour - 12} PM` : hour}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Sales Heatmap */}
                <div className="flex items-center border-b pb-2">
                  <div className="w-32 flex-shrink-0 text-sm font-medium text-muted-foreground">Sales</div>
                  <div className="flex-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${displayHours.length}, 1fr)` }}>
                    {displayHours.map(hour => {
                      const sales = getProjectedSales(selectedDay, hour);
                      const maxSales = Math.max(...displayHours.map(h => getProjectedSales(selectedDay, h)), 1);
                      const intensity = sales / maxSales;
                      return (
                        <div
                          key={hour}
                          className="h-8 rounded text-xs text-center flex items-center justify-center"
                          style={{
                            backgroundColor: `rgba(59, 130, 246, ${0.2 + intensity * 0.6})`,
                            color: intensity > 0.5 ? 'white' : 'rgb(59, 130, 246)'
                          }}
                          title={`$${sales.toFixed(2)}`}
                        >
                          ${sales.toFixed(0)}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Required Sales/Hour Heatmap */}
                <div className="flex items-center border-b pb-2">
                  <div className="w-32 flex-shrink-0 text-sm font-medium text-muted-foreground">Required Sales/Hr</div>
                  <div className="flex-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${displayHours.length}, 1fr)` }}>
                    {displayHours.map(hour => {
                      const requiredSales = calculateRequiredSalesPerHour(selectedDay, hour);
                      const maxSales = Math.max(...displayHours.map(h => calculateRequiredSalesPerHour(selectedDay, h)), 1);
                      const intensity = requiredSales / maxSales;
                      return (
                        <div
                          key={hour}
                          className="h-8 rounded text-xs text-center flex items-center justify-center"
                          style={{
                            backgroundColor: `rgba(139, 92, 246, ${0.2 + intensity * 0.6})`,
                            color: intensity > 0.5 ? 'white' : 'rgb(139, 92, 246)'
                          }}
                          title={`Required Sales: $${requiredSales.toFixed(2)}/hr to hit ${locationLaborSettings?.target_labor_pct || 25}% labor`}
                        >
                          ${requiredSales.toFixed(0)}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Labor % Heatmap */}
                <div className="flex items-center border-b pb-2">
                  <div className="w-32 flex-shrink-0 text-sm font-medium text-muted-foreground">Labor %</div>
                  <div className="flex-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${displayHours.length}, 1fr)` }}>
                    {displayHours.map(hour => {
                      const laborPct = calculateHourlyLaborPct(selectedDay, hour);
                      const target = locationLaborSettings?.target_labor_pct || 25;
                      const intensity = Math.min(laborPct / (target * 2), 1);
                      const isGood = laborPct <= target;
                      return (
                        <div
                          key={hour}
                          className="h-8 rounded text-xs text-center flex items-center justify-center"
                          style={{
                            backgroundColor: isGood 
                              ? `rgba(34, 197, 94, ${0.2 + intensity * 0.6})`
                              : `rgba(239, 68, 68, ${0.2 + intensity * 0.6})`,
                            color: intensity > 0.5 ? 'white' : isGood ? 'rgb(34, 197, 94)' : 'rgb(239, 68, 68)'
                          }}
                          title={`${laborPct.toFixed(1)}% labor`}
                        >
                          {laborPct.toFixed(0)}%
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Actual Labor $ Cost Heatmap */}
                <div className="flex items-center border-b pb-2">
                  <div className="w-32 flex-shrink-0 text-sm font-medium text-muted-foreground">Actual Labor $</div>
                  <div className="flex-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${displayHours.length}, 1fr)` }}>
                    {displayHours.map(hour => {
                      const actual = calculateHourlyLabor(selectedDay, hour);
                      const goal = calculateHourlyLaborGoal(selectedDay, hour);
                      const maxActual = Math.max(...displayHours.map(h => calculateHourlyLabor(selectedDay, h)), 1);
                      const intensity = actual / maxActual;
                      const isUnderGoal = actual <= goal;
                      return (
                        <div
                          key={hour}
                          className="h-8 rounded text-xs text-center flex items-center justify-center"
                          style={{
                            backgroundColor: isUnderGoal 
                              ? `rgba(34, 197, 94, ${0.2 + intensity * 0.6})`
                              : `rgba(239, 68, 68, ${0.2 + intensity * 0.6})`,
                            color: intensity > 0.5 ? 'white' : isUnderGoal ? 'rgb(34, 197, 94)' : 'rgb(239, 68, 68)'
                          }}
                          title={`Actual: $${actual.toFixed(2)}, Goal: $${goal.toFixed(2)}`}
                        >
                          ${actual.toFixed(0)}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Shifts Timeline - Hour by Hour */}
                <DraggableShiftTimeline
                  shifts={dayShifts}
                  displayHours={displayHours}
                  onEdit={handleEditShift}
                  onDelete={handleDeleteShift}
                  onReorder={handleReorderShifts}
                  getEffectiveHourlyRate={getEffectiveHourlyRate}
                  MANAGER_SHIFT_TYPE={MANAGER_SHIFT_TYPE}
                />
                {dayShifts.length === 0 && (
                  <div className="text-center text-muted-foreground py-8">
                    No shifts scheduled for {DAYS[selectedDay]}
                  </div>
                )}

                {/* Legend */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-blue-600/80" />
                    <span>Shift Block</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-blue-300" />
                    <span>Low Sales</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-blue-600" />
                    <span>High Sales</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-green-500/60" />
                    <span>Good Labor %</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-red-500/60" />
                    <span>High Labor %</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-purple-400/60" />
                    <span>Required Sales/Hr</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-green-600/60" />
                    <span>Actual Labor $</span>
                  </div>
                </div>

                {/* Daily Wrap-up Summary */}
                <div className="grid grid-cols-4 gap-4 pt-4 border-t mt-4">
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground">Total Hours</div>
                    <div className="text-lg font-bold">{calculateDayStats(selectedDay).hours.toFixed(1)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground">Total Labor Cost</div>
                    <div className="text-lg font-bold">${calculateDayStats(selectedDay).laborCost.toFixed(2)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground">Projected Sales</div>
                    <div className="text-lg font-bold">${calculateDayStats(selectedDay).projectedSales.toFixed(2)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground">Labor %</div>
                    <div className={`text-lg font-bold ${getLaborColor(calculateDayStats(selectedDay).laborPct).includes('green') ? 'text-green-600' : getLaborColor(calculateDayStats(selectedDay).laborPct).includes('yellow') ? 'text-yellow-600' : 'text-red-600'}`}>
                      {calculateDayStats(selectedDay).laborPct.toFixed(1)}%
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>
    </div>
  );
}