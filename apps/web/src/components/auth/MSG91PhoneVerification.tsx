"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { useBilling } from "@/hooks/use-billing";
import { addNotification } from "@/lib/notifications";

interface MSG91PhoneVerificationProps {
  onSuccess: () => void;
  onClose: () => void;
}

declare global {
  interface Window {
    initSendOTP: (config: any) => void;
  }
}

export function MSG91PhoneVerification({ onSuccess, onClose }: MSG91PhoneVerificationProps) {
  const { session, refreshUser } = useAuth();
  const { refresh: refreshBilling } = useBilling();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [showWrapper, setShowWrapper] = useState(false); // Only show wrapper on error or completion

  const widgetId = process.env.NEXT_PUBLIC_MSG91_WIDGET_ID;
  const tokenAuth = process.env.NEXT_PUBLIC_MSG91_WIDGET_TOKEN;

  useEffect(() => {
    // Load MSG91 script
    if (scriptLoaded || !widgetId || !tokenAuth) return;

    const script = document.createElement('script');
    script.src = 'https://verify.msg91.com/otp-provider.js';
    script.async = true;
    
    script.onload = () => {
      console.log('[MSG91] Script loaded successfully');
      setScriptLoaded(true);
      
      // Initialize widget after script loads
      const configuration = {
        widgetId: widgetId,
        tokenAuth: tokenAuth,
        success: async (data: any) => {
          console.log('[MSG91] Verification success, data received:', data);
          console.log('[MSG91] Data type:', typeof data);
          console.log('[MSG91] Data keys:', data && typeof data === 'object' ? Object.keys(data) : 'N/A');
          console.log('[MSG91] Full data object:', JSON.stringify(data, null, 2));
          
          // MSG91 returns the access token directly as a string
          // If it's an object, it might be in data.message or data.access_token
          let accessToken: string | undefined;
          
          if (typeof data === 'string') {
            accessToken = data;
          } else if (data && typeof data === 'object') {
            // Try different possible fields
            accessToken = data.message || data.access_token || data.accessToken || data.token;
          }
          
          console.log('[MSG91] Extracted access token:', accessToken ? accessToken.substring(0, 30) + '...' : 'NONE');
          
          setLoading(true);
          setShowWrapper(true); // Show wrapper during backend verification
          setError(null);

          try {
            if (!session) {
              throw new Error('Not authenticated');
            }

            if (!accessToken) {
              throw new Error('No access token received from MSG91');
            }

            // Verify the access token with backend
            console.log('[MSG91] Calling backend to verify access token...');
            const result = await api.post<{ minutesGranted: number; mobile: string }>(
              '/verification/phone/verify-widget',
              { accessToken },
              session.access_token
            );

            console.log('[MSG91] Backend verification success:', result);
            console.log('[MSG91] Minutes granted:', result.minutesGranted);
            console.log('[MSG91] Mobile verified:', result.mobile);
            
            // Add success notification
            addNotification({
              type: 'welcome',
              title: 'Phone Verified! 🎉',
              message: `You've earned ${result.minutesGranted} free interview minutes! Your phone number has been verified successfully.`,
            });
            
            console.log('[MSG91] Calling refreshUser to update user state...');
            // Refresh user data to update mobileVerified status
            await refreshUser();
            console.log('[MSG91] refreshUser completed');
            
            console.log('[MSG91] Calling refreshBilling to update minutes...');
            // Refresh billing data to show updated minutes
            await refreshBilling();
            console.log('[MSG91] refreshBilling completed');
            
            onSuccess();
            console.log('[MSG91] onSuccess called - modal should close and banner should hide');
          } catch (err: any) {
            console.error('[MSG91] Backend verification failed:', err);
            
            // Check if it's a duplicate phone number error
            const errorMessage = err.message || 'Verification failed';
            if (errorMessage.includes('already verified by another account')) {
              setError('This phone number is already registered with another account. Please use a different number.');
            } else {
              setError(errorMessage);
            }
            setShowWrapper(true); // Show wrapper to display error
          } finally {
            setLoading(false);
          }
        },
        failure: (error: any) => {
          console.error('[MSG91] Widget error:', error);
          setError(`Verification failed: ${error.message || 'Please check your credentials and try again'}`);
          setShowWrapper(true); // Show wrapper to display error
        },
      };

      try {
        if (window.initSendOTP) {
          window.initSendOTP(configuration);
          console.log('[MSG91] Widget initialized');
        }
      } catch (err: any) {
        console.error('[MSG91] Failed to initialize widget:', err);
        setError('Failed to initialize verification widget');
        setShowWrapper(true); // Show wrapper to display error
      }
    };

    script.onerror = () => {
      console.error('[MSG91] Failed to load script');
      setError('Failed to load MSG91 widget');
      setShowWrapper(true); // Show wrapper to display error
    };

    document.body.appendChild(script);

    return () => {
      // Cleanup
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, [widgetId, tokenAuth, session, onSuccess, scriptLoaded, refreshUser, refreshBilling]);

  if (!widgetId || !tokenAuth) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/70 backdrop-blur-md">
        <div className="relative w-full max-w-md bg-white dark:bg-[#1a1a1a] rounded-3xl border border-slate-200/70 dark:border-white/[0.08] shadow-[0_30px_80px_-15px_rgba(0,0,0,0.35)] dark:shadow-[0_30px_80px_-15px_rgba(0,0,0,0.7)] overflow-hidden">
          <div className="px-8 py-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="size-10 rounded-xl bg-red-100 dark:bg-red-500/15 flex items-center justify-center">
                <span className="material-symbols-outlined text-red-600 dark:text-red-400 text-[22px]">error</span>
              </div>
              <h2 className="text-[18px] font-bold text-red-600 dark:text-red-400">
                Configuration Error
              </h2>
            </div>
            <p className="text-[13.5px] text-slate-700 dark:text-slate-300 mb-3 leading-relaxed">
              MSG91 Widget is not configured. Please add:
            </p>
            <ul className="space-y-1.5 mb-5">
              <li className="text-[12.5px] font-mono text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-white/[0.05] rounded-lg px-3 py-1.5">NEXT_PUBLIC_MSG91_WIDGET_ID</li>
              <li className="text-[12.5px] font-mono text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-white/[0.05] rounded-lg px-3 py-1.5">NEXT_PUBLIC_MSG91_WIDGET_TOKEN</li>
            </ul>
            <button
              onClick={onClose}
              className="w-full py-2.5 text-[14px] font-semibold bg-slate-100 dark:bg-white/[0.06] text-slate-700 dark:text-slate-200 rounded-xl hover:bg-slate-200 dark:hover:bg-white/[0.1] transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show wrapper only when there's an error, loading state, or not yet loaded
  if (showWrapper || error || loading || !scriptLoaded) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
        <div className="relative w-full max-w-md bg-white dark:bg-[#1a1a1a] rounded-3xl border border-slate-200/70 dark:border-white/[0.08] shadow-[0_30px_80px_-15px_rgba(0,0,0,0.35)] dark:shadow-[0_30px_80px_-15px_rgba(0,0,0,0.7)] overflow-hidden animate-in zoom-in-95 fade-in duration-200">
          {/* Premium gradient hero */}
          <div className="relative px-8 pt-9 pb-7 bg-gradient-to-br from-blue-50 via-white to-blue-50/40 dark:from-[#1f1f1f] dark:via-[#1a1a1a] dark:to-[#1d2230] border-b border-slate-200/70 dark:border-white/[0.06] overflow-hidden text-center">
            <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-72 bg-gradient-to-br from-blue-400/30 via-blue-500/15 to-transparent dark:from-blue-500/20 dark:via-blue-600/10 blur-3xl rounded-full" />

            <button
              onClick={onClose}
              disabled={loading}
              className="absolute top-5 right-5 size-9 flex items-center justify-center rounded-full bg-white/70 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/[0.12] border border-slate-200/70 dark:border-white/[0.08] backdrop-blur-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Close"
            >
              <span className="material-symbols-outlined text-slate-500 dark:text-slate-300 text-[18px]">close</span>
            </button>

            {/* Hero shield icon */}
            <div className="relative mx-auto mb-5 w-16 h-16">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 blur-xl opacity-40 animate-pulse" />
              <div className="relative w-full h-full rounded-2xl bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 flex items-center justify-center shadow-[0_10px_25px_-6px_rgba(37,99,235,0.55)] rotate-[-6deg]">
                <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
              </div>
              <span className="absolute -top-1 -right-2 text-[16px] animate-pulse">✦</span>
            </div>

            <h2 className="relative text-[22px] font-bold text-slate-900 dark:text-white font-nunito tracking-tight">
              Verify Phone Number
            </h2>
            <p className="relative mt-2 text-[13px] text-slate-600 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
              Get{" "}
              <span className="font-black uppercase tracking-wider text-primary">60 FREE INTERVIEW MINUTES</span>
              {" "}by verifying your phone. Required for purchases.
            </p>
          </div>

          {/* Body */}
          <div className="px-8 py-6">
            {error && (
              <div className="mb-5 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-red-600 dark:text-red-400 text-[20px] mt-0.5 shrink-0">
                    error
                  </span>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[13.5px] font-bold text-red-800 dark:text-red-300 mb-1">
                      Verification Failed
                    </h3>
                    <p className="text-[12.5px] text-red-700 dark:text-red-200 leading-relaxed">
                      {error}
                    </p>
                    {error.includes('already registered') && (
                      <p className="text-[11.5px] text-red-600 dark:text-red-300/90 mt-2 italic">
                        Tip: each phone number can only be verified once. Try a different number.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {loading && (
              <div className="mb-5 p-3.5 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-2xl text-[13px] font-medium text-blue-700 dark:text-blue-200 flex items-center gap-2.5">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent" />
                Verifying your phone number...
              </div>
            )}

            {!scriptLoaded && !error && (
              <div className="flex flex-col items-center justify-center py-10">
                <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-600 border-t-transparent mb-3" />
                <span className="text-[13px] text-slate-600 dark:text-slate-400">Loading verification widget...</span>
              </div>
            )}

            <button
              onClick={onClose}
              className="w-full py-2.5 text-[13px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Widget is loaded and ready - render nothing (widget appears directly on page)
  return null;
}
