import { motion } from "framer-motion";
import { AlertTriangle, Loader2 } from "lucide-react";

interface DeleteResumeDialogProps {
  open: boolean;
  resumeName: string;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteResumeDialog({
  open,
  resumeName,
  isDeleting,
  onConfirm,
  onCancel,
}: DeleteResumeDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="glass-card w-full max-w-sm p-6 relative z-10 text-center"
      >
        <div className="size-12 rounded-full bg-red-500/15 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-red-500" />
        </div>
        <h3 className="text-base font-semibold text-foreground font-heading mb-1">
          Delete Resume
        </h3>
        <p className="text-sm text-muted-foreground mb-5">
          Are you sure you want to delete{" "}
          <span className="font-medium text-foreground">{resumeName}</span>?
          This action cannot be undone.
        </p>
        <div className="flex items-center gap-3 justify-center">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-50"
          >
            {isDeleting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              "Delete"
            )}
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}
