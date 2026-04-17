import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  type DragStartEvent,
  useDroppable,
  useSensor,
  useSensors,
  closestCorners,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useState, type ReactNode } from "react";
import { Building2, GripVertical } from "lucide-react";
import { Link } from "react-router-dom";
import { MatchBadge } from "./MatchBadge";
import type { Job, ApplicationStatus } from "@/lib/types";
import { APPLICATION_STATUS_LABELS } from "@/lib/types";
import {
  applyContainerItemsToJobs,
  BOARD_COLUMNS,
  buildColumnItemIds,
} from "@/lib/kanban-board";

interface KanbanBoardProps {
  jobs: Job[];
  onJobsReorder: (jobs: Job[]) => void;
  onStatusChange: (jobId: string, status: ApplicationStatus) => void;
}

const columnColors: Record<ApplicationStatus, string> = {
  not_applied: "border-border",
  applied: "border-brand/40",
  interview: "border-neutral-400 dark:border-neutral-600",
  offer: "border-emerald-500/40",
  rejected: "border-red-500/40",
};

const columnDots: Record<ApplicationStatus, string> = {
  not_applied: "bg-muted-foreground/40",
  applied: "bg-brand",
  interview: "bg-neutral-500 dark:bg-neutral-400",
  offer: "bg-emerald-500",
  rejected: "bg-red-500",
};

