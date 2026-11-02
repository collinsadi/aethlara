import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  GitFork,
  KeyRound,
  Star,
  Shield,
  Terminal,
  Puzzle,
  Sparkles,
} from "lucide-react";

const trustStatements = [
  { icon: Star, text: "Open source on GitHub" },
  { icon: KeyRound, text: "Your own Anthropic or OpenRouter key" },
  { icon: Shield, text: "No subscription, ever" },
  { icon: GitFork, text: "Self-hostable in minutes" },
];

const steps = [
  {
    n: "01",
    title: "Tell it what you want, once",
    body: "Upload your resume and set your titles, locations, salary floor and deal-breakers. That's the whole setup.",
  },
  {
    n: "02",
    title: "It finds and scores jobs",
    body: "Every run searches company boards and job boards, then scores each posting against your resume — 0 to 100, with strengths and gaps.",
  },
  {
    n: "03",
    title: "You approve, it applies",
    body: "Approve the good ones in seconds. The next run emails your tailored resume, or the Chrome extension fills and submits the form.",
  },
  {
    n: "04",
    title: "Replies, sorted and tracked",
    body: "Replies land in your agent's own mailbox. AI sorts them and moves your tracker: applied, interview, offer — or rejected.",
  },
];

const features = [
  {
    title: "Searches the boards for you",
    body: "Greenhouse, Lever and Ashby boards for the companies on your watchlist, plus Remotive, Remote OK, Himalayas, Jobicy and Arbeitnow. With an Anthropic key, Claude searches the web too.",
  },
  {
    title: "Scored against your resume",
    body: "Every posting gets a match score with the reasons behind it — and deal-breakers are filtered out — so you only spend time on roles worth it.",
  },
  {
    title: "You approve. It applies.",
    body: "Nothing goes out without your OK (unless you opt in to auto-approve strong matches). Email applications are sent from your agent mailbox; forms are filled and submitted by the extension.",
  },
  {
    title: "Tailored resume and cover letter",
    body: "Each application gets a version of your resume rewritten for the role and a short cover letter. Questions only you can answer, it asks once and remembers.",
  },
  {
    title: "Its own inbox, sorted by AI",
    body: "Confirmations, rejections, interviews and offers are triaged automatically and update your Kanban tracker. Verification codes are picked up for you.",
  },
  {
    title: "Open source, your key",
    body: "Bring your own Anthropic or OpenRouter key — there's no platform key and no subscription. Use the hosted version or self-host the whole thing.",
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
          Your job search,{" "}
          <span className="text-gradient">on autopilot.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-muted-foreground text-lg leading-7 max-w-lg mx-auto mb-12"
        >
          Aethlara finds jobs that fit your resume. You approve the good ones;
          it applies, sorts the replies and keeps your tracker current.
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
          <a
            href="#how-it-works"
            className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-brand" />
            New: Autopilot — it searches, applies and follows up for you
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </motion.div>
      </section>

      {/* Social proof bar */}
      <section className="border-y border-border bg-muted/40">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex flex-col sm:flex-row sm:flex-wrap items-center justify-center gap-6 sm:gap-x-12 sm:gap-y-4">
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
          <h2 className="font-heading text-3xl md:text-4xl font-semibold tracking-tight text-foreground max-w-xl">
            Set it up once. It does the rest.
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10">
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
                <div className="hidden lg:block absolute top-4 left-full w-full h-px bg-border -translate-y-0.5 ml-6 mr-6" style={{ width: "calc(100% - 3rem)" }} />
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
            Everything a job search needs,{" "}
            <span className="text-gradient">done for you.</span>
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
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
                version free with your own Anthropic or OpenRouter key, or
                self-host it on your infrastructure.
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
              <p className="mt-1 text-neutral-500"># fill in .env, then:</p>
              <p>
                <span className="text-brand">docker</span>
                <span className="text-neutral-300"> compose up</span>
              </p>
              <p className="mt-1 text-neutral-500"># add your AI key in Settings — no server key needed</p>
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
              Stop applying by hand.
            </h2>
            <p className="text-muted-foreground max-w-md mx-auto mb-8 text-base leading-6">
              The agent finds the jobs, applies and follows up. You just say yes
              to the ones worth it.
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
