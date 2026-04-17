import { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/hooks/useAuth";
import { AnimatedOrbs } from "@/components/AnimatedOrbs";
import { OtpInput } from "@/components/OtpInput";
import {
  signupSchema,
  type SignupFormValues,
} from "@/lib/validators/auth.schema";
import type { ApiError } from "@/lib/types";

type Step = "credentials" | "otp";

export function Signup() {
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState<string[]>(Array(6).fill(""));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const { signup, verifyOtp } = useAuth();

  const form = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { full_name: "", email: "" },
  });

  const handleCredentialsSubmit = async (values: SignupFormValues) => {
    setIsSubmitting(true);
    setApiError(null);
    try {
      await signup(values.full_name, values.email);
      setEmail(values.email);
      setStep("otp");
      startResendCooldown();
    } catch (err) {
      setApiError((err as ApiError).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOtpComplete = async (code: string) => {
    setIsVerifying(true);
    setApiError(null);
    try {
      await verifyOtp(email, code, "signup");
    } catch (err) {
      setApiError((err as ApiError).message);
      setIsVerifying(false);
    }
  };

  const handleOtpChange = (val: string[]) => {
    setOtp(val);
    setApiError(null);
    if (val.every((d) => d !== "")) {
      handleOtpComplete(val.join(""));
    }
  };

  const startResendCooldown = () => {
    setResendCooldown(60);
    const interval = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setApiError(null);
    try {
      await signup(form.getValues("full_name"), email);
      setOtp(Array(6).fill(""));
      startResendCooldown();
    } catch (err) {
      setApiError((err as ApiError).message);
    }
  };

  return (
    <div className="min-h-screen bg-cosmic flex items-center justify-center px-6 relative text-foreground">
      <AnimatedOrbs />

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md relative z-10"
      >
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 mb-8">
            <div className="logo-mark size-10">
              <Sparkles className="w-5 h-5" />
            </div>
            <span className="text-xl font-semibold font-heading">Aethlara</span>
          </Link>

          <AnimatePresence mode="wait">
            {step === "credentials" ? (
              <motion.div
                key="cred-header"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.25 }}
              >
                <h1 className="text-2xl font-semibold text-foreground mb-2 font-heading">
                  Create your account
                </h1>
                <p className="text-sm text-muted-foreground">
                  Start aligning your career with AI
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="otp-header"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.25 }}
              >
                <h1 className="text-2xl font-semibold text-foreground mb-2 font-heading">
                  Verify your email
                </h1>
                <p className="text-sm text-muted-foreground">
                  Enter the 6-digit code sent to{" "}
                  <span className="text-foreground font-medium">{email}</span>
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="glass-card p-8">
          <AnimatePresence mode="wait">
            {step === "credentials" ? (
              <motion.div
                key="cred-form"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <form
                  onSubmit={form.handleSubmit(handleCredentialsSubmit)}
                  className="space-y-5"
                >
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                      Full Name
                    </label>
                    <input
                      type="text"
                      {...form.register("full_name")}
                      className="field-input h-11 px-4"
                      placeholder="Alex Rivera"
                    />
                    {form.formState.errors.full_name && (
                      <p className="text-xs text-red-500 mt-1">
                        {form.formState.errors.full_name.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                      Email
                    </label>
                    <input
                      type="email"
                      {...form.register("email")}
                      className="field-input h-11 px-4"
                      placeholder="you@email.com"
                    />
                    {form.formState.errors.email && (
                      <p className="text-xs text-red-500 mt-1">
                        {form.formState.errors.email.message}
                      </p>
                    )}
                  </div>

                  {apiError && (
                    <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
                      <p className="text-xs text-red-500">{apiError}</p>
                    </div>
                  )}

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full btn-tf animate-btn-shine justify-center gap-2 text-sm font-semibold py-3 min-h-0 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        Continue
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </motion.button>
                </form>

                <p className="text-[11px] text-muted-foreground text-center mt-5 leading-relaxed">
                  By creating an account, you agree to our Terms of Service and
                  Privacy Policy.
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="otp-form"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="space-y-6">
                  <div className="flex justify-center mb-2">
                    <div className="size-12 rounded-full bg-brand/10 flex items-center justify-center">
                      <ShieldCheck className="w-6 h-6 text-brand" />
                    </div>
                  </div>

                  <OtpInput
                    value={otp}
                    onChange={handleOtpChange}
                    disabled={isVerifying}
                  />

                  {apiError && (
                    <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
                      <p className="text-xs text-red-500 text-center">
                        {apiError}
                      </p>
                    </div>
                  )}

                  {isVerifying && (
                    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Verifying…
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        setStep("credentials");
                        setOtp(Array(6).fill(""));
                        setIsVerifying(false);
                        setApiError(null);
                      }}
                      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={resendCooldown > 0}
                      className="text-xs text-brand hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {resendCooldown > 0
                        ? `Resend in ${resendCooldown}s`
                        : "Resend code"}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Already have an account?{" "}
          <Link
            to="/login"
            className="text-brand font-medium hover:opacity-80 transition-opacity"
          >
            Sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
