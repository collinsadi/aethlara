import { motion } from "framer-motion";
import {
  FileText,
  Trash2,
  Eye,
  Clock,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import type { ResumeItem } from "@/lib/types";
import { formatFileSize } from "@/lib/validators/resume.schema";

interface ResumeCardProps {
  resume: ResumeItem;
  isSelected: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onDelete: () => void;
  index: number;
}

const FORMAT_BADGE: Record<string, { label: string; className: string }> = {
  pdf: { label: "PDF", className: "bg-red-500/15 text-red-600 dark:text-red-400" },
  docx: { label: "DOCX", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  doc: { label: "DOC", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  md: { label: "MD", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  txt: { label: "TXT", className: "bg-neutral-500/15 text-neutral-600 dark:text-neutral-400" },
};

const STATUS_BADGE: Record<
  string,
  { label: string; icon: React.ReactNode; className: string }
> = {
  completed: {
    label: "Processed",
    icon: null,
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  processing: {
    label: "Processing",
    icon: <Loader2 className="w-3 h-3 animate-spin" />,
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  failed: {
    label: "Failed",
    icon: <AlertTriangle className="w-3 h-3" />,
    className: "bg-red-500/15 text-red-600 dark:text-red-400",
  },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function ResumeCard({
  resume,
  isSelected,
  onSelect,
  onPreview,
  onDelete,
  index,
}: ResumeCardProps) {
  const fmt = FORMAT_BADGE[resume.file_format] ?? FORMAT_BADGE.txt;
  const status = STATUS_BADGE[resume.extraction_status] ?? STATUS_BADGE.completed;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ delay: index * 0.05 }}
      className={`glass-card p-4 cursor-pointer transition-all ${
        isSelected
          ? "border-brand/35 bg-brand/[0.04]"
          : "glass-hover"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
          <FileText className="w-5 h-5 text-brand" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate font-heading">
            {resume.name}
          </h3>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${fmt.className}`}
            >
              {fmt.label}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {formatFileSize(resume.file_size_bytes)}
            </span>
            <span
              className="flex items-center gap-1 text-[10px] text-muted-foreground"
              title={new Date(resume.uploaded_at).toLocaleString()}
            >
              <Clock className="w-3 h-3" />
              {timeAgo(resume.uploaded_at)}
            </span>
          </div>
          {resume.extraction_status !== "completed" && (
            <span
              className={`inline-flex items-center gap-1 mt-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${status.className}`}
            >
              {status.icon}
              {status.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <motion.button
            type="button"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={(e) => {
              e.stopPropagation();
              onPreview();
            }}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <Eye className="w-4 h-4" />
          </motion.button>
          <motion.button
            type="button"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-500/10 transition-all"
          >
            <Trash2 className="w-4 h-4" />
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}
