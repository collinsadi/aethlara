import { Navigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, isInitialising } = useAuth();
  const location = useLocation();

  if (isInitialising) {
    return (
      <div className="min-h-screen bg-cosmic flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="logo-mark size-12"
          >
            <Sparkles className="w-6 h-6" />
          </motion.div>
          <p className="text-sm text-muted-foreground">Loading your session…</p>
        </motion.div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

/** Redirect away from auth pages if already logged in */
export function GuestGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, isInitialising } = useAuth();

  if (isInitialising) {
    return (
      <div className="min-h-screen bg-cosmic flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="logo-mark size-12"
          >
            <Sparkles className="w-6 h-6" />
          </motion.div>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </motion.div>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
