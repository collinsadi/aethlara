/**
 * File upload state machine hook for resume uploads.
 *
 * Manages the multi-step flow: select → name → uploading → processing → success/error
 * Preserves file and name across step transitions so the user never loses progress.
 */
import { useState, useCallback } from "react";
import { validateResumeFile } from "@/lib/validators/resume.schema";
import { useUploadResume } from "@/hooks/useResumes";

export type UploadStep =
  | "select"
  | "name"
  | "uploading"
  | "processing"
  | "success"
  | "error";

export interface UseFileUpload {
  step: UploadStep;
  file: File | null;
  name: string;
  progress: number;
  errorMessage: string | null;
  validationError: string | null;

  setFile: (f: File | null) => void;
  setName: (n: string) => void;
  goToStep: (s: UploadStep) => void;
  selectFile: (f: File) => void;
  startUpload: () => Promise<void>;
  reset: () => void;
}

export function useFileUpload(): UseFileUpload {
  const [step, setStep] = useState<UploadStep>("select");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const uploadMutation = useUploadResume();

  const selectFile = useCallback((f: File) => {
    const error = validateResumeFile(f);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    setFile(f);
    setName(f.name.replace(/\.[^.]+$/, ""));
    setStep("name");
  }, []);

  const startUpload = useCallback(async () => {
    if (!file || !name.trim()) return;

    setStep("uploading");
    setProgress(0);
    setErrorMessage(null);

    try {
      await uploadMutation.mutateAsync({
        file,
        name: name.trim(),
        onProgress: setProgress,
      });
      setStep("processing");
      // Brief delay to show the processing state before success
      await new Promise((r) => setTimeout(r, 800));
      setStep("success");
    } catch (err) {
      const msg =
        (err as { message?: string })?.message ?? "Upload failed. Please try again.";
      setErrorMessage(msg);
      setStep("error");
    }
  }, [file, name, uploadMutation]);

  const reset = useCallback(() => {
    setStep("select");
    setFile(null);
    setName("");
    setProgress(0);
    setErrorMessage(null);
    setValidationError(null);
  }, []);

  const goToStep = useCallback((s: UploadStep) => {
    setStep(s);
  }, []);

  return {
    step,
    file,
    name,
    progress,
    errorMessage,
    validationError,
    setFile,
    setName,
    goToStep,
    selectFile,
    startUpload,
    reset,
  };
}
