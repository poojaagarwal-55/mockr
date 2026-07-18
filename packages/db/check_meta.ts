import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase env vars");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data, error } = await supabase.auth.admin.listUsers();
    if (error) {
        console.error("Error:", error);
        return;
    }

    const user = data.users.find(u => u.email === "fahadkorba@gmail.com");
    if (user) {
        console.log(JSON.stringify(user.user_metadata, null, 2));
        console.log("Identity Data:", JSON.stringify(user.identities, null, 2));
    } else {
        console.log("User not found");
    }
}

check();
