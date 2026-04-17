import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

export function About() {
  return (
    <div className="overflow-hidden">
      {/* Opening statement */}
      <section className="max-w-3xl mx-auto px-6 pt-8 pb-16 md:pt-12 md:pb-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h1 className="font-heading text-4xl md:text-5xl font-semibold tracking-tight text-foreground mb-8">
            Generic resumes get generic results.
          </h1>

          <div className="space-y-5 text-muted-foreground leading-relaxed">
            <p className="text-lg">
              Most job seekers send the same resume to every opening and wait.
              When nothing comes back, they tweak the font size or swap a few
              adjectives — and send it again. The problem isn't effort. The
              problem is that a resume written for nobody is selected by nobody.
            </p>
            <p>
              Every job is different. The requirements are different, the
              priorities are different, the language a recruiter responds to is
              different. A resume that worked for one role is probably wrong for
              the next one. Most people know this. Almost nobody has the time to
              act on it.
            </p>
            <p>
              Aethlara was built to close that gap. Paste a job link. Upload
              your resume. The AI reads the job the way a recruiter does —
              looking for fit signals, keyword alignment, experience depth — and
              rewrites your resume to match it. You get a tailored draft in
              seconds, with a match score so you know whether it's worth applying
              before you spend an hour on a cover letter.
            </p>
          </div>
        </motion.div>
      </section>

      {/* What Aethlara does */}
      <section className="max-w-3xl mx-auto px-6 py-12 md:py-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="glass-card p-10 md:p-14 relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-brand/[0.03] to-transparent pointer-events-none" />
          <div className="relative z-10">
            <div className="heading-sub mb-6">How it works</div>

            <div className="space-y-8">
              <div>
                <h3 className="font-heading text-base font-semibold text-foreground mb-2">
                  Job intake
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  You paste a URL or drop in the raw job description text.
                  Aethlara extracts the structured details — role title, company,
                  location, requirements, responsibilities, and the signals
                  between the lines that tell you what the team actually values.
                </p>
              </div>

              <div>
                <h3 className="font-heading text-base font-semibold text-foreground mb-2">
                  Resume alignment
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Your uploaded resume is compared against the extracted job
                  data. The AI rewrites it to highlight what's relevant,
                  reframe what fits, and surface the experience that matches
                  what this specific role is looking for. The result is a
                  tailored draft and a match score from 1 to 100.
                </p>
              </div>

              <div>
                <h3 className="font-heading text-base font-semibold text-foreground mb-2">
                  Application tracking
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Every job you add gets a card on a Kanban board. Move it
                  through stages — applied, interviewing, offer, rejected — and
                  see your full pipeline at once. No spreadsheets, no lost
                  threads.
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Open source commitment */}
      <section className="max-w-3xl mx-auto px-6 py-12 md:py-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <div className="heading-sub mb-6">Open source</div>
          <h2 className="font-heading text-2xl md:text-3xl font-semibold tracking-tight text-foreground mb-6">
            Built in the open.
          </h2>

          <div className="space-y-4 text-muted-foreground leading-relaxed">
            <p>
              Aethlara is fully open source under an MIT licence. The full
              codebase is public at{" "}
              <a
                href="https://github.com/collinsadi/aethlara"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:text-brand transition-colors underline underline-offset-2"
              >
                github.com/collinsadi/aethlara
              </a>
              . Nothing is hidden. If you want to understand how something
              works, you can read it.
            </p>
            <p>
              The hosted version is free to use with your own API key. You
              bring the key; we run the infrastructure. Your resume content and
              job data are processed on your behalf and not used to train
              models, sold, or shared. If you'd rather not trust anyone with
              your data, self-hosting takes a few minutes.
            </p>
            <p>
              "Bring your own key" wasn't a compromise — it was a deliberate
              choice. It keeps costs honest, eliminates per-seat pricing, and
              means the tool works for a student with a free-tier API key just
              as well as it does for a senior engineer at a startup.
            </p>
          </div>
        </motion.div>
      </section>

      {/* Closing */}
      <section className="max-w-3xl mx-auto px-6 py-16 md:py-24">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="glass-card p-10 md:p-14"
        >
          <p className="text-base text-muted-foreground leading-relaxed mb-8 max-w-xl">
            Aethlara is a tool, not a silver bullet. Getting a job is hard —
            relationships, timing, luck all play a part. This is just one less
            thing that should be standing in your way.
          </p>
          <Link to="/signup">
            <motion.span
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="btn-tf animate-btn-shine inline-flex items-center gap-3"
            >
              Get Started
              <ArrowRight className="w-4 h-4" />
            </motion.span>
          </Link>
        </motion.div>
      </section>
    </div>
  );
}
