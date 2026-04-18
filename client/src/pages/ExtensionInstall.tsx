import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Download,
  FolderOpen,
  Puzzle,
  ToggleRight,
  CheckCircle2,
  Info,
  Code2,
  Settings as SettingsIcon,
} from "lucide-react";

const EXTENSION_FILE = "aethlara-extension-v1.zip";
const EXTENSION_URL = `/downloadable/${EXTENSION_FILE}`;
const EXTENSION_GITHUB =
  "https://github.com/collinsadi/aethlara/tree/main/extension";

const steps = [
  {
    n: "01",
    icon: Download,
    title: "Download the ZIP",
    body: "Save aethlara-extension-v1.zip to a folder you'll remember — your Downloads folder is fine. Don't move it after step 2.",
    tip: "Already downloaded automatically — check your downloads.",
  },
  {
    n: "02",
    icon: FolderOpen,
    title: "Unzip the file",
    body: "Right-click the ZIP and choose Extract All (Windows), or double-click it (macOS). You should end up with a folder named aethlara-extension-v1 containing manifest.json, background, content, and other files.",
    tip: "Keep the unzipped folder somewhere permanent — Chrome loads the extension from this exact location.",
  },
  {
    n: "03",
    icon: Puzzle,
    title: "Open your browser's extensions page",
    body: "Paste one of these into your address bar and press Enter:",
    code: [
      { label: "Chrome", value: "chrome://extensions" },
      { label: "Brave", value: "brave://extensions" },
      { label: "Edge", value: "edge://extensions" },
      { label: "Arc", value: "arc://extensions" },
    ],
  },
  {
    n: "04",
    icon: ToggleRight,
    title: "Enable Developer mode",
    body: "Look for the 'Developer mode' toggle in the top-right of the extensions page and switch it on. New buttons will appear: Load unpacked, Pack extension, Update.",
  },
  {
    n: "05",
    icon: FolderOpen,
    title: "Click 'Load unpacked'",
    body: "A file picker opens. Navigate to and select the unzipped aethlara-extension-v1 folder (the one that contains manifest.json — not the ZIP file itself).",
    tip: "If you see an error, make sure you selected the folder containing manifest.json, not its parent.",
  },
  {
    n: "06",
    icon: CheckCircle2,
    title: "Pin the extension (optional but recommended)",
    body: "Click the puzzle-piece icon in your browser toolbar, find Aethlara in the list, and click the pin icon. The Aethlara icon will now sit in your toolbar for one-click access.",
  },
  {
    n: "07",
    icon: SettingsIcon,
    title: "Connect your account",
    body: "Open your Aethlara dashboard, go to Settings → Extension, and click Connect Chrome Extension. A tab opens, the extension intercepts a one-time token, and you're connected. Sessions last 15 minutes — reconnect when prompted.",
  },
];

const troubleshooting = [
  {
    q: "I get 'Manifest file is missing or unreadable'",
    a: "You probably selected the ZIP file or the wrong folder. The folder you load must directly contain a file called manifest.json. Re-extract and try again.",
  },
  {
    q: "The extension loaded but the icon isn't visible",
    a: "Click the puzzle-piece icon in the browser toolbar, find Aethlara, and click the pin icon next to it.",
  },
  {
    q: "Connect button doesn't open the extension",
    a: "Make sure you've completed steps 1–6 and the extension is enabled at chrome://extensions. Refresh your dashboard tab and try again.",
  },
  {
    q: "Session keeps expiring",
    a: "By design — extension sessions last 15 minutes for security. Just reconnect from Settings → Extension whenever it expires.",
  },
];

export function ExtensionInstall() {
  const handleRedownload = () => {
    const link = document.createElement("a");
    link.href = EXTENSION_URL;
    link.download = EXTENSION_FILE;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="overflow-hidden">
      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-4 pb-10 md:pt-8 md:pb-12 text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs font-medium mb-5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Download started
          </div>
          <h1 className="font-heading text-4xl md:text-5xl font-semibold tracking-tight text-foreground mb-5 leading-[1.05]">
            Install in{" "}
            <span className="text-gradient">about 60 seconds.</span>
          </h1>
          <p className="text-muted-foreground text-base md:text-lg max-w-xl mx-auto leading-relaxed">
            Follow these seven short steps to load the Aethlara extension into
            your Chromium-based browser.
          </p>
        </motion.div>
      </section>

      {/* Didn't download notice */}
      <section className="max-w-3xl mx-auto px-6 pb-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="glass-card p-5 md:p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between"
        >
          <div className="flex items-start gap-3 min-w-0">
            <Info className="w-5 h-5 text-brand shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground mb-0.5">
                Download didn't start?
              </p>
              <p className="text-xs text-muted-foreground">
                Trigger it again or grab the file directly.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRedownload}
            className="btn-tf-secondary inline-flex items-center gap-2 text-sm shrink-0"
          >
            <Download className="w-4 h-4" />
            Download again
          </button>
        </motion.div>
      </section>

      {/* Steps */}
      <section className="max-w-3xl mx-auto px-6 pb-16 md:pb-20">
        <div className="space-y-4">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <motion.div
                key={step.n}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.04, duration: 0.4 }}
                className="glass-card p-6 md:p-7"
              >
                <div className="flex gap-5 items-start">
                  <div className="shrink-0 flex flex-col items-center">
                    <div className="w-11 h-11 rounded-xl bg-brand/10 text-brand flex items-center justify-center mb-2">
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="font-mono text-[10px] font-semibold text-muted-foreground tracking-wider">
                      {step.n}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0 pt-1">
                    <h3 className="font-heading text-base md:text-lg font-semibold text-foreground mb-2">
                      {step.title}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {step.body}
                    </p>

                    {step.code && (
                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {step.code.map((c) => (
                          <div
                            key={c.value}
                            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
                          >
                            <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                              {c.label}
                            </span>
                            <code className="font-mono text-xs text-foreground truncate">
                              {c.value}
                            </code>
                          </div>
                        ))}
                      </div>
                    )}

                    {step.tip && (
                      <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground border-l-2 border-brand/40 pl-3 py-1">
                        <span className="font-semibold text-brand uppercase tracking-wider text-[10px] mt-0.5">
                          Tip
                        </span>
                        <span className="leading-relaxed">{step.tip}</span>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Troubleshooting */}
      <section className="max-w-3xl mx-auto px-6 py-8 md:py-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-8"
        >
          <div className="heading-sub mb-4">Troubleshooting</div>
          <h2 className="font-heading text-2xl md:text-3xl font-semibold tracking-tight text-foreground">
            Stuck on something?
          </h2>
        </motion.div>

        <div className="space-y-3">
          {troubleshooting.map((t, i) => (
            <motion.div
              key={t.q}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              className="glass-card p-5 md:p-6"
            >
              <h3 className="font-heading text-sm md:text-base font-semibold text-foreground mb-1.5">
                {t.q}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t.a}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-3xl mx-auto px-6 pb-24 md:pb-32 pt-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="glass-card p-8 md:p-10 text-center relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-brand/[0.05] via-transparent to-transparent pointer-events-none" />
          <div className="relative z-10">
            <h2 className="font-heading text-2xl md:text-3xl font-semibold tracking-tight text-foreground mb-3">
              Installed it? Connect your account.
            </h2>
            <p className="text-muted-foreground max-w-md mx-auto mb-7 text-sm md:text-base leading-relaxed">
              Open your dashboard, go to Settings → Extension, and click
              Connect Chrome Extension to finish setup.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link to="/settings">
                <motion.span
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="btn-tf animate-btn-shine inline-flex items-center gap-2"
                >
                  Open Settings
                  <ArrowRight className="w-4 h-4" />
                </motion.span>
              </Link>
              <a
                href={EXTENSION_GITHUB}
                target="_blank"
                rel="noopener noreferrer"
              >
                <motion.span
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="btn-tf-secondary animate-btn-shine inline-flex items-center gap-2"
                >
                  <Code2 className="w-4 h-4" />
                  View source
                </motion.span>
              </a>
            </div>
          </div>
        </motion.div>
      </section>
    </div>
  );
}
