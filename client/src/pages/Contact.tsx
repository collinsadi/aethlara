import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, ExternalLink } from "lucide-react";
import { useForm } from "react-hook-form";

type FormValues = {
  name: string;
  email: string;
  subject?: string;
  message: string;
  _honeypot?: string;
};

export function Contact() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<FormValues>();

  const onSubmit = async (data: FormValues) => {
    if (data._honeypot) return;

    setStatus("loading");
    try {
      await new Promise((res) => setTimeout(res, 900));
      setStatus("success");
      reset();
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="max-w-xl mx-auto px-6 py-16 md:py-24">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-12"
      >
        <h1 className="font-heading text-4xl md:text-5xl font-semibold tracking-tight text-foreground mb-4">
          Say hello.
        </h1>
        <p className="text-muted-foreground">
          Bug reports, feature ideas, general questions, or contributions —
          we read everything.
        </p>
      </motion.div>

      {/* Form */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="glass-card p-8 mb-8"
      >
        <AnimatePresence mode="wait">
          {status === "success" ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-10"
            >
              <div className="w-14 h-14 rounded-2xl bg-brand/10 flex items-center justify-center mx-auto mb-5">
                <Send className="w-6 h-6 text-brand" />
              </div>
              <h3 className="font-heading text-lg font-semibold text-foreground mb-2">
                Got it. We'll be in touch.
              </h3>
              <p className="text-sm text-muted-foreground mb-6">
                We read every message and reply within 24 hours.
              </p>
              <button
                onClick={() => setStatus("idle")}
                className="text-sm text-brand hover:underline transition-colors"
              >
                Send another message
              </button>
            </motion.div>
          ) : (
            <motion.form
              key="form"
              onSubmit={handleSubmit(onSubmit)}
              className="space-y-5"
            >
              {/* Honeypot */}
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                className="absolute opacity-0 pointer-events-none h-0 w-0 overflow-hidden"
                {...register("_honeypot")}
              />

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Name <span className="text-brand">*</span>
                </label>
                <input
                  type="text"
                  className={`field-input h-10 ${errors.name ? "border-destructive" : ""}`}
                  placeholder="Your name"
                  {...register("name", { required: "Name is required" })}
                />
                {errors.name && (
                  <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Email <span className="text-brand">*</span>
                </label>
                <input
                  type="email"
                  className={`field-input h-10 ${errors.email ? "border-destructive" : ""}`}
                  placeholder="you@email.com"
                  {...register("email", {
                    required: "Email is required",
                    pattern: {
                      value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                      message: "Enter a valid email address",
                    },
                  })}
                />
                {errors.email && (
                  <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Subject{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  className="field-input h-10"
                  placeholder="What's this about?"
                  maxLength={100}
                  {...register("subject")}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Message <span className="text-brand">*</span>
                </label>
                <textarea
                  rows={5}
                  className={`field-input py-2.5 resize-none ${errors.message ? "border-destructive" : ""}`}
                  placeholder="What's on your mind?"
                  {...register("message", {
                    required: "Message is required",
                    minLength: { value: 20, message: "Message must be at least 20 characters" },
                    maxLength: { value: 2000, message: "Message must be under 2000 characters" },
                  })}
                />
                {errors.message && (
                  <p className="mt-1 text-xs text-destructive">{errors.message.message}</p>
                )}
              </div>

              {status === "error" && (
                <p className="text-sm text-destructive">
                  Something went wrong. Please try again or email us directly.
                </p>
              )}

              <motion.button
                whileHover={{ scale: status === "loading" ? 1 : 1.02 }}
                whileTap={{ scale: status === "loading" ? 1 : 0.98 }}
                type="submit"
                disabled={status === "loading"}
                className="w-full btn-tf animate-btn-shine justify-center gap-2 text-sm font-semibold py-3 min-h-0 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {status === "loading" ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Send Message
                  </>
                )}
              </motion.button>
            </motion.form>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Alternative contact */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35 }}
        className="text-sm text-muted-foreground text-center"
      >
        Found a bug or have a feature request?{" "}
        <a
          href="https://github.com/collinsadi/aethlara/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-foreground hover:text-brand transition-colors"
        >
          Open an issue on GitHub
          <ExternalLink className="w-3 h-3" />
        </a>
      </motion.p>
    </div>
  );
}
