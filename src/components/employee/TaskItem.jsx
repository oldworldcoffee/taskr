import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Camera, Flag, Check, ChevronDown, ChevronRight, AlertCircle, ThumbsUp, ThumbsDown, BookOpen } from "lucide-react";
import KBArticleModal from "@/components/kb/KBArticleModal";
import { base44 } from "@/api/base44Client";
import { format } from "date-fns";
import UserAvatar from "@/components/shared/UserAvatar";
import CashDepositTask from "@/components/employee/CashDepositTask";
import DescriptionWithLinks from "@/components/kb/DescriptionWithLinks";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export default function TaskItem({ task, completion, subtasks, subtaskCompletions, instanceId, locationId, companyId, user, onComplete, onFlag, depth = 0 }) {
  const [textValue, setTextValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagNote, setFlagNote] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const [yesNoValue, setYesNoValue] = useState(null);
  const [openKbArticleId, setOpenKbArticleId] = useState(null);
  const isCompleted = !!completion;
  const hasSubtasks = subtasks && subtasks.length > 0;

  // Special handling for cash deposit task
  if (task.task_type === "cash_deposit") {
    return <CashDepositTask task={task} completion={completion} instanceId={instanceId} locationId={locationId} companyId={companyId} user={user} onComplete={onComplete} onFlag={onFlag} />;
  }

  const handleCheckbox = async () => {
    if (isCompleted) return;
    setSubmitting(true);
    await onComplete(task.id, "true");
    setSubmitting(false);
  };

  const handleYesNo = async (value) => {
    if (isCompleted || submitting) return;
    setSubmitting(true);
    await onComplete(task.id, value);
    setYesNoValue(value);
    setSubmitting(false);
  };

  const handleTextSubmit = async () => {
    if (!textValue.trim()) return;
    setSubmitting(true);
    await onComplete(task.id, textValue.trim());
    setTextValue("");
    setSubmitting(false);
  };

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubmitting(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    await onComplete(task.id, file_url);
    setSubmitting(false);
  };

  const handleFlag = async () => {
    if (!flagNote.trim()) return;
    setSubmitting(true);
    await base44.entities.TaskCompletion.create({
      instance_id: instanceId,
      task_id: task.id,
      company_id: user.company_id || companyId,
      completed_by_email: user.email,
      completed_by_name: user.full_name || user.email,
      completed_at: new Date().toISOString(),
      value: "",
      notes: flagNote.trim(),
      is_flag: true,
    });
    setFlagOpen(false);
    setFlagNote("");
    setSubmitting(false);
  };

  return (
    <div className={depth > 0 ? "ml-6 border-l-2 border-border pl-4" : ""}>
      <div className={`py-4 ${depth === 0 ? "border-b border-border/50" : ""} ${isCompleted ? "opacity-70" : ""}`}>
        <div className="flex items-start gap-3">
          {/* Task Type Render */}
          {task.task_type === "checkbox" && (
            <button
              onClick={handleCheckbox}
              disabled={isCompleted || submitting}
              className="mt-0.5 shrink-0"
            >
              <div className={`h-7 w-7 rounded-lg border-2 flex items-center justify-center transition-all ${
                isCompleted
                  ? "bg-success border-success text-white"
                  : "border-primary/30 hover:border-primary"
              }`}>
                {isCompleted && <Check className="h-4 w-4" />}
              </div>
            </button>
          )}

          {task.task_type === "yes_no" && !isCompleted && (
            <div className="flex gap-2 mt-1">
              <Button
                variant={yesNoValue === "yes" ? "default" : "outline"}
                size="sm"
                onClick={() => handleYesNo("yes")}
                disabled={submitting}
                className={yesNoValue === "yes" ? "bg-success hover:bg-success/90" : ""}
              >
                <ThumbsUp className="h-4 w-4 mr-1" /> Yes
              </Button>
              <Button
                variant={yesNoValue === "no" ? "default" : "outline"}
                size="sm"
                onClick={() => handleYesNo("no")}
                disabled={submitting}
                className={yesNoValue === "no" ? "bg-destructive hover:bg-destructive/90 text-white" : ""}
              >
                <ThumbsDown className="h-4 w-4 mr-1" /> No
              </Button>
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2">
              {hasSubtasks && (
                <button onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }} className="mt-1 shrink-0 text-muted-foreground hover:text-foreground">
                  {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
              )}
              <button onClick={() => setDetailOpen(true)} className="flex-1 text-left">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`font-medium text-base ${isCompleted ? "line-through text-muted-foreground" : ""}`}>
                    {task.title}
                  </span>
                  {task.is_required && !isCompleted && (
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  {task.due_time && (
                    <span className="text-xs text-amber-600 font-medium shrink-0">{task.due_time}</span>
                  )}
                  {task.estimated_minutes && (
                    <span className="text-xs text-muted-foreground shrink-0">{task.estimated_minutes}m</span>
                  )}
                </div>
                {task.description && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    <DescriptionWithLinks text={task.description} />
                  </p>
                )}
              </button>
            </div>

            {/* Text Input */}
            {task.task_type === "text_input" && !isCompleted && (
              <div className="flex gap-2 mt-3">
                <Input
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  placeholder="Enter response..."
                  className="h-12 text-base"
                />
                <Button onClick={handleTextSubmit} disabled={submitting || !textValue.trim()} size="lg" className="shrink-0 px-6">
                  <Check className="h-4 w-4" />
                </Button>
              </div>
            )}

            {/* Photo Upload */}
            {task.task_type === "photo_upload" && !isCompleted && (
              <label className="mt-3 flex items-center justify-center gap-2 border-2 border-dashed border-primary/30 rounded-xl p-4 cursor-pointer hover:border-primary transition-colors">
                <Camera className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium text-primary">Tap to take or upload photo</span>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} disabled={submitting} />
              </label>
            )}

            {/* Completed Info */}
            {isCompleted && (
              <div className="flex items-center gap-2 mt-2">
                <UserAvatar name={completion.completed_by_name} size="xs" />
                <span className="text-xs text-muted-foreground">
                  {completion.completed_by_name} · {format(new Date(completion.completed_at), "h:mm a")}
                </span>
              </div>
            )}

            {/* Photo thumbnail */}
            {isCompleted && task.task_type === "photo_upload" && completion.value && (
              <img src={completion.value} alt="Uploaded" className="mt-2 rounded-lg h-24 object-cover" />
            )}

            {/* Text response */}
            {isCompleted && task.task_type === "text_input" && completion.value && (
              <p className="mt-1 text-sm bg-muted/50 rounded-lg px-3 py-2 inline-block">{completion.value}</p>
            )}

            {/* Yes/No response */}
            {isCompleted && task.task_type === "yes_no" && completion.value && (
              <div className="mt-2 flex items-center gap-2">
                {completion.value === "yes" ? (
                  <span className="text-sm font-medium text-success flex items-center gap-1">
                    <ThumbsUp className="h-4 w-4" /> Yes
                  </span>
                ) : (
                  <span className="text-sm font-medium text-destructive flex items-center gap-1">
                    <ThumbsDown className="h-4 w-4" /> No
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Flag Button */}
          {!isCompleted && (
            <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => onFlag && onFlag(task.id)}>
              <Flag className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Subtasks */}
      {hasSubtasks && expanded && (
        <div className="mt-1">
          {subtasks.map((st) => (
            <TaskItem
              key={st.id}
              task={st}
              completion={subtaskCompletions?.[st.id]}
              subtasks={[]}
              subtaskCompletions={{}}
              instanceId={instanceId}
              locationId={locationId}
              companyId={companyId}
              user={user}
              onComplete={onComplete}
              depth={depth + 1}
            />
          ))}
        </div>
      )}

      {/* Flag Dialog */}
      <Dialog open={flagOpen} onOpenChange={setFlagOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Flag an Issue</DialogTitle>
          </DialogHeader>
          <Textarea
            value={flagNote}
            onChange={(e) => setFlagNote(e.target.value)}
            placeholder="Describe the issue..."
            className="min-h-[100px]"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setFlagOpen(false)}>Cancel</Button>
            <Button onClick={handleFlag} disabled={!flagNote.trim() || submitting} className="bg-destructive hover:bg-destructive/90">
              Submit Flag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* KB Article Modal */}
      <KBArticleModal articleId={openKbArticleId} onClose={() => setOpenKbArticleId(null)} />

      {/* Task Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-start justify-between">
              <DialogTitle className="text-lg">{task.title}</DialogTitle>
              {task.is_required && (
                <span className="text-xs text-destructive font-medium flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> Required
                </span>
              )}
            </div>
          </DialogHeader>
          <div className="space-y-4 py-3">
            {task.description && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Instructions</p>
                <p className="text-sm"><DescriptionWithLinks text={task.description} /></p>
              </div>
            )}
            <div className="flex gap-4">
              {task.due_time && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Due Time</p>
                  <p className="text-sm font-medium text-amber-600">{task.due_time}</p>
                </div>
              )}
              {task.estimated_minutes && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Duration</p>
                  <p className="text-sm font-medium">{task.estimated_minutes} min</p>
                </div>
              )}
            </div>
            {task.task_type !== "checkbox" && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Response Type</p>
                <p className="text-sm font-medium capitalize">{task.task_type === "yes_no" ? "Yes / No" : task.task_type.replace("_", " ")}</p>
              </div>
            )}
            {task.kb_article_ids?.length > 0 && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-2">Reference Articles</p>
                <div className="flex flex-col gap-1.5">
                  {task.kb_article_ids.map(id => (
                    <button
                      key={id}
                      onClick={() => { setDetailOpen(false); setOpenKbArticleId(id); }}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-sm font-medium text-left"
                    >
                      <BookOpen className="h-4 w-4 flex-shrink-0" />
                      View Knowledge Base Article
                    </button>
                  ))}
                </div>
              </div>
            )}
            {isCompleted && (
              <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Completed by {completion.completed_by_name}</p>
                <p className="text-xs text-muted-foreground">{format(new Date(completion.completed_at), "MMM d, yyyy 'at' h:mm a")}</p>
                {completion.value && task.task_type === "text_input" && (
                  <div className="mt-2">
                    <p className="text-sm font-medium text-muted-foreground mb-1">Response</p>
                    <p className="text-sm bg-background rounded-md p-2">{completion.value}</p>
                  </div>
                )}
                {completion.value && task.task_type === "photo_upload" && (
                  <div className="mt-2">
                    <p className="text-sm font-medium text-muted-foreground mb-1">Photo</p>
                    <img src={completion.value} alt="Uploaded" className="rounded-lg h-32 object-cover" />
                  </div>
                )}
                {completion.notes && (
                  <div className="mt-2">
                    <p className="text-sm font-medium text-muted-foreground mb-1">Notes</p>
                    <p className="text-sm">{completion.notes}</p>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            {!isCompleted && (
              <Button variant="outline" onClick={() => { setDetailOpen(false); setFlagOpen(true); }}>
                <Flag className="h-4 w-4 mr-2" /> Flag Issue
              </Button>
            )}
            <Button variant="secondary" onClick={() => setDetailOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}