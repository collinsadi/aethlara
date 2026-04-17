import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  FileText,
  X,
  Check,
  ArrowLeft,
  ArrowRight,
  Loader2,
  AlertCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useFileUpload } from "@/hooks/useFileUpload";
import { ALLOWED_EXTENSIONS, MAX_FILE_SIZE_BYTES, formatFileSize } from "@/lib/validators/resume.schema";

interface UploadResumeModalProps {
  open: boolean;
  onClose: () => void;
}

export function UploadResumeModal({ open, onClose }: UploadResumeModalProps) {
  const upload = useFileUpload();

  const handleClose = () => {
    upload.reset();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="glass-card w-full max-w-lg p-6 relative z-10"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-foreground font-heading">
            Upload Resume
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <AnimatePresence mode="wait">
          <StepRenderer key={upload.step} upload={upload} onClose={handleClose} />
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function StepRenderer({
  upload,
  onClose,
}: {
  upload: ReturnType<typeof useFileUpload>;
  onClose: () => void;
}) {
  switch (upload.step) {
    case "select":
      return <StepSelectFile upload={upload} />;
    case "name":
      return <StepNameResume upload={upload} />;
    case "uploading":
      return <StepUploading upload={upload} />;
    case "processing":
      return <StepProcessing />;
    case "success":
      return <StepSuccess onClose={onClose} onUploadAnother={upload.reset} />;
    case "error":
      return <StepError upload={upload} />;
  }
}

function StepSelectFile({ upload }: { upload: ReturnType<typeof useFileUpload> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) upload.selectFile(file);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
          dragActive
            ? "border-brand/40 bg-brand/[0.04]"
            : "border-border hover:border-neutral-400 dark:hover:border-neutral-600"
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept={ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",")}
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />

        <div className="flex flex-col items-center">
          <div
            className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-4 transition-colors ${
              dragActive ? "bg-brand/15" : "bg-muted"
            }`}
          >
            <Upload
              className={`w-6 h-6 transition-colors ${
                dragActive ? "text-brand" : "text-muted-foreground"
              }`}
            />
          </div>
          <p className="text-sm font-medium text-foreground mb-1 font-heading">
            {dragActive ? "Drop your file here" : "Drop a file or click to browse"}
          </p>
          <p className="text-xs text-muted-foreground">
            PDF, DOCX, DOC, MD, TXT — up to {formatFileSize(MAX_FILE_SIZE_BYTES)}
          </p>
        </div>
      </div>

      {upload.validationError && (
        <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
          <p className="text-xs text-red-500">{upload.validationError}</p>
        </div>
      )}
    </motion.div>
  );
}

function StepNameResume({ upload }: { upload: ReturnType<typeof useFileUpload> }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="space-y-5"
    >
      {upload.file && (
        <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5">
          <FileText className="w-5 h-5 text-brand shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground truncate">
              {upload.file.name}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {formatFileSize(upload.file.size)}
            </p>
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
          Resume Name
        </label>
        <input
          type="text"
          value={upload.name}
          onChange={(e) => upload.setName(e.target.value)}
          placeholder="e.g. Software Engineer Resume"
          className="field-input h-11 px-4"
          maxLength={60}
          autoFocus
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          {upload.name.length}/60 characters
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => upload.goToStep("select")}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>
        <motion.button
          type="button"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={upload.startUpload}
          disabled={upload.name.trim().length < 2}
          className="flex-1 btn-tf animate-btn-shine justify-center gap-2 text-sm font-semibold py-2.5 min-h-0 disabled:opacity-40 disabled:pointer-events-none"
        >
          Upload
          <ArrowRight className="w-4 h-4" />
        </motion.button>
      </div>
    </motion.div>
  );
}

function StepUploading({ upload }: { upload: ReturnType<typeof useFileUpload> }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="py-6 text-center space-y-4"
    >
      <Loader2 className="w-8 h-8 text-brand animate-spin mx-auto" />
      <div>
        <p className="text-sm font-medium text-foreground font-heading">
          Uploading your resume…
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {upload.progress}% complete
        </p>
      </div>
      <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
        <motion.div
          className="h-full bg-brand rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${upload.progress}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>
    </motion.div>
  );
}

function StepProcessing() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="py-8 text-center space-y-4"
    >
      <motion.div
        animate={{ rotate: [0, 10, -10, 0] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      >
        <Sparkles className="w-10 h-10 text-brand mx-auto" />
      </motion.div>
      <div>
        <p className="text-sm font-medium text-foreground font-heading">
          Our AI is reading your resume…
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Extracting skills, experience, and education
        </p>
      </div>
    </motion.div>
  );
}

function StepSuccess({
  onClose,
  onUploadAnother,
}: {
  onClose: () => void;
  onUploadAnother: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      className="py-6 text-center space-y-5"
    >
      <div className="size-14 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto">
        <Check className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground font-heading">
          Resume uploaded successfully!
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Your resume is ready for job matching.
        </p>
      </div>
      <div className="flex items-center gap-3 justify-center">
        <button
          type="button"
          onClick={onUploadAnother}
          className="text-xs text-brand hover:opacity-80 transition-opacity"
        >
          Upload another
        </button>
        <motion.button
          type="button"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onClose}
          className="btn-tf animate-btn-shine justify-center text-sm font-semibold py-2 px-6 min-h-0"
        >
          Done
        </motion.button>
      </div>
    </motion.div>
  );
}

function StepError({ upload }: { upload: ReturnType<typeof useFileUpload> }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      className="py-6 text-center space-y-5"
    >
      <div className="size-14 rounded-full bg-red-500/15 flex items-center justify-center mx-auto">
        <AlertCircle className="w-7 h-7 text-red-500" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground font-heading">
          Upload failed
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {upload.errorMessage}
        </p>
      </div>
      <motion.button
        type="button"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={upload.startUpload}
        className="btn-tf animate-btn-shine justify-center gap-2 text-sm font-semibold py-2 px-6 min-h-0 mx-auto"
      >
        <RefreshCw className="w-4 h-4" />
        Retry
      </motion.button>
    </motion.div>
  );
}
