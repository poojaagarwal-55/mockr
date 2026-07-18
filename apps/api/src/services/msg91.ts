import axios from 'axios';

const MSG91_API_URL = 'https://control.msg91.com/api/v5';

// Lazy getters to ensure env is loaded first
const getMSG91WidgetId = () => process.env.MSG91_WIDGET_ID;
const getMSG91AuthKey = () => process.env.MSG91_AUTH_KEY;

interface SendOTPResponse {
  type: string;
  message: string;
  request_id?: string;
}

interface VerifyOTPResponse {
  type: string;
  message: string;
}

interface VerifyAccessTokenResponse {
  type: string;
  message: string;
  data?: {
    mobile: string;
    verified: boolean;
  };
}

/**
 * Verify MSG91 Widget Access Token (for widget-based OTP)
 */
export async function verifyMSG91AccessToken(
  accessToken: string
): Promise<{ success: boolean; mobile?: string; message: string }> {
  const MSG91_AUTH_KEY = getMSG91AuthKey();
  
  console.log('[MSG91] verifyAccessToken called');
  console.log('[MSG91] Access token (first 50 chars):', accessToken?.substring(0, 50) + '...');
  console.log('[MSG91] Access token length:', accessToken?.length);
  console.log('[MSG91] Access token type:', typeof accessToken);
  console.log('[MSG91] Auth key configured:', !!MSG91_AUTH_KEY);
  
  if (!MSG91_AUTH_KEY) {
    console.warn('[MSG91] authkey not configured');
    return {
      success: false,
      message: 'SMS service not configured',
    };
  }

  try {
    console.log('[MSG91] Calling MSG91 verifyAccessToken API...');
    const response = await axios.post<VerifyAccessTokenResponse>(
      'https://control.msg91.com/api/v5/widget/verifyAccessToken',
      {
        authkey: MSG91_AUTH_KEY,
        'access-token': accessToken,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('[MSG91] Access token verified:', response.data);

    // MSG91 returns the phone number in the 'message' field when type is 'success'
    if (response.data.type === 'success' && response.data.message) {
      return {
        success: true,
        mobile: response.data.message, // Phone number is in 'message' field
        message: 'Phone verified successfully',
      };
    }

    return {
      success: false,
      message: response.data.message || 'Verification failed',
    };
  } catch (error: any) {
    console.error('[MSG91] Access token verification failed:', error.response?.data || error.message);
    console.error('[MSG91] Error status:', error.response?.status);
    console.error('[MSG91] Error details:', JSON.stringify(error.response?.data, null, 2));
    
    return {
      success: false,
      message: error.response?.data?.message || 'Invalid access token',
    };
  }
}

/**
 * Send OTP via MSG91
 */
export async function sendOTPViaMSG91(
  mobile: string
): Promise<{ success: boolean; requestId?: string; message: string }> {
  const MSG91_AUTH_KEY = getMSG91AuthKey();
  const MSG91_WIDGET_ID = getMSG91WidgetId();
  
  if (!MSG91_AUTH_KEY) {
    console.warn('[MSG91] authkey not configured');
    return {
      success: false,
      message: 'SMS service not configured',
    };
  }

  try {
    // Remove + from country code and any spaces
    const cleanMobile = mobile.replace(/[^0-9]/g, '');

    console.log('[MSG91] Sending OTP to:', cleanMobile);
    console.log('[MSG91] Using authkey:', MSG91_AUTH_KEY.substring(0, 10) + '...');
    console.log('[MSG91] Widget ID:', MSG91_WIDGET_ID || 'NOT SET');

    const response = await axios.post<SendOTPResponse>(
      `${MSG91_API_URL}/otp`,
      {
        mobile: cleanMobile,
        ...(MSG91_WIDGET_ID && { template_id: MSG91_WIDGET_ID }),
      },
      {
        headers: {
          'authkey': MSG91_AUTH_KEY, // MSG91 uses 'authkey' header
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('[MSG91] OTP sent successfully:', response.data);

    return {
      success: true,
      requestId: response.data.request_id,
      message: 'OTP sent successfully',
    };
  } catch (error: any) {
    console.error('[MSG91] Failed to send OTP:', error.response?.data || error.message);
    
    return {
      success: false,
      message: error.response?.data?.message || 'Failed to send OTP',
    };
  }
}

/**
 * Verify OTP via MSG91
 */
export async function verifyOTPViaMSG91(
  mobile: string,
  otp: string
): Promise<{ success: boolean; message: string }> {
  const MSG91_AUTH_KEY = getMSG91AuthKey();
  
  if (!MSG91_AUTH_KEY) {
    console.warn('[MSG91] authkey not configured');
    return {
      success: false,
      message: 'SMS service not configured',
    };
  }

  try {
    const cleanMobile = mobile.replace(/[^0-9]/g, '');

    const response = await axios.post<VerifyOTPResponse>(
      `${MSG91_API_URL}/otp/verify`,
      {
        mobile: cleanMobile,
        otp: otp,
      },
      {
        headers: {
          'authkey': MSG91_AUTH_KEY, // MSG91 uses 'authkey' header
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('[MSG91] OTP verified successfully:', response.data);

    return {
      success: true,
      message: 'OTP verified successfully',
    };
  } catch (error: any) {
    console.error('[MSG91] OTP verification failed:', error.response?.data || error.message);
    
    return {
      success: false,
      message: error.response?.data?.message || 'Invalid OTP',
    };
  }
}

/**
 * Resend OTP via MSG91
 */
export async function resendOTPViaMSG91(
  mobile: string,
  channel: 'sms' | 'voice' = 'sms'
): Promise<{ success: boolean; message: string }> {
  const MSG91_AUTH_KEY = getMSG91AuthKey();
  
  if (!MSG91_AUTH_KEY) {
    console.warn('[MSG91] authkey not configured');
    return {
      success: false,
      message: 'SMS service not configured',
    };
  }

  try {
    const cleanMobile = mobile.replace(/[^0-9]/g, '');

    const response = await axios.post(
      `${MSG91_API_URL}/otp/retry`,
      {
        mobile: cleanMobile,
        retrytype: channel,
      },
      {
        headers: {
          'authkey': MSG91_AUTH_KEY, // MSG91 uses 'authkey' header
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('[MSG91] OTP resent successfully:', response.data);

    return {
      success: true,
      message: 'OTP resent successfully',
    };
  } catch (error: any) {
    console.error('[MSG91] Failed to resend OTP:', error.response?.data || error.message);
    
    return {
      success: false,
      message: error.response?.data?.message || 'Failed to resend OTP',
    };
  }
}
