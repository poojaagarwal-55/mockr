import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { sanitizeForLog } from "../lib/log-utils.js";
import { getClientIP, getLocationFromIP } from "../services/device-detector.js";
import { uploadToR2Avatar } from "../lib/r2.js";
import {
    findCompanyWorkspaceAccess,
    isCompanyAdminRole,
    requireCompanyWorkspaceAccess,
    type CompanyWorkspaceAccess,
} from "./access.js";

const signupSchema = z.object({
    companyName: z.string().trim().min(1, "Company name is required").max(120),
    email: z.string().email("Invalid email address"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    contactName: z.string().trim().min(1).max(120).optional(),
});

const optionalText = (max: number) =>
    z.preprocess(
        (value) => (typeof value === "string" && value.trim() === "" ? null : value),
        z.string().trim().max(max).optional().nullable()
    );
const optionalUrl = z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(2000).refine((value) => {
        try {
            const parsed = new URL(value);
            return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
            return value.startsWith("/");
        }
    }, "Must be a valid HTTP URL or app-relative path.").optional().nullable()
);
const companySettingsSchema = z.object({
    name: z.string().trim().min(1, "Company name is required").max(120),
    contactName: optionalText(120),
    websiteUrl: optionalUrl,
    logoUrl: optionalUrl,
    industry: optionalText(80),
    companySize: z.enum(["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"]).optional().nullable(),
    headquarters: optionalText(120),
    defaultTimezone: z.string().trim().min(1).max(80).default("Asia/Kolkata"),
    defaultWorkMode: z.enum(["Remote", "Hybrid", "On-site"]).default("Hybrid"),
    defaultEmploymentType: z.enum(["Full-time", "Internship", "Contract", "Part-time"]).default("Full-time"),
    defaultCurrency: z.enum(["INR", "USD", "EUR", "GBP"]).default("INR"),
    defaultAssessmentDeadlineDays: z.coerce.number().int().min(1).max(30).default(7),
    notifyNewApplications: z.boolean().default(true),
    notifyAssessmentSubmissions: z.boolean().default(true),
    notifyWeeklyDigest: z.boolean().default(true),
    notifyTeamChanges: z.boolean().default(true),
});

const FREE_EMAIL_DOMAINS = new Set([
    "gmail.com",
    "yahoo.com",
    "hotmail.com",
    "outlook.com",
    "live.com",
    "icloud.com",
    "aol.com",
    "protonmail.com",
    "proton.me",
    "zoho.com",
    "gmx.com",
    "yandex.com",
    "mail.com",
    "fastmail.com",
    "tutanota.com",
    "hey.com",
    "duck.com",
]);

function extractDomain(email: string): string | null {
    const parts = email.split("@");
    if (parts.length !== 2) return null;
    const domain = parts[1].toLowerCase().trim();
    return domain || null;
}

function isPersonalEmailDomain(domain: string): boolean {
    if (FREE_EMAIL_DOMAINS.has(domain)) return true;
    for (const blocked of FREE_EMAIL_DOMAINS) {
        if (domain.endsWith(`.${blocked}`)) return true;
    }
    return false;
}

function validationPayload(error: z.ZodError) {
    const first = error.issues[0];
    return {
        error: "Validation Error",
        message: first ? `${first.path.join(".") || "body"}: ${first.message}` : "Fix the highlighted fields.",
        details: error.flatten().fieldErrors,
    };
}

function companyProfileResponse(access: CompanyWorkspaceAccess) {
    return {
        id: access.id,
        email: access.email,
        name: access.name,
        domain: access.domain,
        contactName: access.contactName || null,
        websiteUrl: access.websiteUrl || null,
        logoUrl: access.logoUrl || null,
        industry: access.industry || null,
        companySize: access.companySize || null,
        headquarters: access.headquarters || null,
        defaultTimezone: access.defaultTimezone || "Asia/Kolkata",
        defaultWorkMode: access.defaultWorkMode || "Hybrid",
        defaultEmploymentType: access.defaultEmploymentType || "Full-time",
        defaultCurrency: access.defaultCurrency || "INR",
        defaultAssessmentDeadlineDays: access.defaultAssessmentDeadlineDays || 7,
        notifyNewApplications: access.notifyNewApplications ?? true,
        notifyAssessmentSubmissions: access.notifyAssessmentSubmissions ?? true,
        notifyWeeklyDigest: access.notifyWeeklyDigest ?? true,
        notifyTeamChanges: access.notifyTeamChanges ?? true,
        emailVerified: access.emailVerified ?? true,
        role: access.role,
        accessType: access.accessType,
        membershipId: access.membershipId || null,
        teamId: access.teamId || null,
        lastLoginAt: null,
    };
}

