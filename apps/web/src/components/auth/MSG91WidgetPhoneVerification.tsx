"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import axios from "axios";

interface MSG91WidgetPhoneVerificationProps {
  onSuccess: () => void;
  onClose: () => void;
}

export function MSG91WidgetPhoneVerification({ onSuccess, onClose }: MSG91WidgetPhoneVerificationProps) {
  const { session } = useAuth();
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [reqId, setReqId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const widgetId = process.env.NEXT_PUBLIC_MSG91_WIDGET_ID;
  const authKey = process.env.NEXT_PUBLIC_MSG91_WIDGET_TOKEN;

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!widgetId || !authKey) {
      setError("MSG91 is not configured");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Send OTP via MSG91 Widget API
      const response = await axios.post(
        "https://api.msg91.com/api/v5/widget/sendOtp",
        {
          widgetId: widgetId,
          identifier: phoneNumber,
        },
        {
          headers: {
            authkey: authKey,
            "content-type": "application/json",
          },
        }
      );

      console.log("[MSG91] Send OTP response:", response.data);

      if (response.data.type === "success" && response.data.data?.reqId) {
        setReqId(response.data.data.reqId);
        setStep("otp");
      } else {
        setError(response.data.message || "Failed to send OTP");
      }
    } catch (err: any) {
      console.error("[MSG91] Send OTP error:", err);
      setError(err.response?.data?.message || "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!widgetId || !authKey || !session) {
      setError("Invalid configuration or session");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Verify OTP with MSG91
      const verifyResponse = await axios.post(
        "https://api.msg91.com/api/v5/widget/verifyOtp",
        {
          widgetId: widgetId,
          reqId: reqId,
          otp: otp,
        },
        {
          headers: {
            authkey: authKey,
            "content-type": "application/json",
          },
        }
      );

      console.log("[MSG91] Verify OTP response:", verifyResponse.data);

      if (verifyResponse.data.type === "success" && verifyResponse.data.data?.access_token) {
        const accessToken = verifyResponse.data.data.access_token;

        // Verify access token with backend
        const result = await api.post<{ minutesGranted: number; mobile: string }>(
          "/verification/phone/verify-widget",
          { accessToken },
          session.access_token
        );

        console.log("[Backend] Verification success:", result);
        onSuccess();
      } else {
        setError(verifyResponse.data.message || "Invalid OTP");
      }
    } catch (err: any) {
      console.error("[MSG91] Verify OTP error:", err);
      setError(err.response?.data?.message || "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    if (!widgetId || !authKey || !reqId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await axios.post(
        "https://api.msg91.com/api/v5/widget/retryOtp",
        {
          widgetId: widgetId,
          reqId: reqId,
        },
        {
          headers: {
            authkey: authKey,
            "content-type": "application/json",
          },
        }
      );

      console.log("[MSG91] Resend OTP response:", response.data);

      if (response.data.type === "success") {
        alert("OTP resent successfully!");
      } else {
        setError(response.data.message || "Failed to resend OTP");
      }
    } catch (err: any) {
      console.error("[MSG91] Resend OTP error:", err);
      setError(err.response?.data?.message || "Failed to resend OTP");
    } finally {
      setLoading(false);
    }
  };

  if (!widgetId || !authKey) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-md bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-2xl p-8">
          <p className="text-red-600 dark:text-red-400">
            MSG91 Widget is not configured. Please add MSG91_WIDGET_ID and MSG91_WIDGET_TOKEN to your environment variables.
          </p>
          <button onClick={onClose} className="mt-4 w-full py-2 text-sm text-slate-500">
            Close
          </button>
        </div>
      </div>
    );
  }

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

            <form onSubmit={handleSendOTP} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+919876543210"
                  className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1a1a1a] rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-500 outline-none transition-colors text-slate-900 dark:text-white"
                  required
                  autoFocus
                />
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Use international format (e.g., +91 for India)
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

            <form onSubmit={handleVerifyOTP} className="space-y-4">
              <div>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  className="w-full px-4 py-3 text-center text-2xl font-mono tracking-widest border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1a1a1a] rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-500 outline-none transition-colors text-slate-900 dark:text-white"
                  maxLength={6}
                  required
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="w-full py-3 bg-blue-600 text-white rounded-full font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Verifying..." : "Verify & Claim Minutes"}
              </button>
            </form>

            <div className="mt-4 flex justify-between text-sm">
              <button
                onClick={() => setStep("phone")}
                className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              >
                Change Phone Number
              </button>
              <button
                onClick={handleResendOTP}
                disabled={loading}
                className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50"
              >
                Resend OTP
              </button>
            </div>
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
