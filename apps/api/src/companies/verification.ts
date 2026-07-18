import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { checkRateLimit } from "../lib/rate-limiter.js";
import {
  canResendCompanyMemberCode,
  canResendCompanyCode,
  sendCompanyMemberEmailOTP,
  sendCompanyEmailOTP,
  verifyCompanyMemberEmailOTP,
  verifyCompanyEmailOTP,
} from "../services/verification.js";

const companyVerificationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/companies/verification/email/send-public", async (request, reply) => {
    const schema = z.object({
      email: z.string().email("Invalid email address"),
    });

    try {
      const { email } = schema.parse(request.body);
      const normalizedEmail = email.toLowerCase();

      const ipRateLimit = checkRateLimit(`companies:verification:email:${request.ip}`, 5, 60_000);
      if (!ipRateLimit.allowed) {
        return reply.status(429).send({
          error: "Too Many Requests",
          message: `Too many verification requests. Please wait ${Math.ceil(ipRateLimit.retryAfterMs / 1000)}s.`,
        });
      }

      const company = await request.prisma.company.findUnique({
        where: { email: normalizedEmail },
      });

      if (!company) {
        const companyMember = await (request.prisma as any).companyMemberAccount.findUnique({
          where: { email: normalizedEmail },
        });

        if (!companyMember) {
          return reply.status(404).send({ error: "Company workspace account not found" });
        }

        if (companyMember.emailVerified) {
          return reply.status(400).send({ error: "Email already verified" });
        }

        const canResend = await canResendCompanyMemberCode(companyMember.id);
        if (!canResend.allowed) {
          return reply.status(429).send({
            error: `Please wait ${canResend.waitSeconds} seconds before requesting a new code`,
          });
        }

        await sendCompanyMemberEmailOTP(companyMember.id, companyMember.email);

        return { success: true, message: "Verification code sent to your email" };
      }

      if (company.emailVerified) {
        return reply.status(400).send({ error: "Email already verified" });
      }

      const canResend = await canResendCompanyCode(company.id);
      if (!canResend.allowed) {
        return reply.status(429).send({
          error: `Please wait ${canResend.waitSeconds} seconds before requesting a new code`,
        });
      }

      await sendCompanyEmailOTP(company.id, company.email);

      return { success: true, message: "Verification code sent to your email" };
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: error.message || "Failed to send verification code" });
    }
  });

  fastify.post("/companies/verification/email/verify-public", async (request, reply) => {
    const schema = z.object({
      email: z.string().email("Invalid email address"),
      code: z.string().length(6, "Code must be 6 digits"),
      devSkip: z.boolean().optional(),
    });

    try {
      const { email, code, devSkip } = schema.parse(request.body);
      const normalizedEmail = email.toLowerCase();

      const company = await request.prisma.company.findUnique({
        where: { email: normalizedEmail },
      });

      if (!company) {
        const companyMember = await (request.prisma as any).companyMemberAccount.findUnique({
          where: { email: normalizedEmail },
        });

        if (!companyMember) {
          return reply.status(404).send({ error: "Company workspace account not found" });
        }

        if (companyMember.emailVerified) {
          return reply.status(400).send({ error: "Email already verified" });
        }

        if (devSkip) {
          if (process.env.NODE_ENV !== "development") {
            return reply.status(403).send({ error: "Dev skip is not available" });
          }

          if (code !== "000000") {
            return reply.status(400).send({ error: "Invalid dev skip code" });
          }

          await (request.prisma as any).companyMemberAccount.update({
            where: { id: companyMember.id },
            data: {
              emailVerified: true,
              emailVerifiedAt: new Date(),
            },
          });

          try {
            const { getSupabaseAdmin } = await import("../lib/supabase.js");
            const supabase = getSupabaseAdmin();

            await supabase.auth.admin.updateUserById(companyMember.id, {
              email_confirm: true,
            });
          } catch (supabaseError) {
            fastify.log.error(supabaseError);
          }

          const { linkPendingTeamInvitationsForCompanyAccount } = await import("../services/team-invitations.js");
          await linkPendingTeamInvitationsForCompanyAccount({
            companyAccountId: companyMember.id,
            email: companyMember.email,
          });

          return { success: true, message: "Email verified successfully" };
        }

        const verified = await verifyCompanyMemberEmailOTP(companyMember.id, code);
        if (!verified) {
          return reply.status(400).send({ error: "Invalid or expired verification code" });
        }

        return { success: true, message: "Email verified successfully" };
      }

      if (company.emailVerified) {
        return reply.status(400).send({ error: "Email already verified" });
      }

      if (devSkip) {
        if (process.env.NODE_ENV !== "development") {
          return reply.status(403).send({ error: "Dev skip is not available" });
        }

        if (code !== "000000") {
          return reply.status(400).send({ error: "Invalid dev skip code" });
        }

        await request.prisma.company.update({
          where: { id: company.id },
          data: {
            emailVerified: true,
            emailVerifiedAt: new Date(),
          },
        });

        try {
          const { getSupabaseAdmin } = await import("../lib/supabase.js");
          const supabase = getSupabaseAdmin();

          await supabase.auth.admin.updateUserById(company.id, {
            email_confirm: true,
          });
        } catch (supabaseError) {
          fastify.log.error(supabaseError);
        }

        return { success: true, message: "Email verified successfully" };
      }

      const verified = await verifyCompanyEmailOTP(company.id, code);
      if (!verified) {
        return reply.status(400).send({ error: "Invalid or expired verification code" });
      }

      return { success: true, message: "Email verified successfully" };
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(400).send({ error: error.message || "Verification failed" });
    }
  });
};

export default companyVerificationRoutes;
