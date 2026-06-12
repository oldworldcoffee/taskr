import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { Button } from "@/components/ui/button";
import { Users, Trash2 } from "lucide-react";

export default function DraggableShiftTimeline({ 
  shifts, 
  displayHours, 
  onEdit, 
  onDelete, 
  onReorder,
  getEffectiveHourlyRate,
  MANAGER_SHIFT_TYPE
}) {
  const ShiftCell = ({ isInShift, isManager, effectiveRate }) => (
    <div
      className={`h-8 rounded text-xs flex items-center justify-center ${
        isInShift
          ? isManager
            ? 'bg-amber-400/80 text-amber-900'
            : 'bg-primary/80 text-white'
          : 'bg-transparent'
      }`}
      title={isInShift ? (isManager ? 'Manager (salaried)' : `$${effectiveRate.toFixed(2)}/hr`) : ''}
    >
      {isInShift ? (isManager ? 'Mgr' : `$${effectiveRate.toFixed(0)}`) : ''}
    </div>
  );

  const handleDragEnd = async (result) => {
    if (!result.destination) return;

    const items = Array.from(shifts);
    const [reordered] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reordered);

    // Persist the new order to the database
    await onReorder(items);
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <Droppable droppableId="shifts">
        {(provided) => (
          <div className="space-y-2" {...provided.droppableProps} ref={provided.innerRef}>
            {shifts.map((shift, idx) => {
              const startHour = parseInt(shift.start_time.split(":")[0]);
              const endHour = parseInt(shift.end_time.split(":")[0]);
              
              return (
                <Draggable key={shift.id} draggableId={shift.id} index={idx}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      className={`flex items-start gap-2 cursor-grab active:cursor-grabbing ${
                        snapshot.isDragging ? "opacity-50" : ""
                      }`}
                    >
                      <div className="w-32 flex-shrink-0 space-y-1">
                        <div className="font-medium text-sm flex items-center gap-1">
                          {shift.shift_type || shift.employee_name}
                          {(shift.shift_type || shift.employee_name) === MANAGER_SHIFT_TYPE && (
                            <span className="text-xs text-muted-foreground font-normal">(sal.)</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {shift.start_time} - {shift.end_time}
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => onEdit(shift)}
                          >
                            <Users className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => onDelete(shift.id)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${displayHours.length}, 1fr)` }}>
                        {displayHours.map(hour => {
                          const isInShift = hour >= startHour && hour < endHour;
                          return (
                            <ShiftCell
                              key={hour}
                              isInShift={isInShift}
                              isManager={(shift.shift_type || shift.employee_name) === MANAGER_SHIFT_TYPE}
                              effectiveRate={getEffectiveHourlyRate()}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </Draggable>
              );
            })}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}