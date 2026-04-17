import { motion } from "framer-motion";
import { Link } from "react-router-dom";

const LAST_UPDATED = "April 17, 2026";

const toc = [
  { id: "acceptance", label: "Acceptance of Terms" },
  { id: "what-it-is", label: "What Aethlara Is" },
  { id: "your-account", label: "Your Account" },
  { id: "acceptable-use", label: "Acceptable Use" },
  { id: "your-content", label: "Your Content" },
  { id: "open-source", label: "Open Source Distinction" },
  { id: "ai-outputs", label: "AI Outputs" },
  { id: "byok", label: "Bring Your Own Key" },
  { id: "liability", label: "Limitation of Liability" },
  { id: "termination", label: "Termination" },
  { id: "changes", label: "Changes to Terms" },
  { id: "contact", label: "Contact" },
];

export function Terms() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12 md:py-16">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-10"
      >
        <h1 className="font-heading text-4xl font-semibold tracking-tight text-foreground mb-3">
          Terms of Service
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
        className="space-y-12"
      >
        <section id="acceptance">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            1. Acceptance of Terms
          </h2>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              By creating an account or using Aethlara, you agree to these
              Terms of Service. If you don't agree, don't use the service.
            </p>
            <p>
              You must be 18 years of age or older to use Aethlara.
            </p>
          </div>
        </section>

        <section id="what-it-is">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            2. What Aethlara Is
          </h2>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              Aethlara is an AI-assisted job application tool. It helps you
              tailor your resume to job postings, score your fit, and track your
              applications.
            </p>
            <p>
              Aethlara is not a recruitment agency, not a job board, and not a
              career counselling service. It does not guarantee job placement,
              interview callbacks, or any employment outcome.
            </p>
          </div>
        </section>

        <section id="your-account">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            3. Your Account
          </h2>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              You are responsible for maintaining the security of your account.
              Aethlara uses OTP-based authentication — you are responsible for
              access to the email address associated with your account.
            </p>
            <p>
              One account per person. Creating multiple accounts to circumvent
              any limits is not permitted.
            </p>
          </div>
        </section>

        <section id="acceptable-use">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            4. Acceptable Use
          </h2>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>You agree not to:</p>
            <ul className="list-disc list-inside space-y-2 pl-1">
              <li>
                Use Aethlara to generate resumes that misrepresent your
                qualifications, credentials, or experience. The AI tailors your
                honest experience — you must not instruct it otherwise.
              </li>
              <li>
                Abuse the job scraper through bulk requests, SSRF probing, or
                automated mass-submission.
              </li>
              <li>
                Reverse-engineer, scrape, or abuse the Aethlara API.
              </li>
              <li>
                Attempt to gain unauthorized access to other users' data or
                Aethlara's infrastructure.
              </li>
            </ul>
          </div>
        </section>

        <section id="your-content">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            5. Your Content
          </h2>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              You own your resume content, job data, and any outputs generated
              by Aethlara on your behalf.
            </p>
            <p>
              By using Aethlara, you grant us a limited, non-exclusive licence
              to process your content solely to provide the service. We do not
              claim ownership of your resume or any AI-generated outputs.
            </p>
          </div>
        </section>

        <section id="open-source">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            6. Open Source Distinction
          </h2>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              The Aethlara codebase is open source and governed by its own
              licence (see the{" "}
              <a
                href="https://github.com/collinsadi/aethlara"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:text-brand transition-colors underline underline-offset-2"
              >
                GitHub repository
              </a>{" "}
              for the applicable licence terms).
            </p>
            <p>
              These Terms of Service apply only to the hosted version of
              Aethlara at the platform domain. If you self-host the software,
              your use is governed by the open source licence, not these terms.
            </p>
          </div>
        </section>

        <section id="ai-outputs">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            7. AI Outputs
          </h2>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              AI-generated resume content is a starting point, not a finished
              product. You are responsible for reviewing all generated content
              before submitting it to employers.
            </p>
            <p>
              Aethlara is not liable for any outcome — including rejection,
              mis-hiring, or reputational harm — resulting from your use of
              AI-generated content.
            </p>
          </div>
        </section>

        <section id="byok">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            8. Bring Your Own Key
          </h2>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              You may provide your own API key for AI processing. Your key is
              used for the duration of a request and is not stored beyond the
              active session.
            </p>
            <p>
              You are responsible for all usage and associated costs incurred
              through your API key. Aethlara is not liable for unexpected charges
              from your AI provider.
            </p>
          </div>
        </section>

        <section id="liability">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            9. Limitation of Liability
          </h2>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              Aethlara is provided as-is, without warranty of any kind. We do
              not guarantee that the service will be uninterrupted, error-free,
              or suitable for any particular purpose.
            </p>
            <p>
              To the maximum extent permitted by law, Aethlara's liability to
              you for any claim arising from your use of the service is limited
              to the amount you paid us in the 12 months preceding the claim —
              which, since the service is free, is zero.
            </p>
          </div>
        </section>

        <section id="termination">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            10. Termination
          </h2>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              You can delete your account at any time from your account settings.
              Deletion removes your data in accordance with the Privacy Policy.
            </p>
            <p>
              Aethlara reserves the right to suspend or terminate accounts that
              violate these Terms, with or without notice depending on the
              severity of the violation.
            </p>
          </div>
        </section>

        <section id="changes">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            11. Changes to Terms
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            We may update these terms from time to time. When we do, we'll
            update the "Last updated" date above and notify registered users by
            email for material changes. Continued use of the service after a
            change constitutes your acceptance.
          </p>
        </section>

        <section id="contact">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            12. Contact
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Questions about these terms? Reach us through the{" "}
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
