import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Code2,
  Download,
  FileArchive,
  Sparkles,
  Wand2,
  Search,
  ShieldCheck,
  Zap,
  ScanLine,
  ClipboardCheck,
  Boxes,
  Lock,
  Layers,
} from "lucide-react";

const EXTENSION_FILE = "aethlara-extension-v1.zip";
const EXTENSION_URL = `/downloadable/${EXTENSION_FILE}`;
const EXTENSION_SIZE = "~125 KB";
const EXTENSION_GITHUB =
  "https://github.com/collinsadi/aethlara/tree/main/extension";

const zipContents = [
  "manifest.json",
  "background/index.js",
  "content/index.js",
  "popup (HTML, JS, CSS)",
  "icons/",
];

const features = [
  {
    icon: Wand2,
    title: "Autofill any application",
    body: "Open a job application page, click Autofill, and the extension fills every form field on the page using AI and your tailored resume context.",
    badge: "Beta",
    highlight: true,
  },
  {
    icon: ScanLine,
    title: "One-click job extraction",
    body: "Browsing LinkedIn, Indeed, or any company careers page? Extract the full posting and see your match score before saving it to your dashboard.",
  },
  {
    icon: ClipboardCheck,
    title: "Save jobs as you browse",
    body: "Find a role that fits while you're already on the page. Save it to your tracker in one click — no copy, no paste, no tab juggling.",
  },
  {
    icon: ShieldCheck,
    title: "Secure handshake auth",
    body: "Connects to your Aethlara account via a one-time, 60-second handshake token. No passwords or refresh tokens ever live in the extension.",
  },
  {
    icon: Lock,
    title: "Scoped permissions",
    body: "Only acts on the active tab when you click. Host permissions are scoped to the Aethlara API domain — never <all_urls>.",
  },
  {
    icon: Zap,
    title: "Built for the flow",
    body: "Designed to disappear into your job search. The fewer clicks between you and a tailored application, the better.",
  },
];

const useCases = [
  {
    icon: Search,
    title: "Browsing job boards",
    body: "On LinkedIn, Wellfound, Indeed, or a company careers page — extract the role inline and instantly see whether it matches your resume before you commit time to applying.",
  },
  {
    icon: Boxes,
    title: "Saving for later",
    body: "Spotted three roles worth applying to but no time right now? Capture each one to your tracker in a click and come back when you're ready to tailor and apply.",
  },
  {
    icon: Layers,
    title: "Filling long applications",
    body: "Workday, Greenhouse, Lever, Ashby — point-and-click autofill for the multi-page application forms that usually eat your afternoon.",
  },
];

