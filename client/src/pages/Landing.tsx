import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  GitFork,
  Star,
  Shield,
  Terminal,
  Puzzle,
  Sparkles,
} from "lucide-react";

const trustStatements = [
  { icon: Star, text: "Open source on GitHub" },
  { icon: Shield, text: "No subscription, ever" },
  { icon: GitFork, text: "Self-hostable in minutes" },
];

const steps = [
  {
    n: "01",
    title: "Paste a job link or description",
    body: "Drop in any URL or copy-paste the job text. Aethlara reads it the way a recruiter does.",
  },
  {
    n: "02",
    title: "AI tailors your resume",
    body: "Your uploaded resume is rewritten to match the role, with a 1–100 match score so you know where you stand before you apply.",
  },
  {
    n: "03",
    title: "Track every application",
    body: "Move applications through your Kanban board from first contact to offer — no spreadsheet required.",
  },
];

const features = [
  {
    title: "AI job extraction",
    body: "Paste a URL or raw description. Aethlara pulls out the role, requirements, and culture signals automatically — nothing to fill in manually.",
  },
  {
    title: "Tailored resume, scored",
    body: "Every job gets a version of your resume rewritten to fit it. A match score from 1–100 tells you whether it's worth applying at all.",
  },
  {
    title: "Kanban application board",
    body: "Track every role from applied to offer in a single board. See your full pipeline at a glance without opening a spreadsheet.",
  },
  {
    title: "Open source, your key",
    body: "The full codebase is public on GitHub. Run it yourself or use the hosted version with your own API key — no vendor lock-in.",
  },
];

