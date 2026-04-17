import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Building2, MapPin, Clock, MessageSquare } from "lucide-react";
import { MatchBadge } from "./MatchBadge";
import type { Job } from "@/lib/types";
import { APPLICATION_STATUS_LABELS, APPLICATION_STATUS_COLORS } from "@/lib/types";

interface JobCardProps {
  job: Job;
  index?: number;
}

export function JobCard({ job, index = 0 }: JobCardProps) {
  const timeAgo = getTimeAgo(job.updatedAt);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay: index * 0.08,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      <Link to={`/jobs/${job.id}`}>
        <motion.div
          whileHover={{ y: -4, scale: 1.01 }}
          transition={{ duration: 0.25 }}
          className="glass-card p-5 glass-hover group cursor-pointer"
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted border border-border flex items-center justify-center">
                <Building2 className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground group-hover:text-brand transition-colors font-heading">
                  {job.title}
                </h3>
                <p className="text-xs text-muted-foreground">{job.company}</p>
              </div>
            </div>
            <MatchBadge score={job.matchScore} />
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {job.location && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {job.location}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {timeAgo}
            </span>
            <span className="flex items-center gap-1">
              <MessageSquare className="w-3 h-3" />
              Chat
            </span>
          </div>

          <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
            <span
              className={`px-2.5 py-1 rounded-full text-[10px] font-medium uppercase tracking-wider ${APPLICATION_STATUS_COLORS[job.status]}`}
            >
              {APPLICATION_STATUS_LABELS[job.status]}
            </span>
            <span className="text-[10px] text-muted-foreground group-hover:text-brand transition-colors">
              View details →
            </span>
          </div>
        </motion.div>
      </Link>
    </motion.div>
  );
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