export function KanbanBoard({
  jobs,
  onJobsReorder,
  onStatusChange,
}: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 10 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const activeJob = activeId
    ? jobs.find((j) => j.id === activeId) ?? null
    : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;

    const activeJobId = active.id as string;
    const overId = over.id as string;

    const findColumn = (id: string): ApplicationStatus | undefined => {
      if (BOARD_COLUMNS.includes(id as ApplicationStatus)) {
        return id as ApplicationStatus;
      }
      return jobs.find((j) => j.id === id)?.status;
    };

    const activeColumn = findColumn(activeJobId);
    const overColumn = findColumn(overId);

    if (
      !activeColumn ||
      !overColumn ||
      !BOARD_COLUMNS.includes(activeColumn) ||
      !BOARD_COLUMNS.includes(overColumn)
    ) {
      return;
    }

    const items = buildColumnItemIds(jobs);

    if (activeColumn === overColumn) {
      const colItems = [...items[activeColumn]];
      const oldIndex = colItems.indexOf(activeJobId);
      const newIndex = colItems.indexOf(overId);
      if (oldIndex === -1) return;
      if (BOARD_COLUMNS.includes(overId as ApplicationStatus)) {
        return;
      }
      if (newIndex === -1) return;
      if (oldIndex !== newIndex) {
        items[activeColumn] = arrayMove(colItems, oldIndex, newIndex);
        onJobsReorder(applyContainerItemsToJobs(jobs, items));
      }
    } else {
      const fromItems = [...items[activeColumn]];
      const toItems = [...items[overColumn]];
      const activeIdx = fromItems.indexOf(activeJobId);
      if (activeIdx === -1) return;
      fromItems.splice(activeIdx, 1);

      let insertIndex: number;
      if (BOARD_COLUMNS.includes(overId as ApplicationStatus)) {
        insertIndex = toItems.length;
      } else {
        const overIdx = toItems.indexOf(overId);
        insertIndex = overIdx === -1 ? toItems.length : overIdx;
      }
      toItems.splice(insertIndex, 0, activeJobId);

      items[activeColumn] = fromItems;
      items[overColumn] = toItems;
      onJobsReorder(applyContainerItemsToJobs(jobs, items));
    }
  };

  const handleDragCancel = () => {
    setActiveId(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {BOARD_COLUMNS.map((status) => {
          const columnJobs = jobs
            .filter((j) => j.status === status)
            .sort((a, b) => {
              const ao = a.kanbanOrder ?? 0;
              const bo = b.kanbanOrder ?? 0;
              if (ao !== bo) return ao - bo;
              return (
                new Date(b.updatedAt).getTime() -
                new Date(a.updatedAt).getTime()
              );
            });

          return (
            <KanbanColumn key={status} status={status} count={columnJobs.length}>
              <SortableContext
                items={columnJobs.map((j) => j.id)}
                strategy={verticalListSortingStrategy}
              >
                {columnJobs.map((job, i) => (
                  <SortableKanbanCard
                    key={job.id}
                    job={job}
                    index={i}
                    currentStatus={status}
                    onStatusChange={onStatusChange}
                  />
                ))}
              </SortableContext>

              {columnJobs.length === 0 && (
                <div className="flex items-center justify-center h-24 text-xs text-muted-foreground">
                  No jobs here
                </div>
              )}
            </KanbanColumn>
          );
        })}
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: "ease" }}>
        {activeJob ? <KanbanCardPreview job={activeJob} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({
  status,
  count,
  children,
}: {
  status: ApplicationStatus;
  count: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className={`w-2 h-2 rounded-full ${columnDots[status]}`} />
        <span className="text-sm font-medium text-foreground">
          {APPLICATION_STATUS_LABELS[status]}
        </span>
        <span className="text-xs text-muted-foreground ml-auto">{count}</span>
      </div>

      <div
        ref={setNodeRef}
        className={`glass-card p-2 min-h-[200px] border-t-2 ${columnColors[status]} rounded-t-none transition-colors ${
          isOver ? "ring-2 ring-brand/35 ring-inset bg-brand/6" : ""
        }`}
      >
        <div className="flex flex-col gap-2">{children}</div>
      </div>
    </div>
  );
}

function SortableKanbanCard({
  job,
  index,
  currentStatus,
  onStatusChange,
}: {
  job: Job;
  index: number;
  currentStatus: ApplicationStatus;
  onStatusChange: (jobId: string, status: ApplicationStatus) => void;
}) {
  const nextStatus = getNextStatus(currentStatus);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: job.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative">
      <div
        {...listeners}
        {...attributes}
        className="bg-muted/40 border border-border rounded-xl overflow-hidden cursor-grab active:cursor-grabbing group hover:bg-muted/60 transition-all touch-none"
        style={{ animationDelay: `${index * 50}ms` }}
      >
        <Link
          to={`/jobs/${job.id}`}
          className="block p-3"
          draggable={false}
        >
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0" />
              <div className="w-7 h-7 rounded-lg bg-card border border-border flex items-center justify-center">
                <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
            </div>
            <MatchBadge score={job.matchScore} size="sm" />
          </div>

          <h4 className="text-xs font-semibold text-foreground mb-0.5 group-hover:text-brand transition-colors font-heading">
            {job.title}
          </h4>
          <p className="text-[10px] text-muted-foreground">{job.company}</p>
        </Link>

        {nextStatus && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onStatusChange(job.id, nextStatus);
            }}
            className="w-full py-1.5 rounded-b-lg text-[10px] font-medium text-muted-foreground bg-card border border-t border-border hover:bg-muted hover:text-foreground transition-all opacity-0 group-hover:opacity-100"
          >
            Move to {APPLICATION_STATUS_LABELS[nextStatus]}
          </button>
        )}
      </div>
    </div>
  );
}

function KanbanCardPreview({ job }: { job: Job }) {
  return (
    <div className="bg-muted/90 border border-border rounded-xl p-3 shadow-lg max-w-[240px] cursor-grabbing">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <GripVertical className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <div className="w-7 h-7 rounded-lg bg-card border border-border flex items-center justify-center">
            <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
        </div>
        <MatchBadge score={job.matchScore} size="sm" />
      </div>
      <h4 className="text-xs font-semibold text-foreground mb-0.5 font-heading">
        {job.title}
      </h4>
      <p className="text-[10px] text-muted-foreground">{job.company}</p>
    </div>
  );
}

function getNextStatus(
  current: ApplicationStatus
): ApplicationStatus | null {
  const order: ApplicationStatus[] = [
    "not_applied",
    "applied",
    "interview",
    "offer",
  ];
  const idx = order.indexOf(current);
  return idx < order.length - 1 ? order[idx + 1] : null;
}
