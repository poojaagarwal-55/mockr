/**
 * Test /users/me Endpoint
 * 
 * This script calls the /users/me endpoint and shows exactly what's returned
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');

async function testUsersMe() {
  const email = process.argv[2];
  const password = process.argv[3];
  
  if (!email || !password) {
    console.log('\n❌ Please provide email and password:');
    console.log('   node apps/api/scripts/test-users-me-endpoint.cjs user@example.com password\n');
    process.exit(1);
  }

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('🔍 Testing /users/me Endpoint');
  console.log('═══════════════════════════════════════════════════════\n');

  try {
    // 1. Login to get session token
    console.log('🔐 Logging in...');
    const loginResponse = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!loginResponse.ok) {
      console.log(`❌ Login failed: ${loginResponse.status} ${loginResponse.statusText}\n`);
      const error = await loginResponse.text();
      console.log('Error:', error);
      process.exit(1);
    }

    const loginData = await loginResponse.json();
    const token = loginData.session.accessToken;
    console.log(`✅ Logged in successfully\n`);

    // 2. Call /users/me
    console.log('📡 Calling /users/me...');
    const meResponse = await fetch(`${API_URL}/users/me`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!meResponse.ok) {
      console.log(`❌ /users/me failed: ${meResponse.status} ${meResponse.statusText}\n`);
      const error = await meResponse.text();
      console.log('Error:', error);
      process.exit(1);
    }

    const userData = await meResponse.json();
    
    console.log('✅ Response received\n');
    console.log('═══════════════════════════════════════════════════════');
    console.log('📋 User Data:\n');
    console.log(JSON.stringify(userData, null, 2));
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('🔍 Mobile Verification Status:\n');
    console.log(`   mobile: ${userData.mobile || 'NOT SET'}`);
    console.log(`   mobileVerified: ${userData.mobileVerified}`);
    console.log(`   mobileVerified type: ${typeof userData.mobileVerified}`);
    console.log(`   mobileVerifiedAt: ${userData.mobileVerifiedAt || 'NOT SET'}`);
    console.log('\n═══════════════════════════════════════════════════════\n');

    if (userData.mobileVerified === undefined) {
      console.log('❌ PROBLEM: mobileVerified is undefined!');
      console.log('   This means the API is not returning this field.\n');
    } else if (userData.mobileVerified === false) {
      console.log('⚠️  mobileVerified is false');
      console.log('   User needs to verify their phone number.\n');
    } else if (userData.mobileVerified === true) {
      console.log('✅ mobileVerified is true');
      console.log('   Phone is verified! Banner should be hidden.\n');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
  }
}

testUsersMe();
