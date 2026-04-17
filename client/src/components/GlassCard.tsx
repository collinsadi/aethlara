import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

interface GlassCardProps extends HTMLMotionProps<"div"> {
  hover?: boolean;
  glow?: "indigo" | "teal" | "purple" | "none";
}

const glowStyles = {
  indigo: "hover:shadow-[0_12px_40px_-10px_rgba(253,58,37,0.12)]",
  teal: "hover:shadow-[0_12px_40px_-10px_rgba(9,9,11,0.08)]",
  purple: "hover:shadow-[0_12px_40px_-10px_rgba(9,9,11,0.12)]",
  none: "",
};

export function GlassCard({
  children,
  className,
  hover = true,
  glow = "none",
  ...props
}: GlassCardProps) {
  return (
    <motion.div
      whileHover={hover ? { y: -2, scale: 1.005 } : undefined}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "glass-card p-6",
        hover && "glass-hover cursor-default",
        glowStyles[glow],
        className
      )}
      {...props}
    >
      {children}
    </motion.div>
  );
}
