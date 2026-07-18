#!/usr/bin/env node
/**
 * Test script to verify deviceToken cookie is being set correctly
 * 
 * Usage: node apps/api/scripts/test-device-cookie.cjs
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

async function testDeviceCookie() {
    console.log("🧪 Testing Device Token Cookie System\n");
    console.log(`API Base: ${API_BASE}\n`);

    try {
        // Test 1: Login and check for Set-Cookie header
        console.log("1️⃣ Testing /auth/sync endpoint...");
        
        const response = await fetch(`${API_BASE}/auth/sync`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                // You'll need to add a valid Bearer token here
                "Authorization": "Bearer YOUR_TOKEN_HERE"
            },
            credentials: "include" // Important: allows cookies
        });

        console.log(`   Status: ${response.status}`);
        
        // Check Set-Cookie header
        const setCookieHeader = response.headers.get("set-cookie");
        if (setCookieHeader) {
            console.log(`   ✅ Set-Cookie header found:`);
            console.log(`   ${setCookieHeader}`);
            
            // Parse cookie details
            if (setCookieHeader.includes("deviceToken=")) {
                console.log(`   ✅ deviceToken cookie is being set!`);
                
                // Check cookie attributes
                const hasHttpOnly = setCookieHeader.includes("HttpOnly");
                const hasSameSite = setCookieHeader.includes("SameSite");
                const hasPath = setCookieHeader.includes("Path=/");
                const hasMaxAge = setCookieHeader.includes("Max-Age");
                
                console.log(`   Cookie attributes:`);
                console.log(`     - HttpOnly: ${hasHttpOnly ? "✅" : "❌"}`);
                console.log(`     - SameSite: ${hasSameSite ? "✅" : "❌"}`);
                console.log(`     - Path=/: ${hasPath ? "✅" : "❌"}`);
                console.log(`     - Max-Age: ${hasMaxAge ? "✅" : "❌"}`);
            } else {
                console.log(`   ❌ deviceToken cookie NOT found in Set-Cookie header`);
            }
        } else {
            console.log(`   ⚠️  No Set-Cookie header found`);
            console.log(`   This might mean:`);
            console.log(`     - User already has a valid deviceToken cookie`);
            console.log(`     - Authentication failed`);
            console.log(`     - Cookie was not set due to configuration issue`);
        }

        const data = await response.json();
        console.log(`\n   Response body:`, JSON.stringify(data, null, 2));

    } catch (error) {
        console.error("❌ Test failed:", error.message);
        console.error("\nMake sure:");
        console.error("  1. API server is running on port 3001");
        console.error("  2. You have a valid Bearer token");
        console.error("  3. The user exists in the database");
    }

    console.log("\n" + "=".repeat(60));
    console.log("📝 How to test in browser:");
    console.log("=".repeat(60));
    console.log("1. Open DevTools → Application → Cookies");
    console.log("2. Look for cookies under 'localhost' (not localhost:3000)");
    console.log("3. You should see 'deviceToken' cookie there");
    console.log("4. If not visible, check Network tab → Response Headers → Set-Cookie");
    console.log("=".repeat(60));
}

testDeviceCookie();
