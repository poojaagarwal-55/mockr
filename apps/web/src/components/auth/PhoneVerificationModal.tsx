"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/auth-context";

interface PhoneVerificationModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function PhoneVerificationModal({ onClose, onSuccess }: PhoneVerificationModalProps) {
  const { session } = useAuth();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;

    setLoading(true);
    setError(null);

    try {
      await api.post("/verification/phone/send", { phoneNumber }, session.access_token);
      setStep("code");
    } catch (err: any) {
      setError(err.message || "Failed to send code");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;

    setLoading(true);
    setError(null);

    try {
      const result = await api.post<{ minutesGranted: number }>(
        "/verification/phone/verify",
        { code },
        session.access_token
      );
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-2xl p-8">
        {step === "phone" ? (
          <>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
              Verify Phone Number
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
              Get 60 free interview minutes by verifying your phone number. Required for purchases.
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-200">
                {error}
              </div>
            )}

            <form onSubmit={handleSendCode} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+1234567890"
                  className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1a1a1a] rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-500 outline-none transition-colors text-slate-900 dark:text-white"
                  required
                  autoFocus
                />
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Use international format (e.g., +1 for US)
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-blue-600 text-white rounded-full font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Sending..." : "Send Verification Code"}
              </button>
            </form>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
              Enter Verification Code
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
              We sent a 6-digit code to {phoneNumber}
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-200">
                {error}
              </div>
            )}

            <form onSubmit={handleVerify} className="space-y-4">
              <div>
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
                {loading ? "Verifying..." : "Verify & Claim Minutes"}
              </button>
            </form>

            <button
              onClick={() => setStep("phone")}
              className="mt-4 w-full py-2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
            >
              Change Phone Number
            </button>
          </>
        )}

        <button
          onClick={onClose}
          className="mt-4 w-full py-2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
