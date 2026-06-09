import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Upload, FileSpreadsheet, CheckCircle2, Loader2, Download } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

export default function SpreadsheetImport() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [file, setFile] = useState(null);
  const [locationId, setLocationId] = useState("");
  const [shiftType, setShiftType] = useState("opening");
  const [checklistName, setChecklistName] = useState("");
  const [step, setStep] = useState("upload"); // upload | preview | done
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null); // { checklistName, tasks }

  const { data: locations = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: () => base44.entities.Location.filter({ is_active: true }),
  });

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      console.log("File selected:", f.name, f.type);
      setFile(f);
    }
  };

  const handleDownloadTemplate = () => {
    const rows = [
      ["Group (leave blank if no group)", "Task Name", "Due Time (HH:MM)", "Duration (minutes)", "Notes / Instructions (optional)"],
      ["Change of Shift", "Hand over cash drawer", "17:00", "5", "Count and verify cash with outgoing staff"],
      ["Change of Shift", "Brief incoming staff on issues", "17:05", "10", "Cover any incidents or special notes"],
      ["Change of Shift", "Sign shift log", "17:15", "2", ""],
      ["Closing Front of House", "Wipe down all tables and chairs", "22:00", "15", "Use food-safe sanitiser spray"],
      ["Closing Front of House", "Sweep and mop floors", "22:15", "15", ""],
      ["Closing Front of House", "Restock condiments and napkins", "22:30", "10", "Check stock levels and reorder if low"],
      ["Closing Back of House", "Clean and sanitise prep surfaces", "22:00", "15", "Refer to cleaning schedule for chemicals"],
      ["Closing Back of House", "Empty and clean grease traps", "22:15", "10", ""],
      ["Closing Back of House", "Take out rubbish and recycling", "22:30", "5", ""],
      ["", "Lock front door", "23:00", "2", "Ensure alarm is set before leaving"],
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "checklist_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const parseDuration = (str) => {
    if (!str) return 1;
    // "3-5 Minutes" -> 3, "10 Minutes" -> 10, "5-7 Minutes" -> 5
    const match = String(str).match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 1;
  };

  const parseTime = (val) => {
    if (!val) return null;
    const s = String(val).trim();
    // Excel stores times as decimals like 0.5 = 12:00
    if (!isNaN(parseFloat(s)) && !s.includes(":")) {
      const totalMins = Math.round(parseFloat(s) * 24 * 60);
      const h = Math.floor(totalMins / 60);
      const m = totalMins % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
    // Already a time string like "12:00" or "12:00:00"
    const match = s.match(/^(\d{1,2}):(\d{2})/);
    if (match) return `${String(parseInt(match[1])).padStart(2, "0")}:${match[2]}`;
    return null;
  };

  const isHeaderRow = (title) => {
    if (!title) return true;
    const t = String(title).trim();
    if (!t) return true;
    // Section headers end with ":" or are all-caps short phrases with no verb
    if (t.endsWith(":")) return true;
    // Known header patterns
    if (/^(opening task|mid.?shift task|closing task|daily tasks?|weekly tasks?|monthly tasks?)$/i.test(t)) return true;
    return false;
  };

  const handleExtract = async () => {
    if (!file) {
      toast.error("Please select a file.");
      return;
    }
    if (!locationId) {
      toast.error("Please select a location.");
      return;
    }
    if (!checklistName.trim()) {
      toast.error("Please enter a checklist name.");
      return;
    }
    setLoading(true);
    console.log("Starting file parse...");
    toast.info("Parsing file...");

    try {
      const buffer = await file.arrayBuffer();
      console.log("Buffer size:", buffer.byteLength);
      const workbook = XLSX.read(buffer, { type: "array" });

      // Pick first sheet
      const sheetName = workbook.SheetNames[0];
      console.log("Sheet name:", sheetName);
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
      console.log("Rows read:", rows.length);
      toast.info(`Read ${rows.length} rows from file`);

      // Detect column layout from header row
      // New template: col 0 = Group, col 1 = Task Name, col 2 = Due Time, col 3 = Duration
      // Legacy (no group col): col 0 = Task Name, col 1 = Due Time, col 2 = Duration
      let groupColIdx = 0;
      let taskColIdx = 1;
      let timeColIdx = 2;
      let durationColIdx = 3;

      // Check if first row looks like a header
      const headerRow = rows[0] || [];
      const hasGroupCol = headerRow.some(c => String(c || "").toLowerCase().includes("group"));
      if (!hasGroupCol) {
        // Legacy layout — no group column
        groupColIdx = -1;
        taskColIdx = 0;
        timeColIdx = 1;
        durationColIdx = 2;
      }
      // Also detect by header keywords
      let notesColIdx = hasGroupCol ? 4 : 3;
      headerRow.forEach((cell, idx) => {
        const s = String(cell || "").toLowerCase();
        if (s.includes("time")) timeColIdx = idx;
        if (s.includes("duration") || s.includes("minutes")) durationColIdx = idx;
        if (s.includes("note") || s.includes("instruction")) notesColIdx = idx;
      });

      const groups = []; // { name, sort_order }
      const tasks = []; // { groupName, title, ... }

      console.log("Processing rows, header detection:", { hasGroupCol, groupColIdx, taskColIdx, timeColIdx, durationColIdx, notesColIdx });
      console.log("First row:", rows[0]);

      // Validate header row - check if it contains expected column names
      const headerKeywords = ["group", "task", "name", "time", "duration", "minute", "note", "instruction"];
      const headerHasKeywords = headerRow.some(cell => {
        const s = String(cell || "").toLowerCase();
        return headerKeywords.some(kw => s.includes(kw));
      });

      if (!headerHasKeywords && rows.length > 1) {
        toast.error("Invalid spreadsheet format. First row should contain headers like 'Task Name', 'Due Time', 'Duration'. Please use the template.");
        setLoading(false);
        return;
      }

      for (const row of rows) {
        const taskTitle = row[taskColIdx] ? String(row[taskColIdx]).trim() : null;
        if (isHeaderRow(taskTitle)) continue;

        const groupName = groupColIdx >= 0 && row[groupColIdx] ? String(row[groupColIdx]).trim() : null;
        const timeVal = row[timeColIdx];
        const durationVal = row[durationColIdx];
        const notesVal = row[notesColIdx] ? String(row[notesColIdx]).trim() : "";

        // Track unique groups in order
        if (groupName && !groups.find(g => g.name === groupName)) {
          groups.push({ name: groupName, sort_order: groups.length });
        }

        tasks.push({
          groupName: groupName || null,
          title: taskTitle,
          description: notesVal,
          task_type: "checkbox",
          is_required: false,
          estimated_minutes: parseDuration(durationVal),
          scheduled_days: ["daily"],
          due_time: parseTime(timeVal),
        });
      }

      console.log("Tasks extracted:", tasks.length, "Groups:", groups.length);
      console.log("First few tasks:", tasks.slice(0, 3));

      if (!tasks.length) {
        toast.error("No tasks found in the file.");
        setLoading(false);
        return;
      }

      toast.success(`Found ${tasks.length} tasks and ${groups.length} groups`);
      setPreview({ tasks, groups });
      setStep("preview");
      setLoading(false);
    } catch (error) {
      console.error("Extract error:", error);
      toast.error("Failed to parse file: " + error.message);
      setLoading(false);
    }
  };

  const handleImport = async () => {
    try {
      setLoading(true);
      const checklist = await base44.entities.Checklist.create({
        name: checklistName.trim(),
        company_id: user.company_id,
        location_id: locationId,
        shift_type: shiftType,
        is_active: true,
      });

      // Create groups and build a name→id map
      const groupIdMap = {};
      for (const g of (preview.groups || [])) {
        const created = await base44.entities.TaskGroup.create({
          checklist_id: checklist.id,
          company_id: user.company_id,
          name: g.name,
          sort_order: g.sort_order,
        });
        groupIdMap[g.name] = created.id;
      }

      // Create tasks with group_id resolved
      await Promise.all(
        preview.tasks.map((t, i) => {
          const { groupName, ...taskData } = t;
          return base44.entities.Task.create({
            ...taskData,
            checklist_id: checklist.id,
            company_id: user.company_id,
            group_id: groupName ? (groupIdMap[groupName] || null) : null,
            sort_order: i,
          });
        })
      );

      queryClient.invalidateQueries({ queryKey: ["checklists"] });
      setStep("done");
      setLoading(false);
      toast.success("Checklist imported successfully!");
    } catch (error) {
      console.error("Import error:", error);
      toast.error("Failed to import: " + error.message);
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/dashboard/settings">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Import from Spreadsheet</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Upload a CSV or Excel file to create a checklist</p>
        </div>
      </div>

      {step === "upload" && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileSpreadsheet className="h-4 w-4" /> Upload File</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
              <p className="text-sm font-medium">Expected format:</p>
              <p className="text-xs text-muted-foreground">Col A: Group &nbsp;·&nbsp; Col B: Task name &nbsp;·&nbsp; Col C: Due time &nbsp;·&nbsp; Col D: Duration (mins) &nbsp;·&nbsp; Col E: Notes (optional)</p>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownloadTemplate}>
                <Download className="h-3.5 w-3.5" /> Download Template
              </Button>
            </div>

            <div>
              <Label>Checklist Name</Label>
              <Input value={checklistName} onChange={(e) => setChecklistName(e.target.value)} placeholder="e.g. Opening Checklist" />
            </div>
            <div>
              <Label>Location</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                <SelectContent>
                  {locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Shift Type</Label>
              <Select value={shiftType} onValueChange={setShiftType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="opening">Opening</SelectItem>
                  <SelectItem value="mid_shift">Mid-Shift</SelectItem>
                  <SelectItem value="closing">Closing</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Spreadsheet File (CSV or Excel)</Label>
              <Input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} className="cursor-pointer" />
            </div>
            <Button
              onClick={handleExtract}
              disabled={!file || !checklistName.trim() || loading}
              className="w-full"
            >
              {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analysing file…</> : <><Upload className="h-4 w-4 mr-2" /> Extract Tasks</>}
            </Button>
          </CardContent>
        </Card>
      )}

      {step === "preview" && preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Preview — {preview.groups?.length > 0 && `${preview.groups.length} groups, `}{preview.tasks.length} tasks found
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="max-h-96 overflow-y-auto space-y-3">
              {/* Render groups first */}
              {(preview.groups || []).map((g) => (
                <div key={g.name}>
                  <div className="flex items-center gap-2 px-2 py-1.5 bg-sidebar/10 rounded-lg border border-border mb-1">
                    <span className="text-xs font-semibold text-primary uppercase tracking-wide">{g.name}</span>
                  </div>
                  <div className="space-y-1 ml-3">
                    {preview.tasks.filter(t => t.groupName === g.name).map((t, i) => (
                      <div key={i} className="p-2 rounded-lg bg-muted/30 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground text-xs w-4 flex-shrink-0">•</span>
                          <span className="flex-1 font-medium">{t.title}</span>
                          {t.due_time && <span className="text-xs text-amber-600 flex-shrink-0">{t.due_time}</span>}
                          <span className="text-xs text-muted-foreground flex-shrink-0">{t.estimated_minutes}m</span>
                        </div>
                        {t.description && <p className="text-xs text-muted-foreground mt-0.5 ml-5">{t.description}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {/* Ungrouped tasks */}
              {preview.tasks.filter(t => !t.groupName).map((t, i) => (
                <div key={i} className="p-2.5 rounded-lg bg-muted/30 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-5 text-right flex-shrink-0">{i + 1}.</span>
                    <span className="flex-1 font-medium">{t.title}</span>
                    {t.due_time && <span className="text-xs text-amber-600">{t.due_time}</span>}
                    <span className="text-xs text-muted-foreground">{t.estimated_minutes}m</span>
                  </div>
                  {t.description && <p className="text-xs text-muted-foreground mt-0.5 ml-7">{t.description}</p>}
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep("upload")} className="flex-1">Back</Button>
              <Button onClick={handleImport} disabled={loading} className="flex-1">
                {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importing…</> : "Import Checklist"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "done" && (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <CheckCircle2 className="h-12 w-12 text-success mx-auto" />
            <h2 className="text-lg font-semibold">Import Complete!</h2>
            <p className="text-sm text-muted-foreground">
              {preview?.groups?.length > 0 && <>{preview.groups.length} groups and </>}{preview?.tasks.length} tasks added to <strong>{checklistName}</strong>.
            </p>
            <div className="flex gap-2 justify-center pt-2">
              <Link to="/dashboard/settings">
                <Button variant="outline">Back to Settings</Button>
              </Link>
              <Button onClick={() => { setStep("upload"); setFile(null); setChecklistName(""); setPreview(null); }}>
                Import Another
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
