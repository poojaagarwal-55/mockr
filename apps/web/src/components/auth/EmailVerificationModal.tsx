"use client";

import { useState, useEffect, useRef } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { useRouter } from "next/navigation";

interface EmailVerificationModalProps {
  email: string;
  password: string;
  onClose?: () => void;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function EmailVerificationModal({ email, password }: EmailVerificationModalProps) {
  const { signIn } = useAuth();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  
  // Track if OTP has been sent to prevent duplicate sends
  const otpSentRef = useRef(false);

  // Send OTP automatically when modal opens (only once)
  useEffect(() => {
    // Prevent duplicate sends (React Strict Mode runs effects twice in dev)
    if (otpSentRef.current) return;
    otpSentRef.current = true;

    const sendInitialOTP = async () => {
      try {
        await api.post("/verification/email/send-public", { email });
      } catch (err) {
        setError(getErrorMessage(err, "Failed to send verification code"));
        // Reset flag on error so user can retry
        otpSentRef.current = false;
      }
    };
    sendInitialOTP();
  }, [email]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);
    setError(null);

    try {
      // Verify the OTP code
      await api.post("/verification/email/verify-public", { email, code });
      
      // After successful verification, sign in the user
      const user = await signIn(email, password);
      
      // Redirect based on onboarding status
      if (!user.onboardingCompleted) {
        router.replace("/onboarding");
      } else {
        router.replace("/dashboard");
      }
    } catch (err) {
      setError(getErrorMessage(err, "Verification failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError(null);

    try {
      await api.post("/verification/email/send-public", { email });
      alert("Verification code sent! Check your email.");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to resend code"));
    } finally {
      setResending(false);
    }
  };

  const handleSkip = async () => {
    setLoading(true);
    setError(null);

    try {
      try {
        await api.post("/verification/email/verify-public", {
          email,
          code: "000000",
          devSkip: true,
        });
      } catch (verifyError) {
        const alreadyVerified =
          verifyError instanceof ApiError &&
          verifyError.status === 400 &&
          verifyError.message.toLowerCase().includes("already verified");

        if (!alreadyVerified) {
          throw verifyError;
        }
      }

      const user = await signIn(email, password);
      
      // Redirect based on onboarding status
      if (!user.onboardingCompleted) {
        router.replace("/onboarding");
      } else {
        router.replace("/dashboard");
      }
    } catch (err) {
      setError(getErrorMessage(err, "Sign in failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-2xl p-8">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
          Verify Your Email
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          We sent a 6-digit code to <strong>{email}</strong>. Enter it below to continue.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleVerify} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Verification Code
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="w-full px-4 py-3 text-center text-2xl font-mono tracking-widest border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1a1a1a] rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-500 outline-none transition-colors text-slate-900 dark:text-white"
              maxLength={6}
              required
              autoFocus
            />
          </div>

          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="w-full py-3 bg-blue-600 text-white rounded-full font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Verifying..." : "Verify Email"}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            onClick={handleResend}
            disabled={resending}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
          >
            {resending ? "Sending..." : "Resend Code"}
          </button>
          
          {/* Development-only skip button */}
          {process.env.NODE_ENV === "development" && (
            <>
              <span className="mx-2 text-slate-400">•</span>
              <button
                onClick={handleSkip}
                disabled={loading}
                className="text-sm text-amber-600 dark:text-amber-400 hover:underline disabled:opacity-50"
              >
                Skip (Dev Only)
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
