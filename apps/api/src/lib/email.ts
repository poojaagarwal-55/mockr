import { Resend } from "resend";

const ADMIN_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL;

export interface SendEmailOptions {
    to: string;
    subject: string;
    html: string;
    isAuthEmail?: boolean; // Flag to determine which API key to use
}

/**
 * Generic email sending function
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
    // Use auth API key for authentication emails, regular key for bug reports
    const apiKey = options.isAuthEmail 
        ? process.env.RESEND_AUTH_API_KEY 
        : process.env.RESEND_API_KEY;
    
    if (!apiKey) {
        console.warn("[Email] API key not set — skipping email");
        return;
    }

    try {
        const resend = new Resend(apiKey);
        
        // Always use practers.com domain (verified)
        const fromAddress = "Practers <noreply@practers.com>";
        
        const result = await resend.emails.send({
            from: fromAddress,
            to: options.to,
            subject: options.subject,
            html: options.html,
        });
        
        console.log(`[Email] Email sent to ${options.to} (ID: ${result.data?.id || 'unknown'})`);
    } catch (err: any) {
        console.error("[Email] Failed to send email:", err?.message);
        console.error("[Email] Error details:", err);
        throw new Error("Failed to send email");
    }
}

export interface QuestionReportEmailData {
    reportId: string;
    userId: string;
    userEmail?: string;
    questionId: string;
    questionType: string;
    questionTitle?: string | null;
    reason: string;
    description?: string | null;
    sessionId?: string | null;
    createdAt: Date;
}

const REASON_LABELS: Record<string, string> = {
    wrong_answer:     "Wrong / Incorrect Answer",
    typo:             "Typo or Grammar Issue",
    broken_test_case: "Broken Test Case",
    misleading:       "Misleading Problem Statement",
    other:            "Other",
};

export async function sendQuestionReportEmail(data: QuestionReportEmailData) {
    if (!process.env.RESEND_API_KEY) {
        console.warn("[Email] RESEND_API_KEY not set — skipping notification email");
        return;
    }
    if (!ADMIN_EMAIL) {
        console.warn("[Email] ADMIN_NOTIFICATION_EMAIL not set — skipping notification email");
        return;
    }

    const reasonLabel = REASON_LABELS[data.reason] ?? data.reason;
    const typeLabel   = data.questionType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

    const html = `
        <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 24px; border-radius: 12px;">
            <div style="background: #ef4444; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px;">
                <h1 style="color: white; margin: 0; font-size: 18px;">🚩 Question Bug Report</h1>
                <p style="color: #fecaca; margin: 4px 0 0; font-size: 13px;">A user has flagged an issue with a question on Practers.</p>
            </div>

            <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                <tr style="background: #f1f5f9;">
                    <td style="padding: 10px 16px; font-weight: 600; font-size: 13px; color: #64748b; width: 36%;">Report ID</td>
                    <td style="padding: 10px 16px; font-size: 13px; color: #1e293b; font-family: monospace;">${data.reportId}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 16px; font-weight: 600; font-size: 13px; color: #64748b;">Question Type</td>
                    <td style="padding: 10px 16px; font-size: 13px; color: #1e293b;">${typeLabel}</td>
                </tr>
                <tr style="background: #f1f5f9;">
                    <td style="padding: 10px 16px; font-weight: 600; font-size: 13px; color: #64748b;">Question Title</td>
                    <td style="padding: 10px 16px; font-size: 13px; color: #1e293b;">${data.questionTitle ?? "(not set)"}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 16px; font-weight: 600; font-size: 13px; color: #64748b;">Question ID</td>
                    <td style="padding: 10px 16px; font-size: 13px; color: #1e293b; font-family: monospace;">${data.questionId}</td>
                </tr>
                <tr style="background: #f1f5f9;">
                    <td style="padding: 10px 16px; font-weight: 600; font-size: 13px; color: #64748b;">Reason</td>
                    <td style="padding: 10px 16px; font-size: 13px; color: #dc2626; font-weight: 600;">${reasonLabel}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 16px; font-weight: 600; font-size: 13px; color: #64748b;">Description</td>
                    <td style="padding: 10px 16px; font-size: 13px; color: #1e293b;">${data.description ?? "(none provided)"}</td>
                </tr>
                <tr style="background: #f1f5f9;">
                    <td style="padding: 10px 16px; font-weight: 600; font-size: 13px; color: #64748b;">Reported By</td>
                    <td style="padding: 10px 16px; font-size: 13px; color: #1e293b;">${data.userEmail ?? data.userId}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 16px; font-weight: 600; font-size: 13px; color: #64748b;">Session ID</td>
                    <td style="padding: 10px 16px; font-size: 13px; color: #1e293b; font-family: monospace;">${data.sessionId ?? "—"}</td>
                </tr>
                <tr style="background: #f1f5f9;">
                    <td style="padding: 10px 16px; font-weight: 600; font-size: 13px; color: #64748b;">Reported At</td>
                    <td style="padding: 10px 16px; font-size: 13px; color: #1e293b;">${data.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</td>
                </tr>
            </table>

            <p style="margin-top: 20px; font-size: 12px; color: #94a3b8; text-align: center;">Practers — Question Bug Report System</p>
        </div>
    `;

    try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
            from:    "Practers <noreply@practers.com>",
            to:      ADMIN_EMAIL,
            subject: `🚩 Bug Report: ${data.questionTitle ?? data.questionId} [${typeLabel}]`,
            html,
        });
        console.log(`[Email] Bug report notification sent for question ${data.questionId}`);
    } catch (err: any) {
        console.error("[Email] Failed to send bug report notification:", err?.message);
        // Don't throw — email failure should never block the API response
    }
}
