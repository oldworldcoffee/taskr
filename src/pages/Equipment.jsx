import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Wrench, AlertTriangle, CheckCircle, Clock, Search } from "lucide-react";
import EquipmentCard from "@/components/equipment/EquipmentCard";
import EquipmentDialog from "@/components/equipment/EquipmentDialog";
import ServiceDialog from "@/components/equipment/ServiceDialog";
import ServiceScheduleDialog from "@/components/equipment/ServiceScheduleDialog";
import EquipmentDetail from "@/components/equipment/EquipmentDetail";
import { differenceInDays, parseISO } from "date-fns";

export default function Equipment() {
  const { user } = useAuth();
  const [equipment, setEquipment] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterLocation, setFilterLocation] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [equipmentDialogOpen, setEquipmentDialogOpen] = useState(false);
  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState(null);
  const [servicingEquipment, setServicingEquipment] = useState(null);
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [serviceRecords, setServiceRecords] = useState([]);
  const [selectedEquipmentSchedules, setSelectedEquipmentSchedules] = useState([]);

  useEffect(() => {
    if (user?.company_id) loadData();
  }, [user]);

  const loadData = async () => {
    setLoading(true);
    const [eq, locs] = await Promise.all([
      base44.entities.Equipment.filter({ company_id: user.company_id, is_active: true }, "-created_date"),
      base44.entities.Location.filter({ company_id: user.company_id }),
    ]);
    setEquipment(eq);
    setLocations(locs);
    setLoading(false);
  };

  const openDetail = async (eq) => {
    setSelectedEquipment(eq);
    const [records, schedules] = await Promise.all([
      base44.entities.ServiceRecord.filter({ equipment_id: eq.id }, "-service_date"),
      base44.entities.ServiceSchedule.filter({ equipment_id: eq.id, is_active: true }, "-next_due_date"),
    ]);
    setServiceRecords(records);
    setSelectedEquipmentSchedules(schedules);
    setDetailOpen(true);
  };

  const getStatus = (eq) => {
    if (!eq.next_service_date) return "unknown";
    const days = differenceInDays(parseISO(eq.next_service_date), new Date());
    if (days < 0) return "overdue";
    if (days <= 14) return "due_soon";
    return "ok";
  };

  const filtered = equipment.filter((eq) => {
    const matchSearch = eq.name.toLowerCase().includes(search.toLowerCase()) ||
      (eq.model || "").toLowerCase().includes(search.toLowerCase());
    const matchLocation = filterLocation === "all" || eq.location_id === filterLocation;
    const matchStatus = filterStatus === "all" || getStatus(eq) === filterStatus;
    return matchSearch && matchLocation && matchStatus;
  });

  const counts = {
    overdue: equipment.filter(e => getStatus(e) === "overdue").length,
    due_soon: equipment.filter(e => getStatus(e) === "due_soon").length,
    ok: equipment.filter(e => getStatus(e) === "ok").length,
  };

  const handleEdit = (eq) => { setEditingEquipment(eq); setEquipmentDialogOpen(true); };
  const handleService = (eq) => { setServicingEquipment(eq); setServiceDialogOpen(true); };
  const handleSchedule = async (eq) => { 
    setServicingEquipment(eq); 
    setScheduleDialogOpen(true); 
  };
  
  const handleScheduleSaved = async () => {
    await loadData();
    if (selectedEquipment) {
      // Refresh the selected equipment's next_service_date
      const updated = await base44.entities.Equipment.get(selectedEquipment.id);
      setSelectedEquipment(updated);
    }
  };
  const handleNew = () => { setEditingEquipment(null); setEquipmentDialogOpen(true); };
  const handleCardClick = (eq) => { openDetail(eq); };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Equipment & Service</h1>
          <p className="text-muted-foreground text-sm mt-1">Track equipment and maintenance schedules</p>
        </div>
        <Button onClick={handleNew}>
          <Plus className="w-4 h-4 mr-2" />
          Add Equipment
        </Button>
      </div>

      {/* Status Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div
          className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 flex items-center gap-3 cursor-pointer"
          onClick={() => setFilterStatus(filterStatus === "overdue" ? "all" : "overdue")}
        >
          <AlertTriangle className="w-5 h-5 text-destructive" />
          <div>
            <div className="text-2xl font-bold text-destructive">{counts.overdue}</div>
            <div className="text-xs text-muted-foreground">Overdue</div>
          </div>
        </div>
        <div
          className="bg-warning/10 border border-warning/20 rounded-lg p-4 flex items-center gap-3 cursor-pointer"
          onClick={() => setFilterStatus(filterStatus === "due_soon" ? "all" : "due_soon")}
        >
          <Clock className="w-5 h-5 text-warning" />
          <div>
            <div className="text-2xl font-bold text-warning">{counts.due_soon}</div>
            <div className="text-xs text-muted-foreground">Due Soon (14 days)</div>
          </div>
        </div>
        <div
          className="bg-success/10 border border-success/20 rounded-lg p-4 flex items-center gap-3 cursor-pointer"
          onClick={() => setFilterStatus(filterStatus === "ok" ? "all" : "ok")}
        >
          <CheckCircle className="w-5 h-5 text-success" />
          <div>
            <div className="text-2xl font-bold text-success">{counts.ok}</div>
            <div className="text-xs text-muted-foreground">Up to Date</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search equipment..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterLocation} onValueChange={setFilterLocation}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All Locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Locations</SelectItem>
            {locations.map((l) => (
              <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Equipment Grid */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Wrench className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No equipment found. Add your first piece of equipment to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((eq) => (
            <div key={eq.id} onClick={() => handleCardClick(eq)} className="cursor-pointer">
              <EquipmentCard
                equipment={eq}
                location={locations.find(l => l.id === eq.location_id)}
                status={getStatus(eq)}
                onEdit={(e) => { e?.stopPropagation(); handleEdit(eq); }}
                onService={(e) => { e?.stopPropagation(); handleService(eq); }}
              />
            </div>
          ))}
        </div>
      )}

      <EquipmentDialog
        open={equipmentDialogOpen}
        onClose={() => setEquipmentDialogOpen(false)}
        equipment={editingEquipment}
        user={user}
        locations={locations}
        onSaved={loadData}
      />

      <ServiceDialog
        open={serviceDialogOpen}
        onClose={() => setServiceDialogOpen(false)}
        equipment={servicingEquipment}
        user={user}
        onSaved={loadData}
      />

      <ServiceScheduleDialog
        open={scheduleDialogOpen}
        onClose={() => setScheduleDialogOpen(false)}
        equipment={servicingEquipment}
        onSaved={handleScheduleSaved}
      />

      {selectedEquipment && (
        <EquipmentDetail
          equipment={selectedEquipment}
          location={locations.find(l => l.id === selectedEquipment.location_id)}
          serviceRecords={serviceRecords}
          schedules={selectedEquipmentSchedules}
          open={detailOpen}
          onClose={() => { setDetailOpen(false); setSelectedEquipment(null); setSelectedEquipmentSchedules([]); }}
          onEdit={() => { setDetailOpen(false); handleEdit(selectedEquipment); }}
          onService={() => { 
            setDetailOpen(false); 
            setTimeout(() => {
              setServicingEquipment(selectedEquipment); 
              setServiceDialogOpen(true); 
            }, 100);
          }}
          onSchedule={() => { 
            setDetailOpen(false); 
            setTimeout(() => {
              setServicingEquipment(selectedEquipment); 
              setScheduleDialogOpen(true); 
            }, 100);
          }}
        />
      )}
    </div>
  );
}