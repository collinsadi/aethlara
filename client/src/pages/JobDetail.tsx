import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Building2,
  MapPin,
  Clock,
  ExternalLink,
} from "lucide-react";
import { useState } from "react";
import { ChatInterface } from "@/components/ChatInterface";
import { ResumePreview } from "@/components/ResumePreview";
import { MatchBadge } from "@/components/MatchBadge";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import type { Job, ChatMessage, LegacyResume, ApplicationStatus } from "@/lib/types";
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_COLORS,
} from "@/lib/types";
import { SAMPLE_JOBS, SAMPLE_CHAT_MESSAGES, SAMPLE_RESUMES } from "@/lib/mock-data";

export function JobDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const [jobs, setJobs] = useLocalStorage<Job[]>("aethlara_jobs", SAMPLE_JOBS);
  const [chatHistories, setChatHistories] = useLocalStorage<
    Record<string, ChatMessage[]>
  >("aethlara_chats", SAMPLE_CHAT_MESSAGES);
  const [resumes] = useLocalStorage<LegacyResume[]>(
    "aethlara_resumes",
    SAMPLE_RESUMES
  );
  const [showPreview, setShowPreview] = useState(false);

  const job = jobs.find((j) => j.id === jobId);
  if (!job) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <p className="text-lg text-muted-foreground mb-4">Job not found</p>
          <Link
            to="/jobs"
            className="text-sm text-brand hover:opacity-80 transition-opacity"
          >
            ← Back to jobs
          </Link>
        </div>
      </div>
    );
  }

  const messages = chatHistories[job.id] ?? [];
  const linkedResume = resumes.find((r) => r.id === job.resumeId) ?? resumes[0];

  const handleStatusChange = (status: ApplicationStatus) => {
    setJobs((prev) =>
      prev.map((j) =>
        j.id === job.id ? { ...j, status, updatedAt: new Date().toISOString() } : j
      )
    );
  };

  return (
    <div className="h-[calc(100vh-8rem)]">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-4"
      >
        <div className="flex items-center gap-3">
          <Link
            to="/jobs"
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-foreground font-heading">{job.title}</h1>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Building2 className="w-3 h-3" />
                {job.company}
              </span>
              {job.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {job.location}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(job.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <MatchBadge score={job.matchScore} size="lg" />
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className={`hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
              showPreview
                ? "bg-brand/10 text-brand border-brand/30"
                : "text-muted-foreground bg-muted/50 border-border hover:text-foreground"
            }`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Resume Preview
          </button>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100%-3.5rem)]">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="lg:col-span-3 space-y-3 overflow-y-auto"
        >
          <div className="glass-card p-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Status
            </h3>
            <div className="flex flex-wrap gap-2">
              {(
                ["not_applied", "applied", "interview", "offer"] as ApplicationStatus[]
              ).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => handleStatusChange(status)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-medium uppercase tracking-wider transition-all border ${
                    job.status === status
                      ? `${APPLICATION_STATUS_COLORS[status]} border-current/30`
                      : "text-muted-foreground bg-muted/40 border-border hover:bg-muted"
                  }`}
                >
                  {APPLICATION_STATUS_LABELS[status]}
                </button>
              ))}
            </div>
          </div>

          <div className="glass-card p-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Job Description
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-[12]">
              {job.jobDescription}
            </p>
          </div>

          <div className="glass-card p-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Quick Actions
            </h3>
            <div className="space-y-2">
              {[
                "Analyze match strength",
                "Tailor my resume",
                "Write cover letter",
                "Prep for interview",
              ].map((action) => (
                <button
                  key={action}
                  type="button"
                  className="w-full px-3 py-2 rounded-lg text-xs text-left text-muted-foreground bg-muted/40 border border-border hover:bg-muted hover:text-foreground transition-all"
                >
                  {action}
                </button>
              ))}
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className={`glass-card overflow-hidden ${
            showPreview ? "lg:col-span-5" : "lg:col-span-9"
          }`}
        >
          <ChatInterface
            jobId={job.id}
            messages={messages}
            onMessagesChange={(updated) =>
              setChatHistories((prev) => ({ ...prev, [job.id]: updated }))
            }
          />
        </motion.div>

        {showPreview && linkedResume && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="hidden lg:block lg:col-span-4 glass-card overflow-hidden"
          >
            <ResumePreview
              content={linkedResume.rawText}
              title={linkedResume.name}
            />
          </motion.div>
        )}
      </div>
    </div>
  );
}
