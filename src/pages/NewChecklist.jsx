import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { format } from "date-fns";

export default function NewChecklist() {
  const { checklistId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const today = format(new Date(), "yyyy-MM-dd");

  useEffect(() => {
    if (!user?.company_id) return; // Wait until company_id is available

    const createInstance = async () => {
      // Check if instance already exists for today
      const existing = await base44.entities.ChecklistInstance.filter({
        checklist_id: checklistId,
        date: today,
        company_id: user.company_id,
      });

      if (existing.length > 0) {
        navigate(`/checklist/${existing[0].id}`, { replace: true });
        return;
      }

      // Get checklist to know location and shift
      const checklists = await base44.entities.Checklist.filter({ id: checklistId });
      const checklist = checklists[0];
      if (!checklist) { navigate("/"); return; }

      const instance = await base44.entities.ChecklistInstance.create({
        checklist_id: checklistId,
        company_id: user.company_id,
        location_id: checklist.location_id,
        date: today,
        shift_type: checklist.shift_type,
        status: "not_started",
        active_users: [user.full_name || user.email],
      });

      navigate(`/checklist/${instance.id}`, { replace: true });
    };

    createInstance();
  }, [checklistId]);

  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
    </div>
  );
}