import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  sendEmailOTP,
  verifyEmailOTP,
  sendPhoneOTP,
  verifyPhoneOTP,
  canResendCode,
} from "../services/verification.js";
import { checkRateLimit } from "../lib/rate-limiter.js";

const verificationRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── PUBLIC: Send email OTP during signup (no auth required) ───────────
  fastify.post(
    "/email/send-public",
    async (request, reply) => {
      const schema = z.object({
        email: z.string().email("Invalid email address"),
      });

      try {
        const { email } = schema.parse(request.body);

        // IP-based rate limiting to prevent duplicate requests (5 requests per 60 seconds per IP)
        const ipRateLimit = checkRateLimit(`verification:email:${request.ip}`, 5, 60_000);
        if (!ipRateLimit.allowed) {
          return reply.status(429).send({
            error: "Too Many Requests",
            message: `Too many verification requests. Please wait ${Math.ceil(ipRateLimit.retryAfterMs / 1000)}s.`,
          });
        }

        // Find user by email
        const user = await request.prisma.user.findUnique({
          where: { email },
        });

        if (!user) {
          return reply.status(404).send({ error: "User not found" });
        }

        // Check if already verified
        if (user.emailVerified) {
          return reply.status(400).send({ error: "Email already verified" });
        }

        // Check rate limiting (per user)
        const canResend = await canResendCode(user.id, "email");
        if (!canResend.allowed) {
          return reply.status(429).send({
            error: `Please wait ${canResend.waitSeconds} seconds before requesting a new code`,
          });
        }

        await sendEmailOTP(user.id, user.email);

        return { success: true, message: "Verification code sent to your email" };
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({ error: error.message || "Failed to send verification code" });
      }
    }
  );

  // ─── PUBLIC: Verify email OTP during signup (no auth required) ─────────
  fastify.post(
    "/email/verify-public",
    async (request, reply) => {
      const schema = z.object({
        email: z.string().email("Invalid email address"),
        code: z.string().length(6, "Code must be 6 digits"),
        devSkip: z.boolean().optional(),
      });

      try {
        const { email, code, devSkip } = schema.parse(request.body);
        
        // Find user by email
        const user = await request.prisma.user.findUnique({
          where: { email },
        });

        if (!user) {
          return reply.status(404).send({ error: "User not found" });
        }

        // Check if already verified
        if (user.emailVerified) {
          return reply.status(400).send({ error: "Email already verified" });
        }

        if (devSkip) {
          if (process.env.NODE_ENV !== "development") {
            return reply.status(403).send({ error: "Dev skip is not available" });
          }

          if (code !== "000000") {
            return reply.status(400).send({ error: "Invalid dev skip code" });
          }

          await request.prisma.user.update({
            where: { id: user.id },
            data: {
              emailVerified: true,
              emailVerifiedAt: new Date(),
            },
          });

          try {
            const { getSupabaseAdmin } = await import("../lib/supabase.js");
            const supabase = getSupabaseAdmin();

            await supabase.auth.admin.updateUserById(user.id, {
              email_confirm: true,
            });
          } catch (supabaseError) {
            fastify.log.error(supabaseError);
          }

          return { success: true, message: "Email verified successfully" };
        }

        const verified = await verifyEmailOTP(user.id, code);

        if (!verified) {
          return reply.status(400).send({ error: "Invalid or expired verification code" });
        }

        // Send welcome email ONCE after successful verification (async, don't block response)
        (async () => {
          try {
            const { sendWelcomeEmail } = await import("../services/email-notifications.js");
            await sendWelcomeEmail(user.email, user.fullName);
            fastify.log.info({ userId: user.id }, "Welcome email sent after email verification");
          } catch (err) {
            fastify.log.error(err, "Failed to send welcome email after verification");
          }
        })();

        return { success: true, message: "Email verified successfully" };
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(400).send({ error: error.message || "Verification failed" });
      }
    }
  );

  // Send email OTP
  fastify.post(
    "/email/send",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      if (!request.user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      try {
        // Fetch full user from database
        const user = await request.prisma.user.findUnique({
          where: { id: request.user.id },
        });

        if (!user) {
          return reply.status(404).send({ error: "User not found" });
        }

        // Check if already verified
        if (user.emailVerified) {
          return reply.status(400).send({ error: "Email already verified" });
        }

        // Check rate limiting
        const canResend = await canResendCode(user.id, "email");
        if (!canResend.allowed) {
          return reply.status(429).send({
            error: `Please wait ${canResend.waitSeconds} seconds before requesting a new code`,
          });
        }

        await sendEmailOTP(user.id, user.email);

        return { success: true, message: "Verification code sent to your email" };
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({ error: error.message || "Failed to send verification code" });
      }
    }
  );

  // Verify email OTP
  fastify.post(
    "/email/verify",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      if (!request.user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const schema = z.object({
        code: z.string().length(6, "Code must be 6 digits"),
      });

      try {
        const { code } = schema.parse(request.body);
        
        // Fetch full user from database
        const user = await request.prisma.user.findUnique({
          where: { id: request.user.id },
        });

        if (!user) {
          return reply.status(404).send({ error: "User not found" });
        }

        // Check if already verified
        if (user.emailVerified) {
          return reply.status(400).send({ error: "Email already verified" });
        }

        const verified = await verifyEmailOTP(user.id, code);

        if (!verified) {
          return reply.status(400).send({ error: "Invalid or expired verification code" });
        }

        // Welcome email already sent by public endpoint - don't send again

        return { success: true, message: "Email verified successfully" };
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(400).send({ error: error.message || "Verification failed" });
      }
    }
  );

  // Send phone OTP
  fastify.post(
    "/phone/send",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      if (!request.user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const schema = z.object({
        phoneNumber: z.string().min(10, "Invalid phone number"),
      });

      try {
        const { phoneNumber } = schema.parse(request.body);
        
        // Fetch full user from database
        const user = await request.prisma.user.findUnique({
          where: { id: request.user.id },
        });

        if (!user) {
          return reply.status(404).send({ error: "User not found" });
        }

        // Check if already verified
        if (user.mobileVerified) {
          return reply.status(400).send({ error: "Phone number already verified" });
        }

        // Check rate limiting
        const canResend = await canResendCode(user.id, "phone");
        if (!canResend.allowed) {
          return reply.status(429).send({
            error: `Please wait ${canResend.waitSeconds} seconds before requesting a new code`,
          });
        }

        await sendPhoneOTP(user.id, phoneNumber);

        return {
          success: true,
          message: "Verification code sent to your phone",
          // In development, you might want to return the code for testing
          // Remove this in production!
          ...(process.env.NODE_ENV === "development" && { devNote: "Check server logs for OTP code" }),
        };
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(400).send({ error: error.message || "Failed to send verification code" });
      }
    }
  );

  // Verify phone OTP
  fastify.post(
    "/phone/verify",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      if (!request.user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const schema = z.object({
        code: z.string().length(6, "Code must be 6 digits"),
      });

      try {
        const { code } = schema.parse(request.body);
        
        // Fetch full user from database
        const user = await request.prisma.user.findUnique({
          where: { id: request.user.id },
        });

        if (!user) {
          return reply.status(404).send({ error: "User not found" });
        }

        // Check if already verified
        if (user.mobileVerified) {
          return reply.status(400).send({ error: "Phone number already verified" });
        }

        const result = await verifyPhoneOTP(user.id, code);

        if (!result.success) {
          return reply.status(400).send({ error: "Invalid or expired verification code" });
        }

        return {
          success: true,
          message: "Phone verified successfully",
          minutesGranted: result.minutesGranted,
        };
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(400).send({ error: error.message || "Verification failed" });
      }
    }
  );

  // Get verification status
  fastify.get(
    "/status",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      if (!request.user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      // Fetch full user from database
      const user = await request.prisma.user.findUnique({
        where: { id: request.user.id },
      });

      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }

      return {
        emailVerified: user.emailVerified || false,
        phoneVerified: user.mobileVerified || false,
        email: user.email,
        phone: user.mobile || null,
      };
    }
  );

  // Complete phone verification after MSG91 success
  fastify.post(
    "/phone/complete",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      if (!request.user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const schema = z.object({
        phoneNumber: z.string().min(10, "Invalid phone number"),
        msg91Data: z.any().optional(), // MSG91 verification response
      });

      try {
        const { phoneNumber, msg91Data } = schema.parse(request.body);
        
        const user = await request.prisma.user.findUnique({
          where: { id: request.user.id },
        });

        if (!user) {
          return reply.status(404).send({ error: "User not found" });
        }

        // Check if phone already verified by another user
        const existingUser = await request.prisma.user.findFirst({
          where: {
            mobile: phoneNumber,
            mobileVerified: true,
            id: { not: user.id },
          },
        });

        if (existingUser) {
          return reply.status(400).send({
            error: "This phone number is already verified by another account",
          });
        }

        // Update user with verified phone
        await request.prisma.user.update({
          where: { id: user.id },
          data: {
            mobile: phoneNumber,
            mobileVerified: true,
            mobileVerifiedAt: new Date(),
          },
        });

        // Grant interview minutes
        const PHONE_VERIFICATION_MINUTES = 60;
        const wallet = await request.prisma.creditWallet.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            freeCreditsRemaining: PHONE_VERIFICATION_MINUTES,
          },
          update: {
            freeCreditsRemaining: {
              increment: PHONE_VERIFICATION_MINUTES,
            },
          },
        });

        // Log minute transaction
        await request.prisma.creditLedger.create({
          data: {
            userId: user.id,
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

        fastify.log.info({ userId: user.id }, "Phone verification completed via MSG91");

        return {
          success: true,
          message: "Phone verified successfully",
          minutesGranted: PHONE_VERIFICATION_MINUTES,
        };
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(400).send({
          error: error.message || "Verification failed",
        });
      }
    }
  );

  // Verify MSG91 Widget Access Token
  fastify.post(
    "/phone/verify-widget",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      if (!request.user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const schema = z.object({
        accessToken: z.string().min(1, "Access token is required"),
      });

      try {
        const { accessToken } = schema.parse(request.body);
        
        console.log('[Verification] Received access token verification request');
        console.log('[Verification] Access token length:', accessToken?.length);
        
        const user = await request.prisma.user.findUnique({
          where: { id: request.user.id },
        });

        if (!user) {
          return reply.status(404).send({ error: "User not found" });
        }

        // Check if already verified
        if (user.mobileVerified) {
          return reply.status(400).send({ error: "Phone number already verified" });
        }

        // Verify access token with MSG91
        const { verifyMSG91AccessToken } = await import("../services/msg91.js");
        console.log('[Verification] Calling MSG91 verifyAccessToken...');
        const result = await verifyMSG91AccessToken(accessToken);
        
        console.log('[Verification] MSG91 result:', result);

        if (!result.success || !result.mobile) {
          console.error('[Verification] MSG91 verification failed:', result.message);
          return reply.status(400).send({ error: result.message || "Verification failed" });
        }

        // Check if phone already verified by another user
        const existingUser = await request.prisma.user.findFirst({
          where: {
            mobile: result.mobile,
            mobileVerified: true,
            id: { not: user.id },
          },
        });

        console.log('[Verification] Existing user check:', existingUser ? 'FOUND - duplicate phone' : 'NOT FOUND - phone available');

        if (existingUser) {
          console.error('[Verification] Duplicate phone number:', result.mobile);
          return reply.status(400).send({
            error: "This phone number is already verified by another account",
          });
        }

        console.log('[Verification] Updating user with verified phone...');

        // Update user with verified phone
        const updatedUser = await request.prisma.user.update({
          where: { id: user.id },
          data: {
            mobile: result.mobile,
            mobileVerified: true,
            mobileVerifiedAt: new Date(),
          },
        });

        console.log('[Verification] ✅ User updated successfully');
        console.log('[Verification] User details:', {
          id: updatedUser.id,
          mobile: updatedUser.mobile,
          mobileVerified: updatedUser.mobileVerified,
          mobileVerifiedAt: updatedUser.mobileVerifiedAt
        });

        // Grant interview minutes
        const PHONE_VERIFICATION_MINUTES = 60;
        console.log('[Verification] Starting interview minute grant process...');
        console.log('[Verification] Minutes to grant:', PHONE_VERIFICATION_MINUTES);

        // First, check if wallet exists
        const existingWallet = await request.prisma.creditWallet.findUnique({
          where: { userId: user.id },
        });

        console.log('[Verification] Existing wallet:', existingWallet ? {
          id: existingWallet.id,
          freeCreditsRemaining: existingWallet.freeCreditsRemaining,
          freeCreditsGranted: existingWallet.freeCreditsGranted
        } : 'NOT FOUND - will create new wallet');

        const wallet = await request.prisma.creditWallet.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            freeCreditsRemaining: PHONE_VERIFICATION_MINUTES,
            freeCreditsGranted: true,
            monthlyBalance: 0,
            purchasedBalance: 0,
          },
          update: {
            freeCreditsRemaining: {
              increment: PHONE_VERIFICATION_MINUTES,
            },
          },
        });

        console.log('[Verification] Wallet upsert completed:', {
          walletId: wallet.id,
          operation: existingWallet ? 'UPDATE (increment)' : 'CREATE',
          freeCreditsRemaining: wallet.freeCreditsRemaining
        });

        // Fetch the updated wallet to get the correct balance
        const updatedWallet = await request.prisma.creditWallet.findUnique({
          where: { userId: user.id },
        });

        const newBalance = updatedWallet?.freeCreditsRemaining || PHONE_VERIFICATION_MINUTES;
        console.log('[Verification] Final interview minute balance after verification:', newBalance);
        console.log('[Verification] Minutes breakdown:', {
          before: existingWallet?.freeCreditsRemaining || 0,
          added: PHONE_VERIFICATION_MINUTES,
          after: newBalance
        });

        // Log minute transaction
        const ledgerEntry = await request.prisma.creditLedger.create({
          data: {
            userId: user.id,
            walletId: wallet.id,
            bucket: "FREE",
            delta: PHONE_VERIFICATION_MINUTES,
            reason: "PHONE_VERIFICATION_MINUTES_REWARD",
            balanceAfter: {
              FREE: newBalance,
              MONTHLY: 0,
              PURCHASED: 0,
            },
          },
        });

        console.log('[Verification] Minute ledger entry created:', {
          ledgerId: ledgerEntry.id,
          bucket: ledgerEntry.bucket,
          delta: ledgerEntry.delta,
          reason: ledgerEntry.reason,
          balanceAfter: ledgerEntry.balanceAfter
        });

        console.log('[Verification] ═══════════════════════════════════════════════════════');
        console.log('[Verification] 🎉 PHONE VERIFICATION COMPLETE!');
        console.log('[Verification] ═══════════════════════════════════════════════════════');
        console.log('[Verification] Summary:', {
          userId: user.id,
          mobile: result.mobile,
          mobileVerified: true,
          minutesGranted: PHONE_VERIFICATION_MINUTES,
          newBalance: newBalance,
          timestamp: new Date().toISOString()
        });
        console.log('[Verification] ═══════════════════════════════════════════════════════');

        fastify.log.info({ userId: user.id, mobile: result.mobile, minutesGranted: PHONE_VERIFICATION_MINUTES }, "Phone verification completed via MSG91 Widget");

        // Invalidate cache so billing snapshot shows updated minutes
        console.log('[Verification] 💾 Invalidating user plan cache...');
        const { invalidateUserPlanCache, cacheDel } = await import("../services/cache.js");
        await invalidateUserPlanCache(user.id);
        console.log('[Verification] ✅ Plan cache invalidated');
        
        // Invalidate user profile cache so banner hides
        console.log('[Verification] 💾 Invalidating user profile cache...');
        await cacheDel([`api:users:${user.id}:profile`]);
        console.log('[Verification] ✅ Profile cache invalidated');

        return {
          success: true,
          message: "Phone verified successfully",
          minutesGranted: PHONE_VERIFICATION_MINUTES,
          mobile: result.mobile,
        };
      } catch (error: any) {
        console.error('[Verification] ❌ ERROR during verification:', error);
        console.error('[Verification] Error details:', {
          message: error.message,
          stack: error.stack,
          userId: request.user?.id
        });
        fastify.log.error(error);
        return reply.status(400).send({
          error: error.message || "Verification failed",
        });
      }
    }
  );
};

export default verificationRoutes;
