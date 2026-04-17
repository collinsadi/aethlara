import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { Upload, FileText, X, Check } from "lucide-react";

interface ResumeUploaderProps {
  onUpload: (name: string, text: string) => void;
}

export function ResumeUploader({ onUpload }: ResumeUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [mode, setMode] = useState<"idle" | "text">("idle");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => setDragActive(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setName(file.name.replace(/\.[^.]+$/, ""));
      setText(content);
      setMode("text");
    };
    reader.readAsText(file);
  };

  const handleSubmit = () => {
    if (name.trim() && text.trim()) {
      onUpload(name.trim(), text.trim());
      setName("");
      setText("");
      setMode("idle");
    }
  };

  if (mode === "text") {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass-card p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground font-heading">New Resume</h3>
          <button
            type="button"
            onClick={() => setMode("idle")}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Resume name..."
          className="field-input h-10 mb-3"
        />

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste your resume content here..."
          rows={10}
          className="field-input min-h-[200px] py-2 resize-none font-mono text-xs leading-relaxed"
        />

        <motion.button
          type="button"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleSubmit}
          disabled={!name.trim() || !text.trim()}
          className="mt-3 w-full btn-tf animate-btn-shine justify-center text-sm font-semibold py-2.5 min-h-0 disabled:opacity-40 disabled:pointer-events-none"
        >
          <Check className="w-4 h-4" />
          Save Resume
        </motion.button>
      </motion.div>
    );
  }

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: 0.3 }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => setMode("text")}
      className={`glass-card p-8 cursor-pointer group transition-all duration-300 ${
        dragActive
          ? "border-brand/40 bg-brand/[0.04]"
          : "hover:border-neutral-300 dark:hover:border-neutral-600"
      }`}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
        className="hidden"
      />

      <div className="flex flex-col items-center text-center">
        <div
          className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 transition-colors ${
            dragActive
              ? "bg-brand/15"
              : "bg-muted group-hover:bg-muted/80"
          }`}
        >
          <Upload
            className={`w-5 h-5 transition-colors ${
              dragActive ? "text-brand" : "text-muted-foreground group-hover:text-foreground"
            }`}
          />
        </div>
        <p className="text-sm font-medium text-foreground mb-1 font-heading">
          Upload or paste resume
        </p>
        <p className="text-xs text-muted-foreground">
          Drop a text file or click to paste content
        </p>
        <div className="flex items-center gap-2 mt-3">
          <FileText className="w-3.5 h-3.5 text-muted-foreground/60" />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            TXT · MD · Paste
          </span>
        </div>
      </div>
    </motion.div>
  );
}
