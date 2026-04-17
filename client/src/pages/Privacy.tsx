import { motion } from "framer-motion";
import { Link } from "react-router-dom";

const LAST_UPDATED = "April 17, 2026";

const toc = [
  { id: "what-we-collect", label: "What We Collect" },
  { id: "how-we-use", label: "How We Use Your Data" },
  { id: "ai-processing", label: "AI Processing" },
  { id: "data-storage", label: "Data Storage" },
  { id: "your-rights", label: "Your Rights" },
  { id: "cookies", label: "Cookies" },
  { id: "changes", label: "Changes to This Policy" },
  { id: "contact", label: "Contact" },
];

export function Privacy() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12 md:py-16">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-10"
      >
        <h1 className="font-heading text-4xl font-semibold tracking-tight text-foreground mb-3">
          Privacy Policy
        </h1>
        <p className="text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
      </motion.div>

      {/* Table of contents */}
      <motion.nav
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-card p-6 mb-12"
        aria-label="Table of contents"
      >
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Contents
        </p>
        <ol className="space-y-2">
          {toc.map((item, i) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className="text-sm text-foreground hover:text-brand transition-colors"
              >
                {i + 1}. {item.label}
              </a>
            </li>
          ))}
        </ol>
      </motion.nav>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="prose-custom space-y-12"
      >
        <section id="what-we-collect">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            1. What We Collect
          </h2>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              <strong className="text-foreground">Account information:</strong>{" "}
              Your name and email address, collected when you create an account.
            </p>
            <p>
              <strong className="text-foreground">Resume content:</strong>{" "}
              The resume file you upload and any AI-extracted version of it. This
              is stored server-side and never exposed to the frontend in raw form.
            </p>
            <p>
              <strong className="text-foreground">Job data:</strong>{" "}
              URLs you submit, job description text you paste, the structured
              job data extracted from those inputs, and the tailored resume output.
              All of this is stored server-side only.
            </p>
            <p>
              <strong className="text-foreground">Usage data:</strong>{" "}
              Basic page visit and feature usage data, if analytics are active.
              We do not use third-party advertising analytics.
            </p>
            <p>
              <strong className="text-foreground">What we do not collect:</strong>{" "}
              Payment information (there is no paid plan), government IDs,
              financial data, or any information beyond what is listed above.
            </p>
          </div>
        </section>

        <section id="how-we-use">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            2. How We Use Your Data
          </h2>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              We use your data to provide the service: tailoring resumes, scoring
              job fits, and maintaining your application tracker.
            </p>
            <p>
              We use your email address to send transactional messages — your
              one-time login code (OTP) and relevant account notifications. We do
              not send unsolicited marketing emails.
            </p>
            <p>
              Your data is never sold. It is never shared with advertisers. It is
              never used to build profiles for targeting.
            </p>
          </div>
        </section>

        <section id="ai-processing">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            3. AI Processing
          </h2>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              To generate tailored resumes and match scores, your resume content
              and job description are sent to a third-party AI provider
              (OpenRouter). This transmission is necessary to provide the core
              service.
            </p>
            <p>
              Raw resume and job text is not logged beyond what is needed to
              return the AI response. We do not retain your content on the AI
              provider's infrastructure.
            </p>
            <p>
              <strong className="text-foreground">
                If you use your own API key:
              </strong>{" "}
              Your key is used for the duration of the request and not stored
              beyond the active session. The AI provider's own privacy policy
              governs how they process your request.
            </p>
          </div>
        </section>

        <section id="data-storage">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            4. Data Storage
          </h2>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              Resume files are stored in Cloudflare R2 object storage. Structured
              data — accounts, jobs, application status, match scores — is stored
              in a PostgreSQL database.
            </p>
            <p>
              Data is retained for as long as your account is active. When you
              delete your account, your data is soft-deleted immediately and
              purged from our systems within 30 days.
            </p>
          </div>
        </section>

        <section id="your-rights">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            5. Your Rights
          </h2>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              <strong className="text-foreground">Access:</strong>{" "}
              You can view all your stored data through the application at any
              time.
            </p>
            <p>
              <strong className="text-foreground">Deletion:</strong>{" "}
              You can delete your account and all associated data from your
              account settings. Deletion is immediate and irreversible.
            </p>
            <p>
              <strong className="text-foreground">Export:</strong>{" "}
              If data export is available in your account, you can download your
              resume content and job data at any time.
            </p>
            <p>
              To exercise any of these rights or to ask a question, contact us
              via the{" "}
              <Link to="/contact" className="text-foreground hover:text-brand transition-colors underline underline-offset-2">
                contact page
              </Link>
              .
            </p>
          </div>
        </section>

        <section id="cookies">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            6. Cookies
          </h2>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              Aethlara uses session cookies only. Specifically:
            </p>
            <ul className="list-disc list-inside space-y-2 pl-1">
              <li>
                <code className="text-foreground text-xs bg-muted px-1.5 py-0.5 rounded">__rt</code>{" "}
                — refresh token cookie, used to maintain your login session.
              </li>
              <li>
                <code className="text-foreground text-xs bg-muted px-1.5 py-0.5 rounded">__sf</code>{" "}
                — session fingerprint cookie, used to verify request integrity.
              </li>
            </ul>
            <p>
              There are no advertising cookies. There are no third-party tracking
              cookies. No analytics cookies are set without disclosure.
            </p>
          </div>
        </section>

        <section id="changes">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            7. Changes to This Policy
          </h2>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              If we make material changes to this policy, we will update the "Last
              updated" date at the top of this page and notify users by email.
              Continued use of Aethlara after a change constitutes acceptance of
              the updated policy.
            </p>
          </div>
        </section>

        <section id="contact">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            8. Contact
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Privacy questions? Reach us through the{" "}
            <Link
              to="/contact"
              className="text-foreground hover:text-brand transition-colors underline underline-offset-2"
            >
              contact page
            </Link>
            .
          </p>
        </section>
      </motion.div>
    </div>
  );
}
