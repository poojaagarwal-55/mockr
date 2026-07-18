import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Admin client — uses service role key, bypasses RLS
// Use for server-side operations (creating users, admin queries)
let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
    if (!adminClient) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!url || !serviceKey) {
            throw new Error(
                "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars"
            );
        }

        adminClient = createClient(url, serviceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        });
    }

    return adminClient;
}

// Per-request client — uses the user's JWT to make requests as that user
export function getSupabaseClient(accessToken: string): SupabaseClient {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
        throw new Error(
            "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env vars"
        );
    }

    return createClient(url, anonKey, {
        global: {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        },
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
}
