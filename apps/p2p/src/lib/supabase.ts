import { createClient, type User } from "@supabase/supabase-js";

type UserAuth = {
    id: string;
    email: string;
};

let supabaseClient: ReturnType<typeof createClient> | null = null;

function getSupabaseClient() {
    if (supabaseClient) {
        return supabaseClient;
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error("Missing Supabase env for p2p service: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
    }

    supabaseClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });

    return supabaseClient;
}

export async function verifyAccessToken(token: string): Promise<UserAuth | null> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.getUser(token);
    const user = data.user as User | null;

    if (error || !user || !user.email) {
        return null;
    }

    return { id: user.id, email: user.email };
}
