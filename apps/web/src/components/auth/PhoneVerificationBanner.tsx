"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/auth-context";
import { MSG91PhoneVerification } from "./MSG91PhoneVerification";

export function PhoneVerificationBanner() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [justVerified, setJustVerified] = useState(false);
  const previousMobileVerified = useRef<boolean | undefined>(undefined);
  
  // Persist dismissed state to localStorage so it doesn't reappear on remount
  const getDismissedState = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
      const dismissed = localStorage.getItem('practers_phone_verification_dismissed');
      return dismissed === 'true';
    } catch {
      return false;
    }
  };

  const [dismissed, setDismissed] = useState(getDismissedState);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem('practers_phone_verification_dismissed', 'true');
    } catch (err) {
      console.warn('Failed to save dismissed state:', err);
    }
  };

  // Clear dismissed state when user verifies their phone
  useEffect(() => {
    if (user?.mobileVerified) {
      try {
        localStorage.removeItem('practers_phone_verification_dismissed');
      } catch {
        // Ignore errors
      }
    }
  }, [user?.mobileVerified]);

  // Detect when mobileVerified changes from false to true
  useEffect(() => {
    if (user?.mobileVerified !== undefined) {
      // If user was previously not verified and now is verified, show success banner
      if (previousMobileVerified.current === false && user.mobileVerified === true) {
        setJustVerified(true);
        // Auto-dismiss success message after 8 seconds
        const timer = setTimeout(() => {
          setJustVerified(false);
        }, 8000);
        return () => clearTimeout(timer);
      }
      
      // Update the previous state
      previousMobileVerified.current = user.mobileVerified;
    }
  }, [user?.mobileVerified]);

  // Initialize previous state on first load
  useEffect(() => {
    if (user?.mobileVerified !== undefined && previousMobileVerified.current === undefined) {
      previousMobileVerified.current = user.mobileVerified;
      
      // Check if user was recently verified (within last 30 seconds of mobileVerifiedAt)
      if (user.mobileVerified && user.mobileVerifiedAt) {
        const verifiedAt = new Date(user.mobileVerifiedAt);
        const now = new Date();
        const timeDiff = now.getTime() - verifiedAt.getTime();
        const thirtySecondsInMs = 30 * 1000;
        
        if (timeDiff <= thirtySecondsInMs) {
          setJustVerified(true);
          // Auto-dismiss success message after 8 seconds
          const timer = setTimeout(() => {
            setJustVerified(false);
          }, 8000);
          return () => clearTimeout(timer);
        }
      }
    }
  }, [user?.mobileVerified, user?.mobileVerifiedAt]);

  if (!user || dismissed) {
    return null;
  }

  // Show green success banner if just verified
  if (user.mobileVerified && justVerified) {
    return (
      <div className="bg-gradient-to-r from-green-500 to-green-600 text-white px-6 py-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-2xl">check_circle</span>
          <div>
            <p className="font-semibold">Phone verified successfully! You've earned 60 free interview minutes!</p>
            <p className="text-sm text-green-100">Your minutes have been added to your account</p>
          </div>
        </div>
        <button
          onClick={() => {
            setJustVerified(false);
            handleDismiss();
          }}
          className="p-2 hover:bg-green-700 rounded-full transition-colors"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
    );
  }

  // Don't show banner if already verified and not just verified
  if (user.mobileVerified) {
    return null;
  }

  // Show blue verification prompt banner
  return (
    <>
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white px-4 md:px-6 py-3 md:py-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-2 md:gap-3">
          <span className="material-symbols-outlined text-xl md:text-2xl">verified_user</span>
          <div>
            <p className="text-xs md:text-base font-semibold">
              Verify your phone number to claim{" "}
              <span className="font-black uppercase tracking-wider text-[#FFE500] whitespace-nowrap">
                60 Free Interview Minutes!
              </span>
            </p>
            <p className="hidden md:block text-sm text-blue-100">Required for purchases and premium features</p>
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <button
            onClick={() => setShowModal(true)}
            className="px-2.5 md:px-6 py-1 md:py-2 text-[10px] md:text-sm whitespace-nowrap bg-white text-blue-600 rounded-full font-semibold hover:bg-blue-50 transition-colors"
          >
            Verify Now
          </button>
          <button
            onClick={handleDismiss}
            className="p-1.5 md:p-2 hover:bg-blue-700 rounded-full transition-colors"
          >
            <span className="material-symbols-outlined text-lg md:text-2xl">close</span>
          </button>
        </div>
      </div>

      {showModal && (
        <MSG91PhoneVerification
          onClose={() => setShowModal(false)}
          onSuccess={() => {
            setShowModal(false);
            // The banner will automatically update when user.mobileVerified changes
            // No need to manually set localStorage or state here
          }}
        />
      )}
    </>
  );
}