export function Landing() {
  return (
    <div className="overflow-hidden">
      {/* Hero */}
      <section className="min-h-[calc(100vh-5rem)] flex flex-col items-center justify-center max-w-3xl mx-auto px-6 text-center">
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="font-heading font-semibold text-[2.75rem] leading-[1.05] tracking-[-0.03em] text-foreground md:text-6xl lg:text-[4rem] lg:leading-[1.02] mb-7"
        >
          Your resume, rebuilt{" "}
          <span className="text-gradient">for every job.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-muted-foreground text-lg leading-7 max-w-md mx-auto mb-12"
        >
          Paste a job link. Aethlara tailors your resume, scores your fit,
          and tracks the whole search.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.34 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Link to="/signup">
            <motion.span
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="btn-tf animate-btn-shine inline-flex items-center gap-3"
            >
              Get Started Free
              <ArrowRight className="w-4 h-4" />
            </motion.span>
          </Link>
          <Link to="/extension">
            <motion.span
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="btn-tf-secondary animate-btn-shine inline-flex items-center gap-2"
            >
              <Puzzle className="w-4 h-4" />
              Download Extension
            </motion.span>
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-6"
        >
          <Link
            to="/extension"
            className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-brand" />
            New: Chrome extension with one-click autofill
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </motion.div>
      </section>

      {/* Social proof bar */}
      <section className="border-y border-border bg-muted/40">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-8 sm:gap-16">
            {trustStatements.map(({ icon: Icon, text }, i) => (
              <motion.div
                key={text}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="flex items-center gap-2.5 text-muted-foreground"
              >
                <Icon className="w-4 h-4 text-brand shrink-0" />
                <span className="text-sm font-medium">{text}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="max-w-5xl mx-auto px-6 py-20 md:py-28">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-14"
        >
          <div className="heading-sub mb-4">How it works</div>
          <h2 className="font-heading text-3xl md:text-4xl font-semibold tracking-tight text-foreground max-w-md">
            Three steps. No fluff.
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
          {steps.map((step, i) => (
            <motion.div
              key={step.n}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.12, duration: 0.5 }}
              className="relative"
            >
              {i < steps.length - 1 && (
                <div className="hidden md:block absolute top-4 left-full w-full h-px bg-border -translate-y-0.5 ml-6 mr-6" style={{ width: "calc(100% - 3rem)" }} />
              )}
              <span className="font-heading text-4xl font-semibold text-brand/30 leading-none block mb-4">
                {step.n}
              </span>
              <h3 className="font-heading text-base font-semibold text-foreground mb-2">
                {step.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {step.body}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Feature highlights */}
      <section className="max-w-5xl mx-auto px-6 py-8 md:py-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-12"
        >
          <div className="heading-sub mb-4">What it does</div>
          <h2 className="font-heading text-3xl md:text-4xl font-semibold tracking-tight text-foreground max-w-lg">
            Four things done{" "}
            <span className="text-gradient">exceptionally well.</span>
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.5 }}
              className="glass-card p-7"
            >
              <h3 className="font-heading text-base font-semibold text-foreground mb-2">
                {f.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {f.body}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Open source callout */}
      <section className="max-w-5xl mx-auto px-6 py-20 md:py-28">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="glass-card p-10 md:p-16 relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-brand/[0.04] to-transparent pointer-events-none" />
          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            <div>
              <div className="heading-sub mb-5">Open source</div>
              <h2 className="font-heading text-2xl md:text-3xl font-semibold tracking-tight text-foreground mb-5">
                Yours to inspect, fork, and run.
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-4 text-sm">
                Aethlara is fully open source. Every line of code is public on
                GitHub — nothing is hidden, no black boxes. Use the hosted
                version free with your own API key, or self-host it on your
                infrastructure.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-8 text-sm">
                Your resume and job data never leave a server you don't
                control. Contributions, issues, and PRs are always welcome.
              </p>
              <a
                href="https://github.com/collinsadi/aethlara"
                target="_blank"
                rel="noopener noreferrer"
              >
                <motion.span
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="btn-tf animate-btn-shine inline-flex items-center gap-2"
                >
                  <Star className="w-4 h-4" />
                  Star on GitHub
                </motion.span>
              </a>
            </div>
            <div className="glass rounded-2xl bg-neutral-950 dark:bg-neutral-900 p-5 font-mono text-xs leading-6 overflow-x-auto">
              <p className="text-neutral-500 mb-1"># self-host in seconds</p>
              <p>
                <span className="text-brand">git</span>
                <span className="text-neutral-300"> clone https://github.com/collinsadi/aethlara</span>
              </p>
              <p>
                <span className="text-brand">cd</span>
                <span className="text-neutral-300"> aethlara</span>
              </p>
              <p>
                <span className="text-brand">cp</span>
                <span className="text-neutral-300"> .env.example .env</span>
              </p>
              <p className="mt-1 text-neutral-500"># add your API key, then:</p>
              <p>
                <span className="text-brand">docker</span>
                <span className="text-neutral-300"> compose up</span>
              </p>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Final CTA */}
      <section className="max-w-4xl mx-auto px-6 pb-24 md:pb-32">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="glass-card p-10 md:p-16 text-center relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-brand/[0.06] via-transparent to-transparent pointer-events-none" />
          <div className="relative z-10">
            <h2 className="font-heading text-3xl md:text-4xl font-semibold tracking-tight text-foreground mb-4">
              Stop applying blind.
            </h2>
            <p className="text-muted-foreground max-w-sm mx-auto mb-8 text-base leading-6">
              Know your match score before you write a single word.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/signup">
                <motion.span
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="btn-tf animate-btn-shine inline-flex items-center gap-3"
                >
                  Create Account
                  <ArrowRight className="w-4 h-4" />
                </motion.span>
              </Link>
              <a
                href="https://github.com/collinsadi/aethlara"
                target="_blank"
                rel="noopener noreferrer"
              >
                <motion.span
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="btn-tf-secondary animate-btn-shine inline-flex items-center gap-2"
                >
                  <Terminal className="w-4 h-4" />
                  Explore the Code
                </motion.span>
              </a>
            </div>
          </div>
        </motion.div>
      </section>
    </div>
  );
}
