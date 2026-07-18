import { sendEmail } from "../lib/email.js";
import { getSupabaseAdmin } from "../lib/supabase.js";

interface LoginNotificationData {
  userName: string;
  userEmail: string;
  device: string;
  location: string;
  time: string;
  ipAddress: string;
  resetPasswordUrl: string;
}

/**
 * Send login notification email
 */
export async function sendLoginNotification(data: LoginNotificationData): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8f9fa; padding: 20px;">
      <div style="background: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <h2 style="color: #1a1a1a; margin-bottom: 20px;">New sign-in to your account</h2>
        
        <p style="color: #666; line-height: 1.6;">
          Hi ${data.userName},
        </p>
        
        <p style="color: #666; line-height: 1.6;">
          We noticed a new sign-in to your Practers account. If this was you, you can safely ignore this email.
        </p>
        
        <div style="background: #f8f9fa; border-left: 4px solid #4A7CFF; padding: 15px; margin: 20px 0;">
          <p style="margin: 5px 0; color: #333;"><strong>Device:</strong> ${data.device}</p>
          <p style="margin: 5px 0; color: #333;"><strong>Location:</strong> ${data.location}</p>
          <p style="margin: 5px 0; color: #333;"><strong>Time:</strong> ${data.time}</p>
          <p style="margin: 5px 0; color: #333;"><strong>IP Address:</strong> ${data.ipAddress}</p>
        </div>
        
        <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; padding: 15px; margin: 20px 0;">
          <p style="margin: 0; color: #856404; font-weight: 600;">
            ⚠️ Wasn't you?
          </p>
          <p style="margin: 10px 0 0 0; color: #856404;">
            If you don't recognize this activity, change your password immediately.
          </p>
        </div>
        
        <a href="${data.resetPasswordUrl}" style="display: inline-block; background: #dc3545; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 10px 0;">
          Change Password
        </a>
        
        <p style="color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
          This email was sent to ${data.userEmail} because it's registered to a Practers account.
        </p>
      </div>
    </div>
  `;

  await sendEmail({
    to: data.userEmail,
    subject: "New sign-in to your Practers account",
    isAuthEmail: true, // Use auth API key
    html,
  });
}

/**
 * Send welcome email after email verification
 */
export async function sendWelcomeEmail(userEmail: string, userName: string): Promise<void> {
  const firstName = userName.split(" ")[0] || userName;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to Practers</title>
  <style>
    .header-title { color: #ffffff !important; }
    .header-subtitle { color: #a8c0f8 !important; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f0f2f7;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1a2547 0%,#2d3a7c 50%,#1e4db7 100%);border-radius:16px 16px 0 0;padding:40px 40px 36px;text-align:center;">
              <img src="https://practers.com/practers_logo.png" alt="Practers" width="200" style="display:block;margin:0 auto 24px;" />
              <h1 class="header-title" style="margin:0 0 8px;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.3px;">You're in. Let's get you interview-ready.</h1>
              <p class="header-subtitle" style="margin:0;color:#a8c0f8;font-size:15px;line-height:1.5;">Your AI-powered interview preparation starts now.</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:40px 40px 32px;">
              <p style="margin:0 0 20px;color:#1a1a2e;font-size:17px;font-weight:600;">Hi ${firstName},</p>
              <p style="margin:0 0 28px;color:#4a5568;font-size:15px;line-height:1.7;">
                Welcome to Practers — the platform built to help engineers land their dream roles. Whether you're targeting top-tier tech companies or fast-growing startups, we've got everything you need to walk into your next interview with confidence.
              </p>

              <!-- What you can do -->
              <p style="margin:0 0 16px;color:#1a1a2e;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">What you can do on Practers</p>

              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">
                <tr>
                  <td style="padding-bottom:14px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="36" valign="top" style="padding-top:2px;">
                          <div style="width:32px;height:32px;background:#e8f0fe;border-radius:8px;text-align:center;line-height:32px;font-size:16px;">🎯</div>
                        </td>
                        <td style="padding-left:14px;">
                          <p style="margin:0 0 2px;color:#1a1a2e;font-size:14px;font-weight:600;">AI Mock Interviews</p>
                          <p style="margin:0;color:#718096;font-size:13px;line-height:1.5;">Practice DSA, system design, and behavioral rounds with a real-time AI interviewer that adapts to your level.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:14px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="36" valign="top" style="padding-top:2px;">
                          <div style="width:32px;height:32px;background:#e8f0fe;border-radius:8px;text-align:center;line-height:32px;font-size:16px;">📊</div>
                        </td>
                        <td style="padding-left:14px;">
                          <p style="margin:0 0 2px;color:#1a1a2e;font-size:14px;font-weight:600;">Instant Feedback & Analysis</p>
                          <p style="margin:0;color:#718096;font-size:13px;line-height:1.5;">Get a detailed breakdown of your answers — clarity, depth, correctness — so you know exactly what to improve.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:14px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="36" valign="top" style="padding-top:2px;">
                          <div style="width:32px;height:32px;background:#e8f0fe;border-radius:8px;text-align:center;line-height:32px;font-size:16px;">🤝</div>
                        </td>
                        <td style="padding-left:14px;">
                          <p style="margin:0 0 2px;color:#1a1a2e;font-size:14px;font-weight:600;">Peer Interview Practice</p>
                          <p style="margin:0;color:#718096;font-size:13px;line-height:1.5;">Match with other candidates for live mock sessions — give and receive real feedback from engineers in the field.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:14px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="36" valign="top" style="padding-top:2px;">
                          <div style="width:32px;height:32px;background:#e8f0fe;border-radius:8px;text-align:center;line-height:32px;font-size:16px;">📄</div>
                        </td>
                        <td style="padding-left:14px;">
                          <p style="margin:0 0 2px;color:#1a1a2e;font-size:14px;font-weight:600;">Resume Builder & AI Review</p>
                          <p style="margin:0;color:#718096;font-size:13px;line-height:1.5;">Build an ATS-friendly resume and get AI-powered suggestions tailored to the roles you're applying for.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:28px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="36" valign="top" style="padding-top:2px;">
                          <div style="width:32px;height:32px;background:#e8f0fe;border-radius:8px;text-align:center;line-height:32px;font-size:16px;">🔥</div>
                        </td>
                        <td style="padding-left:14px;">
                          <p style="margin:0 0 2px;color:#1a1a2e;font-size:14px;font-weight:600;">Streaks & Progress Tracking</p>
                          <p style="margin:0;color:#718096;font-size:13px;line-height:1.5;">Stay consistent with daily streaks, track weak areas, and watch your performance improve over time.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Tip box -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFE500;border-radius:12px;margin-bottom:28px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 6px;color:#1a1a2e;font-size:14px;font-weight:700;">💡 Start here</p>
                    <p style="margin:0;color:#1a1a2e;font-size:13px;line-height:1.6;">Complete your profile and take your first AI mock interview — most users see measurable improvement within their first 3 sessions.</p>
                  </td>
                </tr>
              </table>

              <p style="margin:0;color:#718096;font-size:14px;line-height:1.6;">
                If you have any questions, just reply to this email — we read every message and are happy to help.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f7f9ff;border-radius:0 0 16px 16px;border-top:1px solid #e8edf5;padding:28px 40px;text-align:center;">
              <p style="margin:0 0 8px;color:#a0aec0;font-size:12px;line-height:1.6;">
                You received this email because you created a Practers account with <strong>${userEmail}</strong>.
              </p>
              <p style="margin:0;color:#a0aec0;font-size:12px;">
                © ${new Date().getFullYear()} Practers. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
  `;

  await sendEmail({
    to: userEmail,
    subject: "Welcome to Practers — let's get you interview-ready 🚀",
    isAuthEmail: true,
    html,
  });
}

