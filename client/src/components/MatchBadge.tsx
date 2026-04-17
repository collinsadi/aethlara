import { cn } from "@/lib/utils";

interface MatchBadgeProps {
  score: number;
  size?: "sm" | "md" | "lg";
}

export function MatchBadge({ score, size = "md" }: MatchBadgeProps) {
  const tier =
    score >= 85
      ? { ring: "from-brand/25 to-emerald-500/15", text: "text-brand" }
      : score >= 70
        ? { ring: "from-neutral-400/25 to-neutral-600/15", text: "text-foreground" }
        : score >= 50
          ? { ring: "from-amber-400/25 to-orange-400/15", text: "text-amber-700 dark:text-amber-400" }
          : { ring: "from-red-400/25 to-rose-400/15", text: "text-red-600 dark:text-red-400" };

  const sizeClasses = {
    sm: "w-8 h-8 text-xs",
    md: "w-11 h-11 text-sm",
    lg: "w-14 h-14 text-base",
  };

  return (
    <div
      className={cn(
        "relative flex items-center justify-center rounded-full font-bold",
        sizeClasses[size]
      )}
    >
      <div
        className={cn(
          "absolute inset-0 rounded-full bg-gradient-to-br opacity-90",
          tier.ring
        )}
      />
      <span className={cn("relative z-10", tier.text)}>{score}%</span>
    </div>
  );
}
