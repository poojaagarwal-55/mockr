import { NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

function getSafeNextPath(value: string | null) {
    if (!value || !value.startsWith('/') || value.startsWith('//')) return '/login'
    return value
}

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')
    const next = getSafeNextPath(searchParams.get('next'))
    const error = searchParams.get('error')
    const errorDesc = searchParams.get('error_description')

    if (error) {
        const params = new URLSearchParams()
        params.set('error', errorDesc || error)
        if (next !== '/login') params.set('next', next)
        return NextResponse.redirect(`${origin}/login?${params.toString()}`)
    }

    if (code) {
        const cookieStore = await cookies()
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    get(name: string) {
                        return cookieStore.get(name)?.value
                    },
                    set(name: string, value: string, options: CookieOptions) {
                        try {
                            cookieStore.set({ name, value, ...options })
                        } catch (error) {
                            // Ignore standard error from Next.js server component constraint
                        }
                    },
                    remove(name: string, options: CookieOptions) {
                        try {
                            cookieStore.delete({ name, ...options })
                        } catch (error) {
                            // Ignore standard error from Next.js server component constraint
                        }
                    },
                },
            }
        )

        const { error: sessionError } = await supabase.auth.exchangeCodeForSession(code)

        if (!sessionError) {
            return NextResponse.redirect(`${origin}${next}`)
        }

        // Fallback error if exchange failed
        const params = new URLSearchParams()
        params.set('error', sessionError.message)
        if (next !== '/login') params.set('next', next)
        return NextResponse.redirect(`${origin}/login?${params.toString()}`)
    }

    // If no code, return to login with generic error
    return NextResponse.redirect(`${origin}/login?error=auth`)
}
