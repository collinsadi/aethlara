import type { ApplicationStatus, Job } from "@/lib/types";

/** Columns shown on the tracker board (excludes `rejected`). */
export const BOARD_COLUMNS: ApplicationStatus[] = [
  "not_applied",
  "applied",
  "interview",
  "offer",
];

export function buildColumnItemIds(
  jobs: Job[]
): Record<ApplicationStatus, string[]> {
  const result = {} as Record<ApplicationStatus, string[]>;
  for (const col of BOARD_COLUMNS) {
    result[col] = jobs
      .filter((j) => j.status === col)
      .sort((a, b) => {
        const ao = a.kanbanOrder ?? 0;
        const bo = b.kanbanOrder ?? 0;
        if (ao !== bo) return ao - bo;
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      })
      .map((j) => j.id);
  }
  return result;
}

export function applyContainerItemsToJobs(
  prevJobs: Job[],
  containerItems: Record<ApplicationStatus, string[]>
): Job[] {
  const map = new Map(prevJobs.map((j) => [j.id, { ...j }]));
  const now = new Date().toISOString();
  for (const status of BOARD_COLUMNS) {
    const ids = containerItems[status] ?? [];
    ids.forEach((id, index) => {
      const j = map.get(id);
      if (!j) return;
      j.status = status;
      j.kanbanOrder = index;
      j.updatedAt = now;
    });
  }
  return Array.from(map.values());
}

/** Move a job to another column (appends to end). Used by quick "Move to …" action. */
export function moveJobToStatus(
  jobs: Job[],
  jobId: string,
  newStatus: ApplicationStatus
): Job[] {
  const job = jobs.find((j) => j.id === jobId);
  if (!job || job.status === newStatus) return jobs;

  if (!BOARD_COLUMNS.includes(newStatus)) {
    return jobs.map((j) =>
      j.id === jobId
        ? { ...j, status: newStatus, updatedAt: new Date().toISOString() }
        : j
    );
  }

  const items = buildColumnItemIds(jobs);
  const from = job.status;

  if (BOARD_COLUMNS.includes(from)) {
    items[from] = items[from].filter((id) => id !== jobId);
  }

  items[newStatus] = [...items[newStatus], jobId];
  return applyContainerItemsToJobs(jobs, items);
}
