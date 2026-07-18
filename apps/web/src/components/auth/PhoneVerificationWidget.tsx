'use client';

import { useState, useEffect } from 'react';
import Script from 'next/script';

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

interface PhoneVerificationWidgetProps {
  onSuccess?: (data: any) => void;
  onFailure?: (error: any) => void;
  phoneNumber?: string;
}

export function PhoneVerificationWidget({
  onSuccess,
  onFailure,
  phoneNumber,
}: PhoneVerificationWidgetProps) {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (isLoaded && typeof window !== 'undefined') {
      // Initialize MSG91 widget
      const configuration = {
        widgetId: process.env.NEXT_PUBLIC_MSG91_WIDGET_ID,
        tokenAuth: process.env.NEXT_PUBLIC_MSG91_WIDGET_TOKEN, // Widget token for client-side auth
        identifier: phoneNumber || '',
        exposeMethods: true, // Enable custom UI
        captchaRenderId: 'msg91-captcha',
        success: (data: any) => {
          console.log('[MSG91] Verification success:', data);
          if (onSuccess) onSuccess(data);
        },
        failure: (error: any) => {
          console.error('[MSG91] Verification failed:', error);
          if (onFailure) onFailure(error);
        },
      };

      if (window.initSendOTP) {
        window.initSendOTP(configuration);
      }
    }
  }, [isLoaded, phoneNumber, onSuccess, onFailure]);

  return (
    <>
      <Script
        src="https://verify.msg91.com/otp-provider.js"
        onLoad={() => setIsLoaded(true)}
        strategy="afterInteractive"
      />
      <div id="msg91-captcha" />
    </>
  );
}
