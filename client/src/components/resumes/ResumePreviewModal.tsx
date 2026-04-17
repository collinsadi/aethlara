import { motion } from "framer-motion";
import { X, ExternalLink, Loader2 } from "lucide-react";
import { useResumePreviewUrl } from "@/hooks/useResumes";

interface ResumePreviewModalProps {
  resumeId: string | null;
  resumeName: string;
  onClose: () => void;
}

export function ResumePreviewModal({
  resumeId,
  resumeName,
  onClose,
}: ResumePreviewModalProps) {
  const { data, isLoading, error } = useResumePreviewUrl(resumeId);

  if (!resumeId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="glass-card w-full max-w-4xl h-[80vh] flex flex-col relative z-10 overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground font-heading truncate">
            {resumeName}
          </h2>
          <div className="flex items-center gap-2">
            {data?.url && (
              <a
                href={data.url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {isLoading && (
            <div className="flex items-center justify-center flex-1 min-h-0">
              <Loader2 className="w-6 h-6 text-brand animate-spin" />
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center flex-1 min-h-0 text-center p-8">
              <p className="text-sm text-muted-foreground">
                Failed to load preview. Please try again.
              </p>
            </div>
          )}
          {data?.url && (
            <iframe
              src={data.url}
              title={`Preview: ${resumeName}`}
              className="w-full flex-1 min-h-0 border-0 bg-muted/30"
            />
          )}
        </div>
      </motion.div>
    </div>
  );
}
