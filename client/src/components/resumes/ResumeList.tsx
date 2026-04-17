import { AnimatePresence } from "framer-motion";
import { FileText, Loader2 } from "lucide-react";
import { ResumeCard } from "@/components/resumes/ResumeCard";
import type { ResumeItem } from "@/lib/types";

interface ResumeListProps {
  resumes: ResumeItem[] | undefined;
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPreview: (id: string) => void;
  onDelete: (id: string) => void;
}

export function ResumeList({
  resumes,
  isLoading,
  selectedId,
  onSelect,
  onPreview,
  onDelete,
}: ResumeListProps) {
  if (isLoading) {
    return (
      <div className="glass-card p-8 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-brand animate-spin" />
      </div>
    );
  }

  if (!resumes?.length) {
    return (
      <div className="glass-card p-8 text-center">
        <FileText className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">
          No resumes yet. Upload your first one above.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <AnimatePresence>
        {resumes.map((resume, i) => (
          <ResumeCard
            key={resume.id}
            resume={resume}
            isSelected={selectedId === resume.id}
            onSelect={() => onSelect(resume.id)}
            onPreview={() => onPreview(resume.id)}
            onDelete={() => onDelete(resume.id)}
            index={i}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
