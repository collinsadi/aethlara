/**
 * Resume CRUD hooks backed by React Query.
 *
 * - useResumes()           → list query
 * - useResumePreviewUrl()  → pre-signed URL query (10 min cache)
 * - useUploadResume()      → upload mutation with list invalidation
 * - useDeleteResume()      → delete mutation with optimistic update + rollback
 * - useCanCreateJob()      → gate: check if user has at least one resume
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getResumesApi,
  getResumePreviewUrlApi,
  uploadResumeApi,
  deleteResumeApi,
} from "@/api/resumes";
import { queryKeys } from "@/lib/queryKeys";
import type { ResumeItem } from "@/lib/types";

const resumeKeys = queryKeys.resumes;

export function useResumes() {
  return useQuery({
    queryKey: resumeKeys.list(),
    queryFn: getResumesApi,
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 10,
  });
}

export function useResumePreviewUrl(id: string | null) {
  return useQuery({
    queryKey: resumeKeys.previewUrl(id!),
    queryFn: () => getResumePreviewUrlApi(id!),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 15,
    enabled: !!id,
  });
}

export function useUploadResume() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      file,
      name,
      onProgress,
    }: {
      file: File;
      name: string;
      onProgress?: (percent: number) => void;
    }) => uploadResumeApi(file, name, onProgress),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: resumeKeys.list() });
      // The autopilot picks the latest processed resume on first use.
      qc.invalidateQueries({ queryKey: queryKeys.agent.overview() });
    },
  });
}

export function useDeleteResume() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteResumeApi(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: resumeKeys.list() });
      const previous = qc.getQueryData<ResumeItem[]>(resumeKeys.list());
      qc.setQueryData<ResumeItem[]>(resumeKeys.list(), (old) =>
        old ? old.filter((r) => r.id !== id) : []
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        qc.setQueryData(resumeKeys.list(), context.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: resumeKeys.list() });
      qc.invalidateQueries({ queryKey: queryKeys.agent.overview() });
    },
  });
}

export function useCanCreateJob() {
  const { data: resumes } = useResumes();
  return {
    canCreate: (resumes?.length ?? 0) > 0,
    reason: "Upload a resume before adding a job.",
  };
}
