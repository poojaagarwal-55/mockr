'use client';

import { useState, useEffect } from 'react';
import Script from 'next/script';
import { useAuth } from '@/context/auth-context';

declare global {
  interface Window {
    sendOtp: (
      identifier: string,
      onSuccess?: (data: any) => void,
      onFailure?: (error: any) => void
    ) => void;
    verifyOtp: (
      otp: string,
      onSuccess?: (data: any) => void,
      onFailure?: (error: any) => void,
      reqId?: string
    ) => void;
    retryOtp: (
      channel: string | null,
      onSuccess?: (data: any) => void,
      onFailure?: (error: any) => void,
      reqId?: string
    ) => void;
    getWidgetData: () => any;
    isCaptchaVerified: () => boolean;
    initSendOTP: (config: any) => void;
  }
}

interface CustomPhoneVerificationProps {
  onComplete?: () => void;
}

export function CustomPhoneVerification({ onComplete }: CustomPhoneVerificationProps) {
  const { session } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [isLoaded, setIsLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (isLoaded && typeof window !== 'undefined') {
      const configuration = {
        widgetId: process.env.NEXT_PUBLIC_MSG91_WIDGET_ID,
        tokenAuth: process.env.NEXT_PUBLIC_MSG91_WIDGET_TOKEN, // Widget token for client-side auth
        exposeMethods: true,
        captchaRenderId: 'msg91-captcha',
      };

      if (window.initSendOTP) {
        window.initSendOTP(configuration);
      }
    }
  }, [isLoaded]);

  const handleSendOTP = () => {
    if (!phoneNumber) {
      setError('Please enter phone number');
      return;
    }

    // Validate phone number format
    const phoneRegex = /^\+?[1-9]\d{9,14}$/;
    if (!phoneRegex.test(phoneNumber)) {
      setError('Please enter a valid phone number with country code (e.g., +919876543210)');
      return;
    }

    setLoading(true);
    setError('');

    // Format: Remove + and spaces
    const formattedPhone = phoneNumber.replace(/[^0-9]/g, '');

    window.sendOtp(
      formattedPhone,
      (data) => {
        console.log('[MSG91] OTP sent:', data);
        setLoading(false);
        setStep('otp');
        setSuccess('OTP sent successfully!');
      },
      (error) => {
        console.error('[MSG91] Send OTP failed:', error);
        setLoading(false);
        setError(error.message || 'Failed to send OTP. Please try again.');
      }
    );
  };

  const handleVerifyOTP = () => {
    if (!otp || otp.length !== 6) {
      setError('Please enter 6-digit OTP');
      return;
    }

    setLoading(true);
    setError('');

    window.verifyOtp(
      otp,
      (data) => {
        console.log('[MSG91] OTP verified:', data);
        setLoading(false);
        
        // Call backend to complete verification
        completePhoneVerification(phoneNumber, data);
      },
      (error) => {
        console.error('[MSG91] Verify OTP failed:', error);
        setLoading(false);
        setError(error.message || 'Invalid OTP. Please try again.');
      }
    );
  };

  const handleResendOTP = () => {
    setLoading(true);
    setError('');
    setSuccess('');

    window.retryOtp(
      null, // Use default channel (SMS)
      (data) => {
        console.log('[MSG91] OTP resent:', data);
        setLoading(false);
        setSuccess('OTP resent successfully!');
      },
      (error) => {
        console.error('[MSG91] Resend failed:', error);
        setLoading(false);
        setError(error.message || 'Failed to resend OTP. Please try again.');
      }
    );
  };

  const completePhoneVerification = async (phone: string, msg91Data: any) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/verification/phone/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          phoneNumber: phone,
          msg91Data: msg91Data,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(`Phone verified successfully! You earned ${data.minutesGranted} free interview minutes!`);
        setTimeout(() => {
          if (onComplete) onComplete();
        }, 2000);
      } else {
        setError(data.error || 'Failed to complete verification');
      }
    } catch (err) {
      console.error('[Verification] Network error:', err);
      setError('Network error. Please try again.');
    }
  };

  return (
    <>
      <Script
        src="https://verify.msg91.com/otp-provider.js"
        onLoad={() => setIsLoaded(true)}
        strategy="afterInteractive"
      />

      <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg">
        {step === 'phone' ? (
          <div>
            <h2 className="text-2xl font-bold mb-2 text-gray-900">Verify Phone Number</h2>
            <p className="text-gray-600 mb-6">Get 60 free interview minutes by verifying your phone number</p>
            
            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Phone Number
              </label>
              <input
                type="tel"
                placeholder="+919876543210"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#FFE500] focus:border-transparent outline-none"
              />
              <p className="text-xs text-gray-500 mt-1">
                Include country code (e.g., +91 for India)
              </p>
            </div>

            <div id="msg91-captcha" className="mb-4" />

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg mb-4 text-sm">
                {error}
              </div>
            )}

            {success && (
              <div className="bg-green-50 border border-green-200 text-green-700 p-3 rounded-lg mb-4 text-sm">
                {success}
              </div>
            )}

            <button
              onClick={handleSendOTP}
              disabled={loading || !isLoaded || !phoneNumber}
              className="w-full bg-[#FFE500] text-black py-3 rounded-lg font-semibold hover:bg-[#f5dc00] transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Sending...' : 'Send OTP'}
            </button>
          </div>
        ) : (
          <div>
            <h2 className="text-2xl font-bold mb-2 text-gray-900">Enter OTP</h2>
            <p className="text-gray-600 mb-6">
              OTP sent to {phoneNumber}
            </p>

            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                6-Digit OTP
              </label>
              <input
                type="text"
                placeholder="000000"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                maxLength={6}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-2xl tracking-widest focus:ring-2 focus:ring-[#FFE500] focus:border-transparent outline-none"
                autoFocus
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg mb-4 text-sm">
                {error}
              </div>
            )}

            {success && (
              <div className="bg-green-50 border border-green-200 text-green-700 p-3 rounded-lg mb-4 text-sm">
                {success}
              </div>
            )}

            <button
              onClick={handleVerifyOTP}
              disabled={loading || otp.length !== 6}
              className="w-full bg-[#FFE500] text-black py-3 rounded-lg font-semibold hover:bg-[#f5dc00] transition disabled:opacity-50 disabled:cursor-not-allowed mb-3"
            >
              {loading ? 'Verifying...' : 'Verify OTP'}
            </button>

            <button
              onClick={handleResendOTP}
              disabled={loading}
              className="w-full text-gray-600 py-2 hover:text-gray-900 transition disabled:opacity-50"
            >
              Resend OTP
            </button>

            <button
              onClick={() => {
                setStep('phone');
                setOtp('');
                setError('');
                setSuccess('');
              }}
              className="w-full text-gray-600 py-2 mt-2 hover:text-gray-900 transition"
            >
              Change Number
            </button>
          </div>
        )}
      </div>
    </>
  );
}
