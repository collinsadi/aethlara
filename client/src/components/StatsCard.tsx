import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

interface StatsCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  subtext?: string;
  color: "indigo" | "teal" | "purple" | "amber";
  index?: number;
}

const colorMap = {
  indigo: {
    bg: "bg-brand/10",
    text: "text-brand",
  },
  teal: {
    bg: "bg-neutral-200 dark:bg-neutral-800",
    text: "text-neutral-700 dark:text-neutral-300",
  },
  purple: {
    bg: "bg-neutral-900/5 dark:bg-neutral-100/10",
    text: "text-neutral-800 dark:text-neutral-200",
  },
  amber: {
    bg: "bg-brand/10",
    text: "text-brand",
  },
};

export function StatsCard({
  icon: Icon,
  label,
  value,
  subtext,
  color,
  index = 0,
}: StatsCardProps) {
  const colors = colorMap[color];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay: index * 0.1,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={{ y: -3, scale: 1.01 }}
      className="glass-card p-5 glass-hover"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground font-medium">{label}</p>
          <p className="text-3xl font-semibold text-foreground mt-1 tracking-tight font-heading">
            {value}
          </p>
          {subtext && (
            <p className="text-xs text-muted-foreground/80 mt-1">{subtext}</p>
          )}
        </div>
        <div className={`p-2.5 rounded-xl ${colors.bg}`}>
          <Icon className={`w-5 h-5 ${colors.text}`} />
        </div>
      </div>
    </motion.div>
  );
}