/**
 * Generate a password reset link using Supabase's built-in password recovery
 * For login notifications - generates a magic link
 */
export async function generatePasswordResetLink(userEmail: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const redirectUrl = `${process.env.NEXT_PUBLIC_API_URL?.replace("3001", "3000") || "http://localhost:3000"}/auth/reset-password`;
  
  // Trigger Supabase's password recovery flow
  // This will send an email from Supabase, but we'll also send our own
  const { error } = await supabase.auth.resetPasswordForEmail(userEmail, {
    redirectTo: redirectUrl,
  });

  if (error) {
    console.error("[Auth] Failed to trigger Supabase password recovery:", error.message);
  }

  // Return a user-friendly message URL since we can't get the actual token
  // The user will receive Supabase's email with the real recovery link
  return `${redirectUrl}?email=${encodeURIComponent(userEmail)}`;
}

/**
 * Send password reset email using Supabase's built-in recovery flow
 */
export async function sendPasswordResetEmail(
  userEmail: string,
  userName: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  
  // Use the web app URL (port 3000) for the redirect
  const webAppUrl = process.env.NEXT_PUBLIC_API_URL?.replace("3001", "3000") || "http://localhost:3000";
  const redirectUrl = `${webAppUrl}/auth/reset-password`;
  
  console.log(`[Email] Sending password reset email to ${userEmail} with redirect: ${redirectUrl}`);
  
  // Trigger Supabase's password recovery - this sends their email with the real token
  const { error } = await supabase.auth.resetPasswordForEmail(userEmail, {
    redirectTo: redirectUrl,
  });

  if (error) {
    console.error(`[Email] Failed to send password reset email:`, error);
    throw new Error(`Failed to send password reset email: ${error.message}`);
  }

  console.log(`[Email] Password reset email sent successfully via Supabase to ${userEmail}`);
}

/**
 * Send password changed confirmation email
 */
export async function sendPasswordChangedEmail(
  userEmail: string,
  userName: string
): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL?.replace("3001", "3000") || "http://localhost:3000";
  const resetPasswordUrl = `${baseUrl}/login?tab=login`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <h2 style="color: #1a1a1a;">Password changed successfully</h2>
        
        <p style="color: #666; line-height: 1.6;">
          Hi ${userName},
        </p>
        
        <p style="color: #666; line-height: 1.6;">
          Your Practers account password was changed successfully.
        </p>
        
        <div style="background: #d4edda; border-left: 4px solid #28a745; padding: 15px; margin: 20px 0;">
          <p style="margin: 0; color: #155724;">
            ✅ Your account is now secured with your new password.
          </p>
        </div>
        
        <div style="background: #f8d7da; border-left: 4px solid #dc3545; padding: 15px; margin: 20px 0;">
          <p style="margin: 0 0 10px 0; color: #721c24; font-weight: 600;">
            ⚠️ Didn't change your password?
          </p>
          <p style="margin: 0; color: #721c24;">
            If you didn't make this change, your account may be compromised. Contact support immediately.
          </p>
        </div>
        
        <a href="${resetPasswordUrl}" style="display: inline-block; background: #dc3545; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 10px 0;">
          Secure My Account
        </a>
      </div>
    </div>
  `;

  await sendEmail({
    to: userEmail,
    subject: "Your Practers password was changed",
    isAuthEmail: true, // Use auth API key
    html,
  });
}
