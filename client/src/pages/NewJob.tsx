import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Sparkles, ArrowRight } from "lucide-react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import type { Job } from "@/lib/types";
import { SAMPLE_JOBS, generateId } from "@/lib/mock-data";

export function NewJob() {
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [, setJobs] = useLocalStorage<Job[]>("aethlara_jobs", SAMPLE_JOBS);
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;

    setIsAnalyzing(true);

    setTimeout(() => {
      const id = generateId("job");
      setJobs((prev) => {
        const inColumn = prev.filter((j) => j.status === "not_applied");
        const nextKanbanOrder =
          inColumn.reduce((m, j) => Math.max(m, j.kanbanOrder ?? 0), -1) + 1;
        const newJob: Job = {
          id,
          title: title || "Untitled Position",
          company: company || "Unknown Company",
          location: location || undefined,
          jobDescription: description,
          matchScore: Math.floor(Math.random() * 30) + 65,
          status: "not_applied",
          kanbanOrder: nextKanbanOrder,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        return [...prev, newJob];
      });
      navigate(`/jobs/${id}`);
    }, 1500);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-2xl font-semibold text-foreground tracking-tight font-heading">
          New Job
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Paste a job description and let AI analyze the match.
        </p>
      </motion.div>

      <motion.form
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        onSubmit={handleSubmit}
        className="glass-card p-8 space-y-6"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Job Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="field-input h-10"
              placeholder="e.g. Senior Software Engineer"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Company
            </label>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="field-input h-10"
              placeholder="e.g. Vercel"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            Location
          </label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="field-input h-10"
            placeholder="e.g. Remote, San Francisco, CA"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            Job Description *
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            rows={12}
            className="field-input min-h-[240px] py-3 resize-none leading-relaxed"
            placeholder="Paste the full job description here..."
          />
        </div>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          type="submit"
          disabled={!description.trim() || isAnalyzing}
          className="w-full btn-tf animate-btn-shine justify-center gap-2 text-sm font-semibold py-3 min-h-0 disabled:opacity-50 disabled:pointer-events-none"
        >
          {isAnalyzing ? (
            <>
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              >
                <Sparkles className="w-4 h-4" />
              </motion.div>
              Analyzing with AI...
            </>
          ) : (
            <>
              Analyze & Create Job
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </motion.button>
      </motion.form>
    </div>
  );
}