export function Extension() {
  const navigate = useNavigate();

  const handleDownload = () => {
    // Trigger the file download programmatically.
    const link = document.createElement("a");
    link.href = EXTENSION_URL;
    link.download = EXTENSION_FILE;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Send the user to the install guide so they know what to do next.
    navigate("/extension/install");
  };

  return (
    <div className="overflow-hidden">
      {/* Hero — file highlight */}
      <section className="max-w-5xl mx-auto px-6 pt-4 pb-16 md:pt-8 md:pb-20">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          {/* <div className="heading-sub mb-4">Chrome Extension</div> */}
          <h1 className="font-heading text-4xl md:text-5xl lg:text-[3.25rem] font-semibold tracking-tight text-foreground mb-5 leading-[1.05]">
            Your job search,{" "}
            <span className="text-gradient">one click away.</span>
          </h1>
          <p className="text-muted-foreground text-base md:text-lg max-w-xl mx-auto leading-relaxed">
            Extract jobs and autofill applications on any page you browse —
            without leaving the tab.
          </p>
        </motion.div>

        {/* File card */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.1 }}
          className="glass-card p-6 md:p-10 relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-brand/[0.06] via-transparent to-transparent pointer-events-none" />

          <div className="relative z-10 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-8 items-center">
            {/* Cool icon */}
            <div className="flex justify-center md:justify-start">
              <div className="relative">
                <div className="absolute inset-0 bg-brand/20 blur-2xl rounded-full" />
                <div className="relative w-28 h-28 md:w-32 md:h-32 rounded-3xl bg-gradient-to-br from-brand/15 to-brand/5 border border-brand/30 flex items-center justify-center shadow-lg">
                  <FileArchive
                    className="w-14 h-14 md:w-16 md:h-16 text-brand"
                    strokeWidth={1.5}
                  />
                  <div className="absolute -top-2 -right-2 bg-brand text-white text-[10px] font-mono font-semibold px-2 py-1 rounded-full shadow-md">
                    .ZIP
                  </div>
                </div>
              </div>
            </div>

            {/* Metadata */}
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <Sparkles className="w-3 h-3" />
                  Latest release
                </span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full bg-muted text-muted-foreground border border-border">
                  v1.0.0
                </span>
              </div>

              <h2 className="font-mono text-lg md:text-xl font-semibold text-foreground mb-1 break-all">
                {EXTENSION_FILE}
              </h2>
              <p className="text-sm text-muted-foreground mb-5">
                ZIP archive · {EXTENSION_SIZE} · Chromium-based browsers
                (Chrome, Brave, Edge, Arc)
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mb-6 text-sm">
                <div>
                  <span className="text-muted-foreground">Format: </span>
                  <span className="text-foreground font-medium">
                    Unpacked extension (.zip)
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Manifest: </span>
                  <span className="text-foreground font-medium">v3</span>
                </div>
              </div>

              <div className="mb-7">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                  Contents
                </div>
                <div className="flex flex-wrap gap-2">
                  {zipContents.map((file) => (
                    <span
                      key={file}
                      className="inline-block font-mono text-[11px] px-2 py-1 rounded-md bg-muted/60 text-foreground border border-border"
                    >
                      {file}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleDownload}
                  className="btn-tf animate-btn-shine inline-flex items-center justify-center gap-2"
                  type="button"
                >
                  <Download className="w-4 h-4" />
                  Download Extension
                </motion.button>
                <a
                  href={EXTENSION_GITHUB}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <motion.span
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="btn-tf-secondary animate-btn-shine inline-flex items-center justify-center gap-2 w-full"
                  >
                    <Code2 className="w-4 h-4" />
                    View on GitHub
                  </motion.span>
                </a>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* What it does */}
      <section className="max-w-5xl mx-auto px-6 py-12 md:py-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-12"
        >
          <div className="heading-sub mb-4">What it does</div>
          <h2 className="font-heading text-3xl md:text-4xl font-semibold tracking-tight text-foreground max-w-2xl">
            Built for the moment you're{" "}
            <span className="text-gradient">already browsing.</span>
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06, duration: 0.45 }}
                className={`glass-card p-7 relative ${
                  f.highlight
                    ? "ring-1 ring-brand/40 shadow-[0_0_0_4px_rgba(0,0,0,0)]"
                    : ""
                }`}
              >
                {f.highlight && (
                  <div className="absolute -top-3 right-6">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-brand text-white shadow-md">
                      <Sparkles className="w-3 h-3" />
                      {f.badge}
                    </span>
                  </div>
                )}
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${
                    f.highlight
                      ? "bg-brand/15 text-brand"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-heading text-base font-semibold text-foreground mb-2">
                  {f.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {f.body}
                </p>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Use cases */}
      <section className="max-w-5xl mx-auto px-6 py-12 md:py-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-12"
        >
          <div className="heading-sub mb-4">Built for</div>
          <h2 className="font-heading text-3xl md:text-4xl font-semibold tracking-tight text-foreground max-w-xl">
            Easier job capture, on any site.
          </h2>
          <p className="text-muted-foreground mt-4 max-w-2xl text-sm md:text-base leading-relaxed">
            The extension exists for one reason: when you're browsing a job
            site and find a role you might apply to, you should be able to
            check fit and save it without breaking flow. Here's where it earns
            its keep.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {useCases.map((u, i) => {
            const Icon = u.icon;
            return (
              <motion.div
                key={u.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.45 }}
                className="glass-card p-7"
              >
                <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-heading text-base font-semibold text-foreground mb-2">
                  {u.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {u.body}
                </p>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-4xl mx-auto px-6 pb-24 md:pb-32 pt-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="glass-card p-10 md:p-14 text-center relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-brand/[0.06] via-transparent to-transparent pointer-events-none" />
          <div className="relative z-10">
            <h2 className="font-heading text-3xl md:text-4xl font-semibold tracking-tight text-foreground mb-4">
              Ready to install?
            </h2>
            <p className="text-muted-foreground max-w-md mx-auto mb-8 text-base leading-6">
              Download the ZIP and we'll walk you through loading it in your
              browser — takes about 60 seconds.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleDownload}
                className="btn-tf animate-btn-shine inline-flex items-center gap-3"
                type="button"
              >
                <Download className="w-4 h-4" />
                Download Extension
                <ArrowRight className="w-4 h-4" />
              </motion.button>
              <Link to="/extension/install">
                <motion.span
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="btn-tf-secondary animate-btn-shine inline-flex items-center gap-2"
                >
                  Install instructions
                </motion.span>
              </Link>
            </div>
          </div>
        </motion.div>
      </section>
    </div>
  );
}
