import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";

export function ResumeMismatch() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="max-w-3xl mx-auto px-6 py-12 md:py-16">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
        <p className="text-sm font-medium text-brand mb-3">Resume Alignment</p>
        <h1 className="font-heading text-4xl font-semibold tracking-tight text-foreground mb-4">
          Why You Got a Mismatch
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed">
          It&apos;s not always a real mismatch — sometimes your resume just isn&apos;t telling the full story.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="space-y-10"
      >
        {/* What is a mismatch */}
        <section>
          <h2 className="font-heading text-2xl font-semibold text-foreground mb-4">What Is a Mismatch?</h2>
          <div className="space-y-4 text-muted-foreground leading-relaxed">
            <p>
              When you add a job, Aethlara compares the job&apos;s requirements against the skills, experience, and
              background in your resume. It looks for overlap across technical skills, years of experience, and
              education requirements.
            </p>
            <p>
              When the overlap is too low — below 40% — the job is not saved. Generating a tailored resume for a
              fundamentally incompatible role would produce misleading output and waste your time. This is quality
              control, not rejection.
            </p>
            <p>
              The match score and gap analysis give you an honest signal about where you stand — and exactly what to
              work on if you want to change that.
            </p>
          </div>
        </section>

        {/* Two causes */}
        <section>
          <h2 className="font-heading text-2xl font-semibold text-foreground mb-6">
            The Two Most Common Causes
          </h2>

          <div className="space-y-6">
            <div className="border border-border rounded-xl p-6">
              <h3 className="font-heading text-lg font-semibold text-foreground mb-3">
                1. Your resume doesn&apos;t reflect everything you know
              </h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                This is the most common reason — and the easiest to fix. Resumes are often conservative. People leave
                out skills they consider &ldquo;obvious&rdquo;, tools they used briefly, or technologies they learned on the
                side. Aethlara&apos;s AI can only work with what&apos;s written in your resume. If a skill isn&apos;t there, it
                doesn&apos;t count — even if you have it.
              </p>
              <p className="text-sm font-semibold text-foreground mb-2">What to check:</p>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand mt-1.5 shrink-0" />
                  Did you list all the programming languages or tools you know?
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand mt-1.5 shrink-0" />
                  Did you include side projects, freelance work, or open source contributions?
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand mt-1.5 shrink-0" />
                  Did you mention domain knowledge relevant to the industry (e.g. fintech, healthcare)?
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand mt-1.5 shrink-0" />
                  Did you describe your responsibilities in detail, or just job titles?
                </li>
              </ul>
              <p className="text-sm text-muted-foreground mt-4">
                If the answer to any of these is no: update your resume, re-upload it, and try the job again.
              </p>
            </div>

            <div className="border border-border rounded-xl p-6">
              <h3 className="font-heading text-lg font-semibold text-foreground mb-3">
                2. It&apos;s a genuine mismatch
              </h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Sometimes the job really does require skills or experience you don&apos;t have yet. This is not a failure —
                it is useful information. Applying to jobs where the core requirements are significantly outside your
                background leads to low callback rates and wasted effort.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                The match score and gap analysis show you exactly what&apos;s missing. This is the clearest signal you can
                get about what to learn next.
              </p>
            </div>
          </div>
        </section>

        {/* How to fix it */}
        <section>
          <h2 className="font-heading text-2xl font-semibold text-foreground mb-4">How to Fix It</h2>
          <ul className="space-y-3 text-muted-foreground">
            {[
              "Update your resume: add skills, tools, projects, and domain experience you may have omitted.",
              'Be specific: "Built REST APIs in Go" is stronger than "Backend development".',
              "Include the technologies, not just the outcomes.",
              "Re-upload your updated resume and try the job again.",
              "If the gaps are real: use the gap list as a learning roadmap.",
            ].map((item) => (
              <li key={item} className="flex items-start gap-3">
                <span className="w-2 h-2 rounded-full bg-brand mt-1.5 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* How scoring works */}
        <section>
          <h2 className="font-heading text-2xl font-semibold text-foreground mb-4">How Match Scoring Works</h2>
          <p className="text-muted-foreground leading-relaxed">
            Aethlara scores your match across three dimensions: skills overlap, experience level alignment, and
            education requirements. These are weighted and averaged into a single overall score. The threshold is 40%
            — below this, the gap between the job&apos;s requirements and your resume is too large for AI to generate a
            credible, honest tailored resume. The score is not inflated to make you feel good.
          </p>
        </section>

        {/* FAQ */}
        <section>
          <h2 className="font-heading text-2xl font-semibold text-foreground mb-6">Frequently Asked Questions</h2>
          <div className="space-y-6">
            {faqs.map((faq) => (
              <div key={faq.q} className="border-b border-border pb-6 last:border-0 last:pb-0">
                <h3 className="font-semibold text-foreground mb-2">{faq.q}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="pt-4 pb-8">
          {isAuthenticated ? (
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => navigate("/resumes")}
                className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-brand text-white text-sm font-semibold hover:opacity-85 transition-opacity"
              >
                Update My Resume
              </button>
              <button
                onClick={() => navigate("/jobs")}
                className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-border text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors"
              >
                Back to Jobs
              </button>
            </div>
          ) : (
            <Link
              to="/signup"
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-brand text-white text-sm font-semibold hover:opacity-85 transition-opacity"
            >
              Get Started
            </Link>
          )}
        </section>
      </motion.div>
    </div>
  );
}

const faqs = [
  {
    q: "Can I still apply to a job that was flagged as a mismatch?",
    a: "Yes. The job won't be saved in Aethlara, but nothing stops you from applying directly. Aethlara just won't be able to help you tailor your application for it.",
  },
  {
    q: "My resume is strong — why did I get a low score?",
    a: "The most likely reason is that your resume doesn't explicitly mention the skills the job requires. Update your resume to include them and try again.",
  },
  {
    q: "The job is a stretch role — should I still apply?",
    a: "That's your call. Aethlara's job is to give you an honest signal, not to make the decision for you. If you believe you can do the role, apply directly — just know the tailored resume feature won't be available.",
  },
  {
    q: "What is the minimum match score?",
    a: "40%. Below this, the gap between the job's requirements and your resume is too large for AI to generate a credible, honest tailored resume.",
  },
];
