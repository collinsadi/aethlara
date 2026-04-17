import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { Link } from "react-router-dom";

interface PricingCardProps {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  highlighted?: boolean;
  index?: number;
}

export function PricingCard({
  name,
  price,
  period,
  description,
  features,
  highlighted = false,
  index = 0,
}: PricingCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.6,
        delay: index * 0.15,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={{ y: -6, scale: 1.02 }}
      className={`relative glass-card p-8 flex flex-col ${
        highlighted ? "border-brand/35 shadow-lg shadow-brand/10" : ""
      }`}
    >
      {highlighted && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="px-4 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-brand text-white">
            Most Popular
          </span>
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-lg font-semibold text-foreground mb-1 font-heading">{name}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <div className="mb-6">
        <span className="text-4xl font-semibold text-foreground tracking-tight font-heading">
          {price}
        </span>
        <span className="text-sm text-muted-foreground ml-1">/{period}</span>
      </div>

      <ul className="space-y-3 mb-8 flex-1">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5">
            <div className="w-5 h-5 rounded-full bg-brand/10 flex items-center justify-center shrink-0 mt-0.5">
              <Check className="w-3 h-3 text-brand" />
            </div>
            <span className="text-sm text-muted-foreground">{feature}</span>
          </li>
        ))}
      </ul>

      <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
        <Link
          to="/signup"
          className={`flex w-full items-center justify-center text-center text-sm font-semibold py-3 rounded-full transition-all ${
            highlighted
              ? "btn-tf animate-btn-shine"
              : "btn-tf-secondary animate-btn-shine"
          }`}
        >
          Get Started
        </Link>
      </motion.div>
    </motion.div>
  );
}
