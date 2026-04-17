import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Eye } from "lucide-react";
import { useResumes, useDeleteResume } from "@/hooks/useResumes";
import { ResumeList } from "@/components/resumes/ResumeList";
import { UploadResumeModal } from "@/components/resumes/UploadResumeModal";
import { ResumePreviewModal } from "@/components/resumes/ResumePreviewModal";
import { DeleteResumeDialog } from "@/components/resumes/DeleteResumeDialog";

export function Resumes() {
  const { data: resumes, isLoading } = useResumes();
  const deleteMutation = useDeleteResume();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const previewResume = resumes?.find((r) => r.id === previewId);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      if (selectedId === deleteTarget.id) setSelectedId(null);
      if (previewId === deleteTarget.id) setPreviewId(null);
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight font-heading">
            Resumes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload and manage your base resumes. AI will tailor them per job.
          </p>
        </div>
        <motion.button
          type="button"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setUploadOpen(true)}
          className="btn-tf animate-btn-shine text-sm font-semibold py-2 px-4 min-h-0 gap-2"
        >
          <Plus className="w-4 h-4" />
          Upload
        </motion.button>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2">
          <ResumeList
            resumes={resumes}
            isLoading={isLoading}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onPreview={setPreviewId}
            onDelete={(id) => {
              const r = resumes?.find((res) => res.id === id);
              if (r) setDeleteTarget({ id, name: r.name });
            }}
          />
        </div>

        <div className="lg:col-span-3">
          <div className="glass-card overflow-hidden h-[600px] sticky top-24">
            {selectedId ? (
              <div className="flex items-center justify-center h-full text-center p-8">
                <div>
                  <Eye className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground mb-2 font-heading">
                    {resumes?.find((r) => r.id === selectedId)?.name}
                  </p>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setPreviewId(selectedId)}
                    className="btn-tf-secondary animate-btn-shine text-xs font-semibold py-1.5 px-4 min-h-0 gap-1.5"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Open Preview
                  </motion.button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-center p-8">
                <div>
                  <Eye className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Select a resume to preview
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {uploadOpen && (
          <UploadResumeModal
            open={uploadOpen}
            onClose={() => setUploadOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {previewId && previewResume && (
          <ResumePreviewModal
            resumeId={previewId}
            resumeName={previewResume.name}
            onClose={() => setPreviewId(null)}
          />
        )}
      </AnimatePresence>

      <DeleteResumeDialog
        open={!!deleteTarget}
        resumeName={deleteTarget?.name ?? ""}
        isDeleting={deleteMutation.isPending}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
