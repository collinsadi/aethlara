import { motion } from "framer-motion";
import { Download, FileText } from "lucide-react";
import Markdown from "react-markdown";

interface ResumePreviewProps {
  content: string;
  title?: string;
}

export function ResumePreview({ content, title }: ResumePreviewProps) {
  const handleExport = () => {
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title ?? "resume"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col bg-card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-brand" />
          <span className="text-sm font-medium text-foreground font-heading">
            {title ?? "Resume Preview"}
          </span>
        </div>
        <motion.button
          type="button"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleExport}
          className="btn-tf-secondary animate-btn-shine px-3 py-1.5 text-xs font-semibold min-h-0 gap-1.5"
        >
          <Download className="w-3.5 h-3.5" />
          Export
        </motion.button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 bg-background/30">
        <div
          className="prose prose-sm max-w-none dark:prose-invert
          [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-foreground [&_h1]:mb-2 [&_h1]:font-heading
          [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:pb-1 [&_h2]:border-b [&_h2]:border-border [&_h2]:font-heading
          [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground
          [&_p]:text-muted-foreground [&_p]:text-sm [&_p]:leading-relaxed
          [&_li]:text-muted-foreground [&_li]:text-sm
          [&_strong]:text-foreground
          [&_hr]:border-border"
        >
          <Markdown>{content}</Markdown>
        </div>
      </div>
    </div>
  );
}
