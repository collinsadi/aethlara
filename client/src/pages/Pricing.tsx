import { motion } from "framer-motion";
import { Check, Puzzle } from "lucide-react";
import { Link } from "react-router-dom";

const freeFeatures = [
  "Understand any job in seconds",
  "See how well you match the role",
  "Chat with AI about the position",
  "Save up to 5 jobs",
  "Basic job history",
];

const proFeatures = [
  "Everything in Free, unlimited",
  "One-click capture with Chrome Extension",
  "Priority AI — faster, deeper responses",
  "Unlimited saved jobs and history",
  "Export-ready application insights",
  "Early access to new features",
];

const faqs = [
  {
    q: "Can I cancel anytime?",
    a: "Yes. No contracts, no questions. Cancel any time and keep access until your billing period ends.",
  },
  {
    q: "What's included in the Chrome Extension?",
    a: "The extension lets you capture any job listing from LinkedIn, Indeed, or any job board without copying and pasting. It's a Pro-only feature.",
  },
  {
    q: "Is my data private?",
    a: "Completely. We use end-to-end encryption and never share your data with employers or third parties.",
  },
  {
    q: "What counts as a saved job?",
    a: "Each time you analyse a job and save it to your history, that's one saved job. Free accounts are limited to 5 at a time. Pro accounts are unlimited.",
  },
];

export function Pricing() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-16">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-16"
      >
        <div className="heading-sub mx-auto mb-6">Pricing</div>
        <h1 className="font-heading text-4xl md:text-5xl font-semibold text-foreground tracking-tight mb-4">
          Simple.{" "}
          <span className="text-gradient">No surprises.</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-md mx-auto">
          Start free. Upgrade when you&apos;re ready. Cancel any time.
        </p>
      </motion.div>

      {/* Pricing cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 max-w-3xl mx-auto">
        {/* Free */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="glass-card p-8 flex flex-col"
        >
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-foreground mb-1 font-heading">
              Free
            </h3>
            <p className="text-sm text-muted-foreground">
              Start exploring, no card required
            </p>
          </div>
          <div className="mb-8">
            <span className="text-4xl font-semibold text-foreground tracking-tight font-heading">
              $0
            </span>
            <span className="text-sm text-muted-foreground ml-1">forever</span>
          </div>
          <ul className="space-y-3 mb-8 flex-1">
            {freeFeatures.map((f) => (
              <li key={f} className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center shrink-0 mt-0.5">
                  <Check className="w-3 h-3 text-neutral-700 dark:text-neutral-300" />
                </div>
                <span className="text-sm text-muted-foreground">{f}</span>
              </li>
            ))}
          </ul>
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Link
              to="/signup"
              className="btn-tf-secondary animate-btn-shine flex w-full items-center justify-center text-sm font-semibold py-3 rounded-full"
            >
              Get started free
            </Link>
          </motion.div>
        </motion.div>

        {/* Pro */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
          className="relative glass-card p-8 flex flex-col border-brand/35 shadow-lg shadow-brand/10"
        >
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <span className="px-4 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-brand text-white">
              Most popular
            </span>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-semibold text-foreground mb-1 font-heading">
              Pro
            </h3>
            <p className="text-sm text-muted-foreground">
              For active job seekers
            </p>
          </div>
          <div className="mb-8">
            <span className="text-4xl font-semibold text-foreground tracking-tight font-heading">
              $10
            </span>
            <span className="text-sm text-muted-foreground ml-1">/month</span>
          </div>
          <ul className="space-y-3 mb-6 flex-1">
            {proFeatures.map((f) => (
              <li key={f} className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-brand/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Check className="w-3 h-3 text-brand" />
                </div>
                <span className="text-sm text-muted-foreground">{f}</span>
              </li>
            ))}
          </ul>

          {/* Chrome Extension callout */}
          <div className="flex items-center gap-2 mb-6 p-3 rounded-xl bg-brand/5 border border-brand/15">
            <Puzzle className="w-4 h-4 text-brand shrink-0" />
            <span className="text-xs text-muted-foreground">
              Includes Chrome Extension for one-click job capture
            </span>
          </div>

          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Link
              to="/signup"
              className="btn-tf animate-btn-shine flex w-full items-center justify-center text-sm font-semibold py-3 rounded-full"
            >
              Start with Pro
            </Link>
          </motion.div>
        </motion.div>
      </div>

      {/* FAQ */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="max-w-2xl mx-auto mt-20"
      >
        <h2 className="text-2xl font-semibold text-foreground text-center mb-10 font-heading">
          Common questions
        </h2>
        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <motion.div
              key={faq.q}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="glass-card p-5"
            >
              <h3 className="text-sm font-semibold text-foreground mb-2 font-heading">
                {faq.q}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {faq.a}
              </p>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
