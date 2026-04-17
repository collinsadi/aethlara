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
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useState, type ReactNode } from 'react'
import { Building2, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ApiJob, JobStatus } from '@/lib/types'
import { ALLOWED_TRANSITIONS } from '@/lib/types'

interface Props {
  columns: Record<JobStatus, ApiJob[]>
  onMove: (jobId: string, fromStatus: JobStatus, toStatus: JobStatus) => void
  onCardClick: (jobId: string) => void
  isPending: boolean
}

const BOARD_COLS: JobStatus[] = ['not_applied', 'applied', 'interview', 'offer']

const COL_LABELS: Record<JobStatus, string> = {
  not_applied: 'Not Applied',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

const COL_DOT: Record<JobStatus, string> = {
  not_applied: 'bg-muted-foreground/40',
  applied: 'bg-brand',
  interview: 'bg-neutral-500 dark:bg-neutral-400',
  offer: 'bg-emerald-500',
  rejected: 'bg-red-500',
  withdrawn: 'bg-neutral-400',
}

const COL_BORDER: Record<JobStatus, string> = {
  not_applied: 'border-border',
  applied: 'border-brand/40',
  interview: 'border-neutral-400 dark:border-neutral-600',
  offer: 'border-emerald-500/40',
  rejected: 'border-red-500/40',
  withdrawn: 'border-neutral-400/40',
}

const SCORE_COLOR = (score: number | null) =>
  score === null ? 'text-muted-foreground'
  : score >= 70 ? 'text-emerald-500'
  : score >= 40 ? 'text-amber-500'
  : 'text-red-500'

function findJobColumn(
  columns: Record<JobStatus, ApiJob[]>,
  jobId: string
): JobStatus | undefined {
  for (const status of BOARD_COLS) {
    if (columns[status].some((j) => j.id === jobId)) return status
  }
  return undefined
}

export function ApiKanbanBoard({ columns, onMove, onCardClick, isPending }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const activeJob = activeId
    ? BOARD_COLS.flatMap((s) => columns[s]).find((j) => j.id === activeId) ?? null
    : null

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(e.active.id as string)
  }

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    setActiveId(null)
    if (!over || active.id === over.id) return

    const jobId = active.id as string
    const overId = over.id as string

    const fromStatus = findJobColumn(columns, jobId)
    if (!fromStatus) return

    const toStatus: JobStatus = BOARD_COLS.includes(overId as JobStatus)
      ? (overId as JobStatus)
      : (findJobColumn(columns, overId) ?? fromStatus)

    if (fromStatus === toStatus) return
    if (!ALLOWED_TRANSITIONS[fromStatus].includes(toStatus)) return

    onMove(jobId, fromStatus, toStatus)
  }

  const handleDragCancel = () => setActiveId(null)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {BOARD_COLS.map((status) => {
          const colJobs = columns[status]
          return (
            <KanbanColumn
              key={status}
              status={status}
              count={colJobs.length}
              activeJobStatus={activeJob?.status}
            >
              <SortableContext
                items={colJobs.map((j) => j.id)}
                strategy={verticalListSortingStrategy}
              >
                {colJobs.map((job, i) => (
                  <SortableCard
                    key={job.id}
                    job={job}
                    index={i}
                    isPending={isPending}
                    onQuickMove={(toStatus) => onMove(job.id, job.status, toStatus)}
                    onClick={() => onCardClick(job.id)}
                  />
                ))}
              </SortableContext>
              {colJobs.length === 0 && (
                <div className="flex items-center justify-center h-20 text-xs text-muted-foreground/50">
                  Drop here
                </div>
              )}
            </KanbanColumn>
          )
        })}
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
        {activeJob ? <CardPreview job={activeJob} /> : null}
      </DragOverlay>
    </DndContext>
  )
}

function KanbanColumn({
  status,
  count,
  children,
  activeJobStatus,
}: {
  status: JobStatus
  count: number
  children: ReactNode
  activeJobStatus?: JobStatus
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })

  const isValidDrop =
    activeJobStatus !== undefined &&
    activeJobStatus !== status &&
    ALLOWED_TRANSITIONS[activeJobStatus].includes(status)

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className={cn('w-2 h-2 rounded-full', COL_DOT[status])} />
        <span className="text-sm font-medium text-foreground font-heading">
          {COL_LABELS[status]}
        </span>
        <span className="text-xs text-muted-foreground ml-auto">{count}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'glass-card p-2 min-h-[200px] border-t-2 rounded-t-none transition-all',
          COL_BORDER[status],
          isOver && isValidDrop && 'ring-2 ring-brand/35 ring-inset bg-brand/5',
          activeJobStatus !== undefined && !isValidDrop && activeJobStatus !== status && 'opacity-50'
        )}
      >
        <div className="flex flex-col gap-2">{children}</div>
      </div>
    </div>
  )
}

function SortableCard({
  job,
  index,
  isPending,
  onQuickMove,
  onClick,
}: {
  job: ApiJob
  index: number
  isPending: boolean
  onQuickMove: (toStatus: JobStatus) => void
  onClick: () => void
}) {
  const validMoves = ALLOWED_TRANSITIONS[job.status].filter((s) =>
    BOARD_COLS.includes(s)
  )
  const nextMove = validMoves[0] ?? null

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: job.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className="bg-muted/40 border border-border rounded-xl overflow-hidden group hover:bg-muted/60 transition-all"
        style={{ animationDelay: `${index * 50}ms` }}
      >
        <div className="flex items-start gap-1 p-3">
          <button
            type="button"
            {...listeners}
            {...attributes}
            className="mt-0.5 cursor-grab active:cursor-grabbing touch-none"
            aria-label="Drag to reorder"
          >
            <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
          </button>

          <button
            type="button"
            onClick={onClick}
            className="flex-1 text-left min-w-0"
          >
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div className="w-7 h-7 rounded-lg bg-card border border-border flex items-center justify-center shrink-0">
                <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              {job.match_score !== null && (
                <span className={cn('text-[11px] font-semibold tabular-nums shrink-0', SCORE_COLOR(job.match_score))}>
                  {job.match_score}%
                </span>
              )}
            </div>
            <h4 className="text-xs font-semibold text-foreground group-hover:text-brand transition-colors font-heading line-clamp-2">
              {job.job_title}
            </h4>
            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{job.company}</p>
          </button>
        </div>

        {nextMove && (
          <button
            type="button"
            disabled={isPending}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onQuickMove(nextMove)
            }}
            className="w-full py-1.5 rounded-b-lg text-[10px] font-medium text-muted-foreground bg-card border-t border-border hover:bg-muted hover:text-foreground transition-all opacity-0 group-hover:opacity-100 disabled:cursor-not-allowed"
          >
            Move to {COL_LABELS[nextMove]}
          </button>
        )}
      </div>
    </div>
  )
}

function CardPreview({ job }: { job: ApiJob }) {
  return (
    <div className="bg-muted/90 border border-border rounded-xl p-3 shadow-lg max-w-[240px] cursor-grabbing">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2">
          <GripVertical className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <div className="w-7 h-7 rounded-lg bg-card border border-border flex items-center justify-center">
            <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
        </div>
        {job.match_score !== null && (
          <span className={cn('text-[11px] font-semibold tabular-nums', SCORE_COLOR(job.match_score))}>
            {job.match_score}%
          </span>
        )}
      </div>
      <h4 className="text-xs font-semibold text-foreground font-heading">{job.job_title}</h4>
      <p className="text-[10px] text-muted-foreground mt-0.5">{job.company}</p>
    </div>
  )
}