export default async function companyRoutes(fastify: FastifyInstance) {
    // ─── Company Sign Up ───────────────────────────────────
    fastify.post("/companies/signup", async (request, reply) => {
        const rl = checkRateLimit(`companies:signup:${request.ip}`, 5, 900_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Too many signup attempts. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const parsed = signupSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { companyName, email, password, contactName } = parsed.data;
        const normalizedEmail = email.toLowerCase();
        const domain = extractDomain(normalizedEmail);

        if (!domain || !domain.includes(".")) {
            return reply.status(400).send({
                error: "Invalid email domain",
                message: "Please use a valid company email address.",
            });
        }

        const isPersonalEmail = isPersonalEmailDomain(domain);

        if (isPersonalEmail) {
            const pendingInvite = await (prisma as any).companyTeamInvitation.findFirst({
                where: {
                    email: normalizedEmail,
                    status: "pending",
                    expiresAt: { gt: new Date() },
                },
                select: { id: true },
            });

            if (!pendingInvite) {
                return reply.status(400).send({
                    error: "Company invite required",
                    message: "Personal emails can sign up here only after a company adds them to a team.",
                });
            }

            const fullName = contactName?.trim() || companyName.trim() || normalizedEmail.split("@")[0] || "Team member";
            const existingAccount = await (prisma as any).companyMemberAccount.findUnique({
                where: { email: normalizedEmail },
            });

            const supabase = getSupabaseAdmin();

            if (existingAccount) {
                if (existingAccount.emailVerified) {
                    return reply.status(409).send({
                        error: "Email Already Registered",
                        message: "This company workspace account already exists. Please log in instead.",
                    });
                }

                try {
                    await supabase.auth.admin.updateUserById(existingAccount.id, {
                        password,
                        email_confirm: false,
                        user_metadata: {
                            account_type: "company_member",
                            full_name: fullName,
                        },
                    });

                    const account = await (prisma as any).companyMemberAccount.update({
                        where: { id: existingAccount.id },
                        data: {
                            fullName,
                            emailVerified: false,
                            emailVerifiedAt: null,
                        },
                    });

                    return reply.status(200).send({
                        companyMember: {
                            id: account.id,
                            email: account.email,
                            fullName: account.fullName,
                        },
                        message: "Account found! Please check your email to verify your company workspace account.",
                    });
                } catch (updateError: any) {
                    return reply.status(500).send({
                        error: "Update Failed",
                        message: updateError.message || "Failed to update account",
                    });
                }
            }

            const { data: authData, error: authError } = await supabase.auth.admin.createUser({
                email: normalizedEmail,
                password,
                email_confirm: false,
                user_metadata: {
                    account_type: "company_member",
                    full_name: fullName,
                },
            });

            if (authError) {
                if (authError.message.includes("already")) {
                    return reply.status(200).send({
                        existingAuthAccount: true,
                        needsLogin: true,
                        message: "This email already has a Practers login. Use that existing password here, or reset it if you signed up with Google or forgot it.",
                    });
                }

                return reply.status(400).send({
                    error: "Auth Error",
                    message: authError.message,
                });
            }

            try {
                const account = await (prisma as any).companyMemberAccount.create({
                    data: {
                        id: authData.user.id,
                        email: normalizedEmail,
                        fullName,
                        emailVerified: false,
                    },
                });

                return reply.status(201).send({
                    companyMember: {
                        id: account.id,
                        email: account.email,
                        fullName: account.fullName,
                    },
                });
            } catch (dbError: any) {
                fastify.log.error(sanitizeForLog(dbError), "Company member account creation failed");
                return reply.status(500).send({
                    error: "Database Error",
                    message: "Failed to create company workspace account. Please try again.",
                    details: process.env.NODE_ENV === "development" ? dbError.message : undefined,
                });
            }
        }

        const existingCompany = await prisma.company.findUnique({
            where: { email: normalizedEmail },
        });

        if (existingCompany) {
            if (existingCompany.emailVerified) {
                return reply.status(409).send({
                    error: "Email Already Registered",
                    message: "This email is already registered. Please log in instead.",
                });
            }

            const supabase = getSupabaseAdmin();
            try {
                await supabase.auth.admin.updateUserById(existingCompany.id, {
                    password,
                    email_confirm: false,
                    user_metadata: {
                        account_type: "company",
                        company_name: companyName,
                        contact_name: contactName || null,
                    },
                });

                const company = await prisma.company.update({
                    where: { id: existingCompany.id },
                    data: {
                        name: companyName,
                        domain,
                        contactName: contactName || null,
                        emailVerified: false,
                        emailVerifiedAt: null,
                    },
                });

                return reply.status(200).send({
                    company: {
                        id: company.id,
                        email: company.email,
                        name: company.name,
                        domain: company.domain,
                        contactName: company.contactName,
                    },
                    message: "Account found! Please check your email to verify your account.",
                });
            } catch (updateError: any) {
                return reply.status(500).send({
                    error: "Update Failed",
                    message: updateError.message || "Failed to update account",
                });
            }
        }

        const supabase = getSupabaseAdmin();
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: normalizedEmail,
            password,
            email_confirm: false,
            user_metadata: {
                account_type: "company",
                company_name: companyName,
                contact_name: contactName || null,
            },
        });

        if (authError) {
            const status = authError.message.includes("already") ? 409 : 400;
            return reply.status(status).send({
                error: "Auth Error",
                message: authError.message,
            });
        }

        try {
            const company = await prisma.company.create({
                data: {
                    id: authData.user.id,
                    email: normalizedEmail,
                    name: companyName,
                    domain,
                    contactName: contactName || null,
                    emailVerified: false,
                },
            });

            return reply.status(201).send({
                company: {
                    id: company.id,
                    email: company.email,
                    name: company.name,
                    domain: company.domain,
                    contactName: company.contactName,
                },
            });
        } catch (dbError: any) {
            fastify.log.error(sanitizeForLog(dbError), "Company creation failed");
            return reply.status(500).send({
                error: "Database Error",
                message: "Failed to create company profile. Please try again.",
                details: process.env.NODE_ENV === "development" ? dbError.message : undefined,
            });
        }
    });

    // ─── Company Profile (Authenticated) ───────────────────
    fastify.get(
        "/companies/me",
        { preHandler: [fastify.authenticate] },
        async (request, reply) => {
            const { id } = request.user!;
            const normalizedEmail = request.user!.email?.toLowerCase();

            const userMeta = request.user?.user_metadata || {};
            const fullNameHint =
                typeof userMeta.full_name === "string"
                    ? userMeta.full_name
                    : typeof userMeta.name === "string"
                        ? userMeta.name
                        : null;
            const access = await findCompanyWorkspaceAccess({ userId: id, userEmail: normalizedEmail, fullNameHint });

            if (!access) {
                return reply.status(403).send({
                    error: "Company Access Required",
                    message: "No active company workspace access was found for this account.",
                });
            }

            try {
                if (access.accessType === "owner") {
                    const ipAddress = getClientIP(request);
                    const locationInfo = await getLocationFromIP(ipAddress);
                    await prisma.company.update({
                        where: { id: access.id },
                        data: {
                            lastLoginAt: new Date(),
                            lastLoginIp: ipAddress,
                            lastLoginLocation: locationInfo.location,
                        },
                    });
                }
            } catch (err) {
                fastify.log.warn(sanitizeForLog(err), "Failed to update company login info");
            }

            return {
                company: companyProfileResponse(access),
            };
        }
    );

    fastify.patch(
        "/companies/settings",
        { preHandler: [fastify.authenticate, requireCompanyWorkspaceAccess] },
        async (request, reply) => {
            const companyAccess = request.company!;

            if (!isCompanyAdminRole(companyAccess.role)) {
                return reply.status(403).send({
                    error: "Forbidden",
                    message: "Only company owners and admins can update workspace settings.",
                });
            }

            const rl = checkRateLimit(`companies:settings:update:${companyAccess.id}`, 30, 600_000);
            if (!rl.allowed) {
                return reply.status(429).send({
                    error: "Too Many Requests",
                    message: `Settings update limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
                });
            }

            const parsed = companySettingsSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.status(400).send(validationPayload(parsed.error));
            }

            try {
                const updatedCompany = await prisma.$transaction(async (tx: any) => {
                    const company = await tx.company.update({
                        where: { id: companyAccess.id },
                        data: {
                            name: parsed.data.name,
                            contactName: parsed.data.contactName || null,
                            websiteUrl: parsed.data.websiteUrl || null,
                            logoUrl: parsed.data.logoUrl || null,
                            industry: parsed.data.industry || null,
                            companySize: parsed.data.companySize || null,
                            headquarters: parsed.data.headquarters || null,
                            defaultTimezone: parsed.data.defaultTimezone,
                            defaultWorkMode: parsed.data.defaultWorkMode,
                            defaultEmploymentType: parsed.data.defaultEmploymentType,
                            defaultCurrency: parsed.data.defaultCurrency,
                            defaultAssessmentDeadlineDays: parsed.data.defaultAssessmentDeadlineDays,
                            notifyNewApplications: parsed.data.notifyNewApplications,
                            notifyAssessmentSubmissions: parsed.data.notifyAssessmentSubmissions,
                            notifyWeeklyDigest: parsed.data.notifyWeeklyDigest,
                            notifyTeamChanges: parsed.data.notifyTeamChanges,
                        },
                    });

                    await tx.companyJobOpening.updateMany({
                        where: { companyId: companyAccess.id },
                        data: {
                            companyName: parsed.data.name,
                            companyLogoUrl: parsed.data.logoUrl || null,
                        },
                    });

                    return company;
                });

                return {
                    company: companyProfileResponse({
                        ...updatedCompany,
                        role: companyAccess.role,
                        accessType: companyAccess.accessType,
                        membershipId: companyAccess.membershipId,
                        teamId: companyAccess.teamId,
                    }),
                };
            } catch (err) {
                fastify.log.error(sanitizeForLog(err), "Company settings update failed");
                return reply.status(500).send({
                    error: "Internal Server Error",
                    message: "Failed to update company settings. Please try again.",
                });
            }
        }
    );

    fastify.post(
        "/companies/settings/logo",
        { preHandler: [fastify.authenticate, requireCompanyWorkspaceAccess] },
        async (request, reply) => {
            const companyAccess = request.company!;

            if (!isCompanyAdminRole(companyAccess.role)) {
                return reply.status(403).send({
                    error: "Forbidden",
                    message: "Only company owners and admins can upload the company logo.",
                });
            }

            const rl = checkRateLimit(`companies:settings:logo:${companyAccess.id}`, 12, 600_000);
            if (!rl.allowed) {
                return reply.status(429).send({
                    error: "Too Many Requests",
                    message: `Logo upload limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
                });
            }

            const data = await request.file();
            if (!data) {
                return reply.status(400).send({ error: "No file provided", message: "Choose an image file." });
            }

            const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
            if (!allowedTypes.includes(data.mimetype)) {
                return reply.status(400).send({
                    error: "Invalid file type",
                    message: "Only JPEG, PNG, or WebP images are allowed.",
                });
            }

            const buffer = await data.toBuffer();
            if (buffer.length > 3 * 1024 * 1024) {
                return reply.status(400).send({
                    error: "File too large",
                    message: "Logo image must be under 3MB.",
                });
            }

            try {
                const ext = data.mimetype === "image/jpeg" ? "jpg" : data.mimetype.split("/")[1];
                const key = `company-settings/${companyAccess.id}/logos/${randomUUID()}.${ext}`;
                const logoUrl = await uploadToR2Avatar(key, buffer, data.mimetype);

                const updatedCompany = await prisma.$transaction(async (tx: any) => {
                    const company = await tx.company.update({
                        where: { id: companyAccess.id },
                        data: { logoUrl },
                    });

                    await tx.companyJobOpening.updateMany({
                        where: { companyId: companyAccess.id },
                        data: { companyLogoUrl: logoUrl },
                    });

                    return company;
                });

                return reply.status(201).send({
                    fileUrl: logoUrl,
                    company: companyProfileResponse({
                        ...updatedCompany,
                        role: companyAccess.role,
                        accessType: companyAccess.accessType,
                        membershipId: companyAccess.membershipId,
                        teamId: companyAccess.teamId,
                    }),
                });
            } catch (err) {
                fastify.log.error(sanitizeForLog(err), "Company logo upload failed");
                return reply.status(500).send({
                    error: "Internal Server Error",
                    message: "Failed to upload company logo. Please try again.",
                });
            }
        }
    );
}
