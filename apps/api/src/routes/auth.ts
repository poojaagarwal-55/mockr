import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { sanitizeForLog, maskUserId } from "../lib/log-utils.js";
import { parseUserAgent, getLocationFromIP, getClientIP } from "../services/device-detector.js";
import { sendLoginNotification, generatePasswordResetLink, sendWelcomeEmail, sendPasswordResetEmail } from "../services/email-notifications.js";
import { generateDeviceToken, validateDeviceToken, storeDeviceToken } from "../services/device-token.js";

const signupSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6, "Password must be at least 6 characters"),
    fullName: z.string().min(1, "Full name is required"),
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});

export default async function authRoutes(fastify: FastifyInstance) {
    // ─── Sign Up ──────────────────────────────────────────────
    fastify.post("/auth/signup", async (request, reply) => {
        const rl = checkRateLimit(`auth:signup:${request.ip}`, 5, 900_000);
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

        const { email, password, fullName } = parsed.data;
        const supabase = getSupabaseAdmin();

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            // If email is already verified, reject signup
            if (existingUser.emailVerified) {
                return reply.status(409).send({
                    error: "Email Already Registered",
                    message: "This email is already registered. Please log in instead.",
                });
            }

            // If email is NOT verified, allow re-signup (update password and resend OTP)
            // This handles the case where user signed up but never verified
            try {
                // Update password in Supabase
                await supabase.auth.admin.updateUserById(existingUser.id, {
                    password,
                    user_metadata: { full_name: fullName },
                });

                // Update user in our DB
                await prisma.user.update({
                    where: { id: existingUser.id },
                    data: { fullName },
                });

                return reply.status(200).send({
                    user: {
                        id: existingUser.id,
                        email: existingUser.email,
                        fullName,
                        isNewUser: true,
                        onboardingCompleted: false,
                        emailVerified: false,
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

        // 1. Create Supabase auth user WITHOUT auto-confirming email
        // User must verify email before they can log in
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: false, // Require email verification
            user_metadata: { full_name: fullName },
        });

        if (authError) {
            const status = authError.message.includes("already") ? 409 : 400;
            return reply.status(status).send({
                error: "Auth Error",
                message: authError.message,
            });
        }

        // 2. Create matching user row in our DB
        try {
            const user = await prisma.user.create({
                data: {
                    id: authData.user.id, // same UUID as Supabase auth
                    email,
                    fullName,
                    onboardingCompleted: false,
                    emailVerified: false, // Not verified yet
                },
            });

            return reply.status(201).send({
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.fullName,
                    isNewUser: true,
                    onboardingCompleted: false,
                    emailVerified: false,
                },
                // Don't return session - user must verify email first
                message: "Account created! Please check your email to verify your account.",
            });
        } catch (dbError: any) {
            fastify.log.error(sanitizeForLog(dbError), "Prisma user creation failed");
            
            // If DB creation fails, we should ideally delete the Supabase user to allow retry
            // but for now, we just return a clear error
            return reply.status(500).send({
                error: "Database Error",
                message: "Failed to create user profile. Please try again.",
                details: process.env.NODE_ENV === "development" ? dbError.message : undefined
            });
        }
    });

    // ─── Log In ──────────────────────────────────────────────
    fastify.post("/auth/login", async (request, reply) => {
        const rl = checkRateLimit(`auth:login:${request.ip}`, 10, 900_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Too many login attempts. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const parsed = loginSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { email, password } = parsed.data;
        const supabase = getSupabaseAdmin();

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            return reply.status(401).send({
                error: "Auth Error",
                message: "Invalid email or password",
            });
        }

        // Fetch user profile from our DB
        let user = await prisma.user.findUnique({
            where: { id: data.user.id },
            select: {
                id: true,
                email: true,
                fullName: true,
                role: true,
                placementCollegeEmailDomain: true,
                avatarUrl: true,
                onboardingCompleted: true,
                deviceToken: true,
                createdAt: true,
            },
        });

        let isNewUser = false;

        if (!user) {
            // Edge case: Supabase user exists but no DB row — auto-create it
            user = await prisma.user.create({
                data: {
                    id: data.user.id,
                    email,
                    fullName:
                        data.user.user_metadata?.full_name ||
                        data.user.user_metadata?.name ||
                        email.split("@")[0] ||
                        "User",
                    avatarUrl:
                        data.user.user_metadata?.avatar_url ||
                        data.user.user_metadata?.picture ||
                        null,
                    onboardingCompleted: false,
                },
            });
            isNewUser = true;

            // Send welcome email for new users (async, don't block response)
            (async () => {
                try {
                    await sendWelcomeEmail(user.email, user.fullName);
                } catch (err) {
                    fastify.log.error(sanitizeForLog(err), "Failed to send welcome email");
                }
            })();
        }

        // 🔥 Check device token from cookie
        const existingDeviceToken = request.cookies.deviceToken;
        const isKnownDevice = existingDeviceToken && user.deviceToken === existingDeviceToken;

        // Only send login notification for NEW devices (not known devices)
        // if (!isNewUser && !isKnownDevice) {
        //     (async () => {
        //         try {
        //             const accountAge = Date.now() - (user.createdAt?.getTime() || 0);
        //             const isRecentSignup = accountAge < 5 * 60 * 1000;
        //             if (isRecentSignup) {
        //                 fastify.log.info({ userId: user.id }, "Skipping login notification for recent signup");
        //                 return;
        //             }
        //             const ipAddress = getClientIP(request);
        //             const userAgent = request.headers["user-agent"] || "Unknown";
        //             const deviceInfo = parseUserAgent(userAgent);
        //             const locationInfo = await getLocationFromIP(ipAddress);
        //             const baseUrl = process.env.NEXT_PUBLIC_API_URL?.replace("3001", "3000") || "http://localhost:3000";
        //             const resetPasswordUrl = `${baseUrl}/login?tab=forgot`;
        //             const deviceString = `${deviceInfo.browser} on ${deviceInfo.os} (${deviceInfo.deviceType})`;
        //             const locationString = locationInfo.location || "Unknown Location";
        //             const timeString = new Date().toLocaleString("en-US", {
        //                 weekday: "long", year: "numeric", month: "long", day: "numeric",
        //                 hour: "2-digit", minute: "2-digit", timeZoneName: "short",
        //             });
        //             await sendLoginNotification({
        //                 userName: user.fullName, userEmail: user.email, device: deviceString,
        //                 location: locationString, time: timeString, ipAddress, resetPasswordUrl,
        //             });
        //         } catch (err) {
        //             fastify.log.error(sanitizeForLog(err), "Failed to send login notification");
        //         }
        //     })();
        // }

        // Generate and store new device token if not known device
        if (!isKnownDevice) {
            const newDeviceToken = generateDeviceToken();
            await storeDeviceToken(user.id, newDeviceToken);

            // Set secure HTTP-only cookie
            reply.setCookie("deviceToken", newDeviceToken, {
                httpOnly: true,   // 🔒 JS can't access it
                secure: process.env.NODE_ENV === "production", // HTTPS only in production
                sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", // none for prod (cross-domain: practers.com → api.run.app), lax for dev
                maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
                path: "/",
                domain: process.env.NODE_ENV === "production" ? undefined : "localhost", // Set domain for localhost
            });
        }

        return {
            user: {
                id: user.id,
                email: user.email,
                fullName: user.fullName,
                role: user.role,
                placementCollegeEmailDomain: user.placementCollegeEmailDomain,
                avatarUrl: user.avatarUrl,
                isNewUser,
                onboardingCompleted: user.onboardingCompleted,
            },
            session: {
                accessToken: data.session.access_token,
                refreshToken: data.session.refresh_token,
                expiresAt: data.session.expires_at,
            },
        };
    });

    // ─── Log Out ──────────────────────────────────────────────
    fastify.post("/auth/logout", {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        // Supabase session invalidation happens client-side
        // This endpoint is for bookkeeping if needed
        return { message: "Logged out successfully" };
    });

    // ─── Get Current User ────────────────────────────────────
    fastify.get("/auth/me", {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = await prisma.user.findUnique({
            where: { id: request.user!.id },
            include: {
                _count: {
                    select: {
                        sessions: true,
                        reports: true,
                    },
                },
            },
        });

        if (!user) {
            return reply.status(404).send({
                error: "User Not Found",
                message: "No profile found for this account",
            });
        }

        return {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            role: user.role,
            placementCollegeEmailDomain: user.placementCollegeEmailDomain,
            avatarUrl: user.avatarUrl,
            createdAt: user.createdAt,
            stats: {
                totalSessions: user._count.sessions,
                totalReports: user._count.reports,
            },
        };
    });

    // ─── Sync user from OAuth (frontend calls this after Supabase OAuth) ──
    fastify.post("/auth/sync", {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const { id, email } = request.user!;
        const accountType = (request.user?.user_metadata as Record<string, any> | undefined)?.account_type
            || (request.user?.user_metadata as Record<string, any> | undefined)?.accountType;

        if (accountType === "company") {
            return reply.status(403).send({
                error: "Company account",
                message: "Company accounts must use the company portal.",
            });
        }

        // Track login information
        const ipAddress = getClientIP(request);
        const userAgent = request.headers["user-agent"] || "Unknown";
        const deviceInfo = parseUserAgent(userAgent);
        const locationInfo = await getLocationFromIP(ipAddress);

        // Check if user already exists in our DB
        let user = await prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                email: true,
                username: true,
                mobile: true,
                mobileVerified: true,
                country: true,
                fullName: true,
                role: true,
                placementCollegeEmailDomain: true,
                avatarUrl: true,
                onboardingCompleted: true,
                gender: true,
                birthday: true,
                location: true,
                website: true,
                githubUrl: true,
                linkedinUrl: true,
                twitterUrl: true,
                readmeUrl: true,
                skills: true,
                workExperience: true,
                education: true,
                deviceToken: true,
                createdAt: true,
                lastLoginAt: true,
            },
        });

        // Extract avatar & name from request.user metadata (set by auth plugin)
        let avatarUrl = request.user?.user_metadata?.avatar_url || request.user?.user_metadata?.picture || null;
        let fullName = request.user?.user_metadata?.full_name || request.user?.user_metadata?.name || null;

        // Also fetch the full Supabase user (including identities) for providers
        // like LinkedIn OIDC that may store picture only in identity_data
        try {
            const supabase = getSupabaseAdmin();
            const { data: { user: supaUser } } = await supabase.auth.admin.getUserById(id);

            if (supaUser) {
                // Check user_metadata from Supabase DB (may be fresher than JWT)
                if (!avatarUrl) {
                    avatarUrl = supaUser.user_metadata?.avatar_url || supaUser.user_metadata?.picture || null;
                }
                if (!fullName) {
                    fullName = supaUser.user_metadata?.full_name || supaUser.user_metadata?.name || null;
                }

                // Check identity_data from all linked identities (LinkedIn, Google, etc.)
                // Always check identities — they may have data even when user_metadata doesn't
                if (supaUser.identities && supaUser.identities.length > 0) {
                    for (const identity of supaUser.identities) {
                        const iData = identity.identity_data;
                        if (iData?.avatar_url || iData?.picture) {
                            avatarUrl = iData.avatar_url || iData.picture;
                        }
                        if (iData?.full_name || iData?.name) {
                            fullName = iData.full_name || iData.name;
                        }
                    }
                }

                // Also check raw_user_meta_data / raw_app_meta_data via identities
                // LinkedIn OIDC sometimes puts picture_url in a non-standard field
                if (!avatarUrl && supaUser.identities) {
                    for (const identity of supaUser.identities) {
                        if (identity.identity_data?.picture_url) {
                            avatarUrl = identity.identity_data.picture_url;
                            break;
                        }
                    }
                }
            }
        } catch (e) {
            fastify.log.error(sanitizeForLog(e), "Failed to fetch Supabase user for identity data");
        }

        const isNewUser = !user;

        if (!user) {
            // First OAuth login — create the DB row
            const body = request.body as { fullName?: string } | undefined;
            user = await prisma.user.create({
                data: {
                    id,
                    email,
                    fullName: fullName || body?.fullName || email.split("@")[0] || "User",
                    avatarUrl,
                    onboardingCompleted: false,
                    emailVerified: true, // OAuth users are pre-verified
                    emailVerifiedAt: new Date(),
                    lastLoginAt: new Date(),
                    lastLoginIp: ipAddress,
                    lastLoginLocation: locationInfo.location,
                },
                select: {
                    id: true,
                    email: true,
                    username: true,
                    mobile: true,
                    mobileVerified: true,
                    country: true,
                    fullName: true,
                    role: true,
                    placementCollegeEmailDomain: true,
                    avatarUrl: true,
                    onboardingCompleted: true,
                    gender: true,
                    birthday: true,
                    location: true,
                    website: true,
                    githubUrl: true,
                    linkedinUrl: true,
                    twitterUrl: true,
                    readmeUrl: true,
                    skills: true,
                    workExperience: true,
                    education: true,
                    deviceToken: true,
                    createdAt: true,
                    lastLoginAt: true,
                },
            });

            // Send welcome email for new users
            try {
                await sendWelcomeEmail(user.email, user.fullName);
            } catch (err) {
                fastify.log.error(sanitizeForLog(err), "Failed to send welcome email");
            }

            // Generate device token for new user
            const newDeviceToken = generateDeviceToken();
            await storeDeviceToken(user.id, newDeviceToken);

            reply.setCookie("deviceToken", newDeviceToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", // none for prod (cross-domain: practers.com → api.run.app), lax for dev
                maxAge: 30 * 24 * 60 * 60, // 30 days
                path: "/",
                domain: process.env.NODE_ENV === "production" ? undefined : "localhost", // Set domain for localhost
            });

            return reply.status(201).send({
                user: {
                    id: user.id,
                    email: user.email,
                    username: user.username,
                    mobile: user.mobile,
                    mobileVerified: user.mobileVerified,
                    country: user.country,
                    fullName: user.fullName,
                    role: user.role,
                    placementCollegeEmailDomain: user.placementCollegeEmailDomain,
                    avatarUrl: user.avatarUrl,
                    isNewUser: true,
                    onboardingCompleted: false,
                    gender: user.gender,
                    birthday: user.birthday?.toISOString().split("T")[0] ?? null,
                    location: user.location,
                    website: user.website,
                    githubUrl: user.githubUrl,
                    linkedinUrl: user.linkedinUrl,
                    twitterUrl: user.twitterUrl,
                    readmeUrl: user.readmeUrl,
                    skills: user.skills,
                    workExperience: user.workExperience,
                    education: user.education,
                },
            });
        }

        // 🔥 Check device token from cookie
        const existingDeviceToken = request.cookies.deviceToken;
        const isKnownDevice = existingDeviceToken && user.deviceToken === existingDeviceToken;

        // 🔥 Capture the OLD lastLoginAt BEFORE updating (for email notification logic)
        const previousLoginTime = (user as any).lastLoginAt?.getTime() || 0;

        // Only update avatarUrl from OAuth if the user hasn't set a custom one.
        // A custom avatar is identified by pointing to our R2 avatar bucket.
        // If the user has uploaded their own picture, never overwrite it with the OAuth one.
        const avatarBucketUrl = (process.env.R2_AVATAR_PUBLIC_URL || "").replace(/\/$/, "");
        const hasCustomAvatar = user.avatarUrl && avatarBucketUrl && user.avatarUrl.startsWith(avatarBucketUrl);
        const shouldUpdateAvatar = avatarUrl && !hasCustomAvatar && user.avatarUrl !== avatarUrl;

        const needsUpdate =
            shouldUpdateAvatar ||
            (!user.avatarUrl && avatarUrl) ||
            (fullName && user.fullName !== fullName);

        if (needsUpdate) {
            user = await prisma.user.update({
                where: { id },
                data: {
                    ...(shouldUpdateAvatar || (!user.avatarUrl && avatarUrl) ? { avatarUrl } : {}),
                    ...(fullName ? { fullName } : {}),
                    lastLoginAt: new Date(),
                    lastLoginIp: ipAddress,
                    lastLoginLocation: locationInfo.location,
                },
            });
        } else {
            // Update last login info even if no other changes
            user = await prisma.user.update({
                where: { id },
                data: {
                    lastLoginAt: new Date(),
                    lastLoginIp: ipAddress,
                    lastLoginLocation: locationInfo.location,
                },
            });
        }

        // Record login history
        try {
            await prisma.loginHistory.create({
                data: {
                    userId: user.id,
                    ipAddress,
                    userAgent,
                    deviceType: deviceInfo.deviceType,
                    browser: deviceInfo.browser,
                    os: deviceInfo.os,
                    location: locationInfo.location,
                    country: locationInfo.country,
                    city: locationInfo.city,
                },
            });
        } catch (err) {
            fastify.log.error(sanitizeForLog(err), "Failed to record login history");
        }

        // Send login notification email (async, don't wait)
        // if (!isNewUser && !isKnownDevice && previousLoginTime !== 0) {
        //     const timeSinceLastLogin = Date.now() - previousLoginTime;
        //     const shouldSendEmail = timeSinceLastLogin > 60000;
        //     if (shouldSendEmail) {
        //         (async () => {
        //             try {
        //                 const baseUrl = process.env.NEXT_PUBLIC_API_URL?.replace("3001", "3000") || "http://localhost:3000";
        //                 const resetPasswordUrl = `${baseUrl}/login?tab=forgot`;
        //                 const deviceString = `${deviceInfo.browser} on ${deviceInfo.os} (${deviceInfo.deviceType})`;
        //                 const locationString = locationInfo.location || "Unknown Location";
        //                 const timeString = new Date().toLocaleString("en-US", {
        //                     weekday: "long", year: "numeric", month: "long", day: "numeric",
        //                     hour: "2-digit", minute: "2-digit", timeZoneName: "short",
        //                 });
        //                 await sendLoginNotification({
        //                     userName: user.fullName, userEmail: user.email, device: deviceString,
        //                     location: locationString, time: timeString, ipAddress, resetPasswordUrl,
        //                 });
        //                 fastify.log.info({ userId: user.id }, "✅ Login notification email sent for new device");
        //             } catch (err) {
        //                 fastify.log.error(sanitizeForLog(err), "Failed to send login notification");
        //             }
        //         })();
        //     } else {
        //         fastify.log.info({ userId: user.id, timeSinceLastLogin }, "Skipping duplicate login notification (too soon since last login)");
        //     }
        // }

        // Generate and store new device token if not known device
        if (!isKnownDevice) {
            const newDeviceToken = generateDeviceToken();
            await storeDeviceToken(user.id, newDeviceToken);

            reply.setCookie("deviceToken", newDeviceToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", // none for prod (cross-domain: practers.com → api.run.app), lax for dev
                maxAge: 30 * 24 * 60 * 60, // 30 days
                path: "/",
                domain: process.env.NODE_ENV === "production" ? undefined : "localhost", // Set domain for localhost
            });
        }

        return {
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                mobile: user.mobile,
                mobileVerified: user.mobileVerified,
                country: user.country,
                fullName: user.fullName,
                role: user.role,
                placementCollegeEmailDomain: user.placementCollegeEmailDomain,
                avatarUrl: user.avatarUrl,
                isNewUser: false,
                onboardingCompleted: user.onboardingCompleted,
                gender: user.gender,
                birthday: user.birthday?.toISOString().split("T")[0] ?? null,
                location: user.location,
                website: user.website,
                githubUrl: user.githubUrl,
                linkedinUrl: user.linkedinUrl,
                twitterUrl: user.twitterUrl,
                readmeUrl: user.readmeUrl,
                skills: user.skills,
                workExperience: user.workExperience,
                education: user.education,
            },
        };
    });

    // ─── Change Password ─────────────────────────────────────
    const changePasswordSchema = z.object({
        currentPassword: z.string().min(1, "Current password is required"),
        newPassword: z.string().min(6, "New password must be at least 6 characters"),
    });

    fastify.post("/auth/change-password", {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const rl = checkRateLimit(`auth:changepw:${request.user!.id}`, 3, 900_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Too many password change attempts. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const parsed = changePasswordSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { currentPassword, newPassword } = parsed.data;
        const { email } = request.user!;
        const supabase = getSupabaseAdmin();

        // 1. Verify current password by attempting sign-in
        const { error: verifyError } = await supabase.auth.signInWithPassword({
            email,
            password: currentPassword,
        });

        if (verifyError) {
            return reply.status(401).send({
                error: "Invalid Password",
                message: "Current password is incorrect.",
            });
        }

        // 2. Update to new password using admin API
        const { error: updateError } = await supabase.auth.admin.updateUserById(
            request.user!.id,
            { password: newPassword }
        );

        if (updateError) {
            return reply.status(500).send({
                error: "Update Failed",
                message: updateError.message || "Failed to update password.",
            });
        }

        return { message: "Password updated successfully." };
    });

    // ─── Delete Account ─────────────────────────────────────────
    fastify.delete("/auth/account", {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const rl = checkRateLimit(`auth:delete:${request.user!.id}`, 2, 3_600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Too many deletion attempts. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const userId = request.user!.id;
        const supabase = getSupabaseAdmin();

        try {
            // 1. Delete all user data from our DB
            await prisma.payment.deleteMany({ where: { userId } });
            await prisma.subscription.deleteMany({ where: { userId } });
            await prisma.evaluationReport.deleteMany({ where: { userId } });
            await prisma.interviewSession.deleteMany({ where: { userId } });
            await prisma.resume.deleteMany({ where: { userId } });
            await prisma.user.delete({ where: { id: userId } });

            // 2. Delete from Supabase Auth
            const { error } = await supabase.auth.admin.deleteUser(userId);
            if (error) {
                fastify.log.error({ userId: maskUserId(userId) }, "Failed to delete Supabase auth user");
                // DB rows are already gone, so we still return success
            }

            return { message: "Account deleted successfully." };
        } catch (err: any) {
            fastify.log.error(sanitizeForLog(err), "Account deletion failed");
            return reply.status(500).send({
                error: "Deletion Failed",
                message: err.message || "Failed to delete account.",
            });
        }
    });

    // ─── Forgot Password (Request Reset Link) ──────────────────
    const forgotPasswordSchema = z.object({
        email: z.string().email("Invalid email address"),
    });

    fastify.post("/auth/forgot-password", async (request, reply) => {
        const rl = checkRateLimit(`auth:forgot:${request.ip}`, 3, 900_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Too many password reset requests. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const parsed = forgotPasswordSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { email } = parsed.data;

        try {
            // Check if user exists in our database
            const user = await prisma.user.findUnique({
                where: { email },
                select: { id: true, fullName: true, email: true },
            });

            // Always return success to prevent email enumeration
            // But only send email if user exists
            if (user) {
                await sendPasswordResetEmail(user.email, user.fullName);
            }

            return {
                message: "If an account exists with this email, you will receive a password reset link shortly.",
            };
        } catch (err: any) {
            fastify.log.error(sanitizeForLog(err), "Password reset request failed");
            // Still return success to prevent email enumeration
            return {
                message: "If an account exists with this email, you will receive a password reset link shortly.",
            };
        }
    });
}
