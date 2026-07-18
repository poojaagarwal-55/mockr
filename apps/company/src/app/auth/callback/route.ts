import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

const DEFAULT_API_BASE = "http://localhost:3001";
const NO_COMPANY_ACCESS_ERROR = "no_company_access";
const COMPANY_ACCESS_CHECK_FAILED_ERROR = "company_access_check_failed";

function companyBasePath() {
    return process.env.COMPANY_BASE_PATH || (process.env.VERCEL === "1" ? "" : "/companies");
}

function apiBaseUrl() {
    return (process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || DEFAULT_API_BASE).replace(/\/$/, "");
}

function companyUrl(origin: string, path: string) {
    const basePath = companyBasePath().replace(/\/$/, "");
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${origin}${basePath}${cleanPath}`;
}

function loginErrorUrl(origin: string, error: string) {
    return companyUrl(origin, `/login?error=${encodeURIComponent(error)}`);
}

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get("code");
    const next = searchParams.get("next") || "/dashboard";
    const error = searchParams.get("error");
    const errorDesc = searchParams.get("error_description");

    if (error) {
        return NextResponse.redirect(loginErrorUrl(origin, errorDesc || error));
    }

    if (code) {
        const cookieStore = await cookies();
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    get(name: string) {
                        return cookieStore.get(name)?.value;
                    },
                    set(name: string, value: string, options: CookieOptions) {
                        try {
                            cookieStore.set({ name, value, ...options });
                        } catch {
                            // Next may block cookie writes in constrained render paths.
                        }
                    },
                    remove(name: string, options: CookieOptions) {
                        try {
                            cookieStore.delete({ name, ...options });
                        } catch {
                            // Next may block cookie writes in constrained render paths.
                        }
                    },
                },
            }
        );

        const { error: sessionError } = await supabase.auth.exchangeCodeForSession(code);

        if (!sessionError) {
            const {
                data: { session },
            } = await supabase.auth.getSession();

            if (!session?.access_token) {
                return NextResponse.redirect(loginErrorUrl(origin, "auth"));
            }

            try {
                const accessResponse = await fetch(`${apiBaseUrl()}/companies/me`, {
                    cache: "no-store",
                    headers: {
                        Authorization: `Bearer ${session.access_token}`,
                    },
                });

                if (!accessResponse.ok) {
                    await supabase.auth.signOut();
                    return NextResponse.redirect(
                        loginErrorUrl(
                            origin,
                            accessResponse.status >= 500 ? COMPANY_ACCESS_CHECK_FAILED_ERROR : NO_COMPANY_ACCESS_ERROR
                        )
                    );
                }
            } catch {
                await supabase.auth.signOut();
                return NextResponse.redirect(loginErrorUrl(origin, COMPANY_ACCESS_CHECK_FAILED_ERROR));
            }

            return NextResponse.redirect(companyUrl(origin, next));
        }

        return NextResponse.redirect(loginErrorUrl(origin, sessionError.message));
    }

    return NextResponse.redirect(loginErrorUrl(origin, "auth"));
}
