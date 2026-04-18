import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/useTheme";
import { queryClient } from "@/lib/queryClient";
import { AuthGuard, GuestGuard } from "@/middleware/AuthGuard";

import { MarketingLayout } from "@/components/layout/MarketingLayout";
import { AppLayout } from "@/components/layout/AppLayout";
import { ScrollToTop } from "@/components/ScrollToTop";

import { Landing } from "@/pages/Landing";
import { About } from "@/pages/About";
import { Contact } from "@/pages/Contact";
import { Privacy } from "@/pages/Privacy";
import { Terms } from "@/pages/Terms";
import { Login } from "@/pages/Login";
import { Signup } from "@/pages/Signup";
import { Dashboard } from "@/pages/Dashboard";
import { Resumes } from "@/pages/Resumes";
import { Jobs } from "@/pages/Jobs";
import { NewJob } from "@/pages/NewJob";
import { JobDetail } from "@/pages/JobDetail";
import { Tracker } from "@/pages/Tracker";
import { Settings } from "@/pages/Settings";
import { ExtensionHandshake } from "@/pages/ExtensionHandshake";
import { Extension } from "@/pages/Extension";
import { ExtensionInstall } from "@/pages/ExtensionInstall";
import { ResumeMismatch } from "@/pages/ResumeMismatch";

export default function App() {
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <ScrollToTop />
            <Routes>
              {/* Marketing / Public */}
              <Route element={<MarketingLayout />}>
                <Route path="/" element={<Landing />} />
                <Route path="/about" element={<About />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/extension" element={<Extension />} />
                <Route path="/extension/install" element={<ExtensionInstall />} />
                <Route path="/help/resume-mismatch" element={<ResumeMismatch />} />
              </Route>

              {/* Auth — redirect to dashboard if already logged in */}
              <Route
                path="/login"
                element={
                  <GuestGuard>
                    <Login />
                  </GuestGuard>
                }
              />
              <Route
                path="/signup"
                element={
                  <GuestGuard>
                    <Signup />
                  </GuestGuard>
                }
              />

              {/* App (protected) */}
              <Route
                element={
                  <AuthGuard>
                    <AppLayout />
                  </AuthGuard>
                }
              >
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/resumes" element={<Resumes />} />
                <Route path="/jobs" element={<Jobs />} />
                <Route path="/jobs/new" element={<NewJob />} />
                <Route path="/jobs/:jobId" element={<JobDetail />} />
                <Route path="/tracker" element={<Tracker />} />
                <Route path="/settings" element={<Settings />} />
              </Route>

              {/* Extension handshake relay — public, no auth required */}
              <Route path="/extension-handshake" element={<ExtensionHandshake />} />

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}
