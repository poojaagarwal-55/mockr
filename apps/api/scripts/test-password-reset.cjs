#!/usr/bin/env node
/**
 * Test script for password reset flow
 * Usage: node apps/api/scripts/test-password-reset.cjs <email>
 */

require("dotenv").config({ path: "apps/api/.env" });
const { createClient } = require("@supabase/supabase-js");

const email = process.argv[2];

if (!email) {
  console.error("❌ Usage: node apps/api/scripts/test-password-reset.cjs <email>");
  process.exit(1);
}

async function testPasswordReset() {
  console.log("🔐 Testing Password Reset Flow\n");
  console.log("━".repeat(60));

  // 1. Check environment variables
  console.log("\n📋 Step 1: Checking environment variables...");
  const requiredEnvVars = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_API_URL",
  ];

  const missing = requiredEnvVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`❌ Missing environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log("✅ All required environment variables are set");
  console.log(`   Supabase URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log(`   API URL: ${process.env.NEXT_PUBLIC_API_URL}`);

  // 2. Initialize Supabase client
  console.log("\n📋 Step 2: Initializing Supabase admin client...");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
  console.log("✅ Supabase client initialized");

  // 3. Check if user exists
  console.log(`\n📋 Step 3: Checking if user exists (${email})...`);
  const { data: users, error: listError } = await supabase.auth.admin.listUsers();
  
  if (listError) {
    console.error("❌ Failed to list users:", listError.message);
    process.exit(1);
  }

  const user = users.users.find((u) => u.email === email);
  if (!user) {
    console.error(`❌ User not found: ${email}`);
    console.log("\n💡 Available users:");
    users.users.forEach((u) => console.log(`   - ${u.email}`));
    process.exit(1);
  }

  console.log("✅ User found");
  console.log(`   User ID: ${user.id}`);
  console.log(`   Email: ${user.email}`);
  console.log(`   Created: ${new Date(user.created_at).toLocaleString()}`);

  // 4. Generate redirect URL
  const webAppUrl = process.env.NEXT_PUBLIC_API_URL.replace("3001", "3000");
  const redirectUrl = `${webAppUrl}/auth/reset-password`;
  
  console.log(`\n📋 Step 4: Generating password reset link...`);
  console.log(`   Redirect URL: ${redirectUrl}`);

  // 5. Send password reset email
  const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: redirectUrl,
  });

  if (resetError) {
    console.error("❌ Failed to send password reset email:", resetError.message);
    
    if (resetError.message.includes("redirect")) {
      console.log("\n⚠️  IMPORTANT: The redirect URL might not be whitelisted!");
      console.log("   Go to Supabase Dashboard → Authentication → URL Configuration");
      console.log(`   Add this URL to Redirect URLs: ${redirectUrl}`);
    }
    
    process.exit(1);
  }

  console.log("✅ Password reset email sent successfully!");
  console.log("\n━".repeat(60));
  console.log("\n✅ Test completed successfully!");
  console.log("\n📧 Next steps:");
  console.log(`   1. Check ${email} for the password reset email`);
  console.log("   2. Click the link in the email");
  console.log("   3. You should be redirected to the reset password page");
  console.log("   4. The page should show 'Set new password' form");
  console.log("\n⚠️  If you see 'Link expired or invalid':");
  console.log("   - Check Supabase Dashboard → Authentication → URL Configuration");
  console.log(`   - Ensure ${redirectUrl} is whitelisted`);
  console.log("   - Check Supabase logs for any errors");
}

testPasswordReset().catch((err) => {
  console.error("\n❌ Unexpected error:", err);
  process.exit(1);
});
