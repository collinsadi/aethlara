import { motion } from "framer-motion";

/* Subtle ambient layers aligned with Aigocy neutrals + brand accent */
const orbs = [
  { size: 520, x: "8%", y: "15%", color: "rgba(253, 58, 37, 0.04)", duration: 28 },
  { size: 480, x: "72%", y: "12%", color: "rgba(9, 9, 11, 0.04)", duration: 32 },
  { size: 380, x: "48%", y: "68%", color: "rgba(82, 82, 91, 0.06)", duration: 24 },
];

export function AnimatedOrbs() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0 dark:opacity-80">
      {orbs.map((orb, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: orb.size,
            height: orb.size,
            left: orb.x,
            top: orb.y,
            background: `radial-gradient(circle, ${orb.color} 0%, transparent 72%)`,
            filter: "blur(48px)",
          }}
          animate={{
            x: [0, 24, -16, 0],
            y: [0, -20, 12, 0],
            scale: [1, 1.04, 0.98, 1],
          }}
          transition={{
            duration: orb.duration,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}
