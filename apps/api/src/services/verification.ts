import { prisma } from "../lib/prisma.js";
import { sendEmail } from "../lib/email.js";
import { sendWelcomeEmail } from "./email-notifications.js";
import { sendOTPViaMSG91 } from "./msg91.js";
import crypto from "crypto";
import bcrypt from "bcrypt";

const OTP_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const PHONE_VERIFICATION_MINUTES = 60;
const BCRYPT_ROUNDS = 10; // Standard bcrypt rounds for security

/**
 * Generate a 6-digit OTP code
 */
function generateOTP(): string {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Hash OTP code using bcrypt for secure storage
 */
async function hashOTP(code: string): Promise<string> {
  return await bcrypt.hash(code, BCRYPT_ROUNDS);
}

/**
 * Verify OTP code against hashed value
 */
async function verifyOTPHash(code: string, hashedCode: string): Promise<boolean> {
  return await bcrypt.compare(code, hashedCode);
}

/**
 * Send email OTP for signup verification
 */
export async function sendEmailOTP(userId: string, email: string): Promise<void> {
  // Invalidate any existing email verification codes for this user
  await prisma.verificationCode.updateMany({
    where: {
      userId,
      type: "email",
      verified: false,
    },
    data: {
      verified: true, // Mark as used
    },
  });

  const code = generateOTP();
  const hashedCode = await hashOTP(code); // Hash OTP before storing
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Create new verification code with hashed OTP
  await prisma.verificationCode.create({
    data: {
      userId,
      type: "email",
      code: hashedCode, // Store hashed OTP, not plain text
      target: email,
      expiresAt,
    },
  });

  console.log(`[Verification] Email OTP generated for ${email} (hashed and stored securely)`);

  // Send email with plain OTP (user needs to see it)
  await sendEmail({
    to: email,
    subject: "Verify your Practers account",
    isAuthEmail: true, // Use auth API key
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4A7CFF;">Welcome to Practers!</h2>
        <p>Your verification code is:</p>
        <div style="background: #f4f5f7; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 20px 0;">
          ${code}
        </div>
        <p>This code will expire in ${OTP_EXPIRY_MINUTES} minutes.</p>
        <p>If you didn't request this code, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
        <p style="color: #666; font-size: 12px;">© 2026 Practers. All rights reserved.</p>
      </div>
    `,
  });
}

/**
 * Send email OTP for company signup verification
 */
export async function sendCompanyEmailOTP(companyId: string, email: string): Promise<void> {
  await prisma.companyVerificationCode.updateMany({
    where: {
      companyId,
      type: "email",
      verified: false,
    },
    data: {
      verified: true,
    },
  });

  const code = generateOTP();
  const hashedCode = await hashOTP(code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await prisma.companyVerificationCode.create({
    data: {
      companyId,
      type: "email",
      code: hashedCode,
      target: email,
      expiresAt,
    },
  });

  await sendEmail({
    to: email,
    subject: "Verify your Practers company account",
    isAuthEmail: true,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4A7CFF;">Verify your company email</h2>
        <p>Your verification code is:</p>
        <div style="background: #f4f5f7; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 20px 0;">
          ${code}
        </div>
        <p>This code will expire in ${OTP_EXPIRY_MINUTES} minutes.</p>
        <p>If you didn't request this code, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
        <p style="color: #666; font-size: 12px;">© 2026 Practers. All rights reserved.</p>
      </div>
    `,
  });
}

export async function sendCompanyMemberEmailOTP(companyAccountId: string, email: string): Promise<void> {
  await (prisma as any).companyMemberVerificationCode.updateMany({
    where: {
      companyAccountId,
      type: "email",
      verified: false,
    },
    data: {
      verified: true,
    },
  });

  const code = generateOTP();
  const hashedCode = await hashOTP(code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await (prisma as any).companyMemberVerificationCode.create({
    data: {
      companyAccountId,
      type: "email",
      code: hashedCode,
      target: email,
      expiresAt,
    },
  });

  await sendEmail({
    to: email,
    subject: "Verify your Practers company workspace account",
    isAuthEmail: true,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4A7CFF;">Verify your company workspace email</h2>
        <p>Your verification code is:</p>
        <div style="background: #f4f5f7; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 20px 0;">
          ${code}
        </div>
        <p>This code will expire in ${OTP_EXPIRY_MINUTES} minutes.</p>
        <p>If you didn't request this code, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
        <p style="color: #666; font-size: 12px;">© 2026 Practers. All rights reserved.</p>
      </div>
    `,
  });
}

/**
 * Verify email OTP
 */
export async function verifyEmailOTP(userId: string, code: string): Promise<boolean> {
  // Get all non-verified codes for this user (need to check hash for each)
  const verifications = await prisma.verificationCode.findMany({
    where: {
      userId,
      type: "email",
      verified: false,
      expiresAt: {
        gt: new Date(),
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (verifications.length === 0) {
    console.log(`[Verification] No valid email OTP found for user ${userId}`);
    return false;
  }

  // Find the verification code that matches the hash
  let matchedVerification = null;
  for (const verification of verifications) {
    const isMatch = await verifyOTPHash(code, verification.code);
    if (isMatch) {
      matchedVerification = verification;
      break;
    }
  }

  if (!matchedVerification) {
    console.log(`[Verification] Invalid email OTP provided for user ${userId}`);
    
    // Increment attempts on all non-verified codes
    await prisma.verificationCode.updateMany({
      where: {
        userId,
        type: "email",
        verified: false,
      },
      data: {
        attempts: {
          increment: 1,
        },
      },
    });
    return false;
  }

  // Check max attempts
  if (matchedVerification.attempts >= MAX_ATTEMPTS) {
    console.log(`[Verification] Max attempts exceeded for user ${userId}`);
    throw new Error("Maximum verification attempts exceeded. Please request a new code.");
  }

  // Mark as verified
  await prisma.verificationCode.update({
    where: { id: matchedVerification.id },
    data: { verified: true },
  });

  // Update user email verification status in our database
  await prisma.user.update({
    where: { id: userId },
    data: {
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
  });

  // CRITICAL: Confirm email in Supabase so user can sign in
  try {
    const { getSupabaseAdmin } = await import("../lib/supabase.js");
    const supabase = getSupabaseAdmin();
    
    await supabase.auth.admin.updateUserById(userId, {
      email_confirm: true,
    });
    
    console.log(`[Verification] Email confirmed in Supabase for user ${userId}`);
  } catch (supabaseError) {
    console.error("[Verification] Failed to confirm email in Supabase:", supabaseError);
    // Don't throw - verification was successful in our system
  }

  console.log(`[Verification] Email verified successfully for user ${userId}`);

  // Welcome email is sent from the route handler, not here
  // This prevents duplicate emails

  return true;
}

/**
 * Verify company email OTP
 */
export async function verifyCompanyEmailOTP(companyId: string, code: string): Promise<boolean> {
  const verifications = await prisma.companyVerificationCode.findMany({
    where: {
      companyId,
      type: "email",
      verified: false,
      expiresAt: {
        gt: new Date(),
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (verifications.length === 0) {
    return false;
  }

  let matchedVerification = null;
  for (const verification of verifications) {
    const isMatch = await verifyOTPHash(code, verification.code);
    if (isMatch) {
      matchedVerification = verification;
      break;
    }
  }

  if (!matchedVerification) {
    await prisma.companyVerificationCode.updateMany({
      where: {
        companyId,
        type: "email",
        verified: false,
      },
      data: {
        attempts: {
          increment: 1,
        },
      },
    });
    return false;
  }

  if (matchedVerification.attempts >= MAX_ATTEMPTS) {
    throw new Error("Maximum verification attempts exceeded. Please request a new code.");
  }

  await prisma.companyVerificationCode.update({
    where: { id: matchedVerification.id },
    data: { verified: true },
  });

  await prisma.company.update({
    where: { id: companyId },
    data: {
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
  });

  try {
    const { getSupabaseAdmin } = await import("../lib/supabase.js");
    const supabase = getSupabaseAdmin();

    await supabase.auth.admin.updateUserById(companyId, {
      email_confirm: true,
    });
  } catch (supabaseError) {
    console.error("[Verification] Failed to confirm company email in Supabase:", supabaseError);
  }

  return true;
}

export async function verifyCompanyMemberEmailOTP(companyAccountId: string, code: string): Promise<boolean> {
  const verifications = await (prisma as any).companyMemberVerificationCode.findMany({
    where: {
      companyAccountId,
      type: "email",
      verified: false,
      expiresAt: {
        gt: new Date(),
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (verifications.length === 0) {
    return false;
  }

  let matchedVerification = null;
  for (const verification of verifications) {
    const isMatch = await verifyOTPHash(code, verification.code);
    if (isMatch) {
      matchedVerification = verification;
      break;
    }
  }

  if (!matchedVerification) {
    await (prisma as any).companyMemberVerificationCode.updateMany({
      where: {
        companyAccountId,
        type: "email",
        verified: false,
      },
      data: {
        attempts: {
          increment: 1,
        },
      },
    });
    return false;
  }

  if (matchedVerification.attempts >= MAX_ATTEMPTS) {
    throw new Error("Maximum verification attempts exceeded. Please request a new code.");
  }

  await (prisma as any).companyMemberVerificationCode.update({
    where: { id: matchedVerification.id },
    data: { verified: true },
  });

  await (prisma as any).companyMemberAccount.update({
    where: { id: companyAccountId },
    data: {
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
  });

  try {
    const { getSupabaseAdmin } = await import("../lib/supabase.js");
    const supabase = getSupabaseAdmin();

    await supabase.auth.admin.updateUserById(companyAccountId, {
      email_confirm: true,
    });
  } catch (supabaseError) {
    console.error("[Verification] Failed to confirm company member email in Supabase:", supabaseError);
  }

  try {
    const { linkPendingTeamInvitationsForCompanyAccount } = await import("./team-invitations.js");
    await linkPendingTeamInvitationsForCompanyAccount({
      companyAccountId,
      email: matchedVerification.target,
    });
  } catch (err) {
    console.error("[Verification] Failed to link pending company team invitations after member verification");
  }

  return true;
}

/**
 * Send phone OTP for phone verification
 * Note: In production, integrate with Twilio, AWS SNS, or similar service
 */
export async function sendPhoneOTP(userId: string, phoneNumber: string): Promise<void> {
  // Validate phone number format (basic validation)
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  if (!phoneRegex.test(phoneNumber)) {
    throw new Error("Invalid phone number format. Please use international format (e.g., +1234567890)");
  }

  // Check if phone is already verified by another user
  const existingUser = await prisma.user.findFirst({
    where: {
      mobile: phoneNumber,
      mobileVerified: true,
      id: { not: userId },
    },
  });

  if (existingUser) {
    throw new Error("This phone number is already verified by another account");
  }

  // Invalidate any existing phone verification codes for this user
  await prisma.verificationCode.updateMany({
    where: {
      userId,
      type: "phone",
      verified: false,
    },
    data: {
      verified: true, // Mark as used
    },
  });

  const code = generateOTP();
  const hashedCode = await hashOTP(code); // Hash OTP before storing
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Create new verification code with hashed OTP
  await prisma.verificationCode.create({
    data: {
      userId,
      type: "phone",
      code: hashedCode, // Store hashed OTP, not plain text
      target: phoneNumber,
      expiresAt,
    },
  });

  console.log(`[Verification] Phone OTP generated for ${phoneNumber} (hashed and stored securely)`);

  // Send OTP via MSG91 if credentials are configured
  const msg91AuthKey = process.env.MSG91_AUTH_KEY;
  console.log(`[Verification] MSG91_AUTH_KEY is ${msg91AuthKey ? 'SET (' + msg91AuthKey.substring(0, 10) + '...)' : 'NOT SET'}`);
  
  if (msg91AuthKey) {
    try {
      const result = await sendOTPViaMSG91(phoneNumber);
      
      if (!result.success) {
        // Log error but also show code in development for fallback
        console.error(`[MSG91] Failed to send SMS: ${result.message}`);
        if (process.env.NODE_ENV === 'development') {
          console.log(`[DEV] Fallback - Phone verification code for ${phoneNumber}: ${code}`);
        }
        throw new Error(`Failed to send SMS: ${result.message}`);
      }
      
      console.log(`[Verification] Phone OTP sent via MSG91 to ${phoneNumber}`);
      
      // In development, also log the code for easy testing
      if (process.env.NODE_ENV === 'development') {
        console.log(`[DEV] Phone verification code for ${phoneNumber}: ${code}`);
      }
    } catch (error: any) {
      console.error(`[MSG91] Error sending SMS:`, error.message);
      // In development, allow fallback to console
      if (process.env.NODE_ENV === 'development') {
        console.log(`[DEV] Fallback - Phone verification code for ${phoneNumber}: ${code}`);
        console.log(`[DEV] SMS failed but continuing in development mode`);
      } else {
        // In production, fail hard
        throw error;
      }
    }
  } else {
    // No MSG91 credentials: Log OTP to console only (development only)
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEV] Phone verification code for ${phoneNumber}: ${code}`);
      console.log(`[DEV] MSG91 not configured - add MSG91_AUTH_KEY to enable SMS`);
    } else {
      throw new Error('MSG91 is not configured. Cannot send SMS in production.');
    }
  }
}

/**
 * Verify phone OTP and grant interview minutes
 */
export async function verifyPhoneOTP(userId: string, code: string): Promise<{ success: boolean; minutesGranted: number }> {
  // Get all non-verified codes for this user (need to check hash for each)
  const verifications = await prisma.verificationCode.findMany({
    where: {
      userId,
      type: "phone",
      verified: false,
      expiresAt: {
        gt: new Date(),
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (verifications.length === 0) {
    console.log(`[Verification] No valid phone OTP found for user ${userId}`);
    return { success: false, minutesGranted: 0 };
  }

  // Find the verification code that matches the hash
  let matchedVerification = null;
  for (const verification of verifications) {
    const isMatch = await verifyOTPHash(code, verification.code);
    if (isMatch) {
      matchedVerification = verification;
      break;
    }
  }

  if (!matchedVerification) {
    console.log(`[Verification] Invalid phone OTP provided for user ${userId}`);
    
    // Increment attempts on all non-verified codes
    await prisma.verificationCode.updateMany({
      where: {
        userId,
        type: "phone",
        verified: false,
      },
      data: {
        attempts: {
          increment: 1,
        },
      },
    });
    return { success: false, minutesGranted: 0 };
  }

  // Check max attempts
  if (matchedVerification.attempts >= MAX_ATTEMPTS) {
    console.log(`[Verification] Max attempts exceeded for user ${userId}`);
    throw new Error("Maximum verification attempts exceeded. Please request a new code.");
  }

  // Mark as verified
  await prisma.verificationCode.update({
    where: { id: matchedVerification.id },
    data: { verified: true },
  });

  // Update user phone verification status
  await prisma.user.update({
    where: { id: userId },
    data: {
      mobile: matchedVerification.target,
      mobileVerified: true,
      mobileVerifiedAt: new Date(),
    },
  });

  console.log(`[Verification] Phone verified successfully for user ${userId}`);

  // Grant interview minutes
  const wallet = await prisma.creditWallet.upsert({
    where: { userId },
    create: {
      userId,
      freeCreditsRemaining: PHONE_VERIFICATION_MINUTES,
    },
    update: {
      freeCreditsRemaining: {
        increment: PHONE_VERIFICATION_MINUTES,
      },
    },
  });

  // Log minute transaction
  await prisma.creditLedger.create({
    data: {
      userId,
      walletId: wallet.id,
      bucket: "FREE",
      delta: PHONE_VERIFICATION_MINUTES,
      reason: "PHONE_VERIFICATION_MINUTES_REWARD",
      balanceAfter: {
        FREE: wallet.freeCreditsRemaining,
        MONTHLY: 0,
        PURCHASED: 0,
      },
    },
  });

  return { success: true, minutesGranted: PHONE_VERIFICATION_MINUTES };
}

/**
 * Check if user can make purchases (must have verified phone)
 */
export async function canMakePurchase(userId: string): Promise<{ allowed: boolean; reason?: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mobileVerified: true },
  });

  if (!user) {
    return { allowed: false, reason: "User not found" };
  }

  if (!user.mobileVerified) {
    return { allowed: false, reason: "Phone verification required before making purchases" };
  }

  return { allowed: true };
}

/**
 * Resend verification code (with rate limiting)
 */
export async function canResendCode(userId: string, type: "email" | "phone"): Promise<{ allowed: boolean; waitSeconds?: number }> {
  const lastCode = await prisma.verificationCode.findFirst({
    where: {
      userId,
      type,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!lastCode) {
    return { allowed: true };
  }

  const RESEND_COOLDOWN_SECONDS = 60; // 1 minute cooldown
  const timeSinceLastCode = Date.now() - lastCode.createdAt.getTime();
  const cooldownRemaining = RESEND_COOLDOWN_SECONDS * 1000 - timeSinceLastCode;

  if (cooldownRemaining > 0) {
    return {
      allowed: false,
      waitSeconds: Math.ceil(cooldownRemaining / 1000),
    };
  }

  return { allowed: true };
}

/**
 * Resend company verification code (with rate limiting)
 */
export async function canResendCompanyCode(companyId: string): Promise<{ allowed: boolean; waitSeconds?: number }> {
  const lastCode = await prisma.companyVerificationCode.findFirst({
    where: {
      companyId,
      type: "email",
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!lastCode) {
    return { allowed: true };
  }

  const RESEND_COOLDOWN_SECONDS = 60;
  const timeSinceLastCode = Date.now() - lastCode.createdAt.getTime();
  const cooldownRemaining = RESEND_COOLDOWN_SECONDS * 1000 - timeSinceLastCode;

  if (cooldownRemaining > 0) {
    return {
      allowed: false,
      waitSeconds: Math.ceil(cooldownRemaining / 1000),
    };
  }

  return { allowed: true };
}

export async function canResendCompanyMemberCode(companyAccountId: string): Promise<{ allowed: boolean; waitSeconds?: number }> {
  const lastCode = await (prisma as any).companyMemberVerificationCode.findFirst({
    where: {
      companyAccountId,
      type: "email",
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!lastCode) {
    return { allowed: true };
  }

  const RESEND_COOLDOWN_SECONDS = 60;
  const timeSinceLastCode = Date.now() - lastCode.createdAt.getTime();
  const cooldownRemaining = RESEND_COOLDOWN_SECONDS * 1000 - timeSinceLastCode;

  if (cooldownRemaining > 0) {
    return {
      allowed: false,
      waitSeconds: Math.ceil(cooldownRemaining / 1000),
    };
  }

  return { allowed: true };
}
