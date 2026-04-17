/**
 * Resume API calls.
 *
 * GET    /resumes              → { data: ResumeItem[] }
 * POST   /resumes/upload       → { data: ResumeItem }  (multipart)
 * GET    /resumes/:id/preview-url → { data: { url, expires_at } }
 * DELETE /resumes/:id          → { data: { id, deleted_at } }
 * GET    /resumes/has-active   → { data: { has_active_resume: boolean } }
 */
import { apiClient } from "@/api/client";
import type {
  ApiSuccessResponse,
  ResumeItem,
  ResumePreviewUrlResult,
} from "@/lib/types";

/** Upload waits on R2, extraction, and AI — longer than the default 15s API client timeout. */
const RESUME_UPLOAD_TIMEOUT_MS = 180_000;

export async function getResumesApi(): Promise<ResumeItem[]> {
  const res =
    await apiClient.get<ApiSuccessResponse<ResumeItem[]>>("/resumes");
  return res.data.data ?? [];
}

export async function uploadResumeApi(
  file: File,
  name: string,
  onProgress?: (percent: number) => void
): Promise<ResumeItem> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("name", name);

  const res = await apiClient.post<ApiSuccessResponse<ResumeItem>>(
    "/resumes/upload",
    formData,
    {
      timeout: RESUME_UPLOAD_TIMEOUT_MS,
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (e) => {
        if (e.total && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      },
    }
  );
  return res.data.data!;
}

export async function getResumePreviewUrlApi(
  id: string
): Promise<ResumePreviewUrlResult> {
  const res = await apiClient.get<ApiSuccessResponse<ResumePreviewUrlResult>>(
    `/resumes/${id}/preview-url`
  );
  return res.data.data!;
}

export async function deleteResumeApi(
  id: string
): Promise<{ id: string; deleted_at: string }> {
  const res = await apiClient.delete<
    ApiSuccessResponse<{ id: string; deleted_at: string }>
  >(`/resumes/${id}`);
  return res.data.data!;
}

export async function hasActiveResumeApi(): Promise<boolean> {
  const res = await apiClient.get<
    ApiSuccessResponse<{ has_active_resume: boolean }>
  >("/resumes/has-active");
  return res.data.data?.has_active_resume ?? false;
}
