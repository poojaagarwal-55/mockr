/**
 * Test MSG91 Widget Configuration
 * 
 * This script verifies that your MSG91 widget is properly configured
 * and that the authkey matches the widget.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');

const MSG91_WIDGET_ID = process.env.MSG91_WIDGET_ID;
const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_WIDGET_TOKEN = process.env.MSG91_WIDGET_TOKEN;

console.log('\n═══════════════════════════════════════════════════════');
console.log('🔍 MSG91 Widget Configuration Diagnostic');
console.log('═══════════════════════════════════════════════════════\n');

console.log('📋 Current Configuration:\n');
console.log(`Widget ID: ${MSG91_WIDGET_ID}`);
console.log(`Auth Key: ${MSG91_AUTH_KEY}`);
console.log(`Widget Token: ${MSG91_WIDGET_TOKEN}\n`);

console.log('═══════════════════════════════════════════════════════');
console.log('🔍 Checking MSG91 Widget Configuration\n');

async function checkWidgetConfig() {
  try {
    // Try to get widget data using the widget ID
    console.log('🔄 Attempting to fetch widget configuration...\n');
    
    // MSG91 doesn't have a public API to check widget config,
    // but we can verify the authkey is valid by trying to send an OTP
    console.log('✅ Testing authkey validity by attempting OTP send...\n');
    
    const testPhone = '919999999999'; // Test number (won't actually send)
    
    try {
      const response = await axios.post(
        'https://control.msg91.com/api/v5/otp',
        {
          mobile: testPhone,
          template_id: MSG91_WIDGET_ID,
        },
        {
          headers: {
            'authkey': MSG91_AUTH_KEY,
            'Content-Type': 'application/json',
          },
        }
      );
      
      console.log('📥 OTP API Response:');
      console.log(`   Status: ${response.status}`);
      console.log(`   Data:`, JSON.stringify(response.data, null, 2));
      
      if (response.data.type === 'success') {
        console.log('\n✅ Auth key is VALID and working!');
        console.log('✅ Widget ID is recognized by MSG91!');
      }
    } catch (error) {
      if (error.response) {
        console.log('📥 OTP API Response:');
        console.log(`   Status: ${error.response.status}`);
        console.log(`   Data:`, JSON.stringify(error.response.data, null, 2));
        
        const errorData = error.response.data;
        
        if (errorData.message === 'AuthenticationFailure' || errorData.code === '418') {
          console.log('\n❌ PROBLEM FOUND: Authentication Failure');
          console.log('\n🔍 Possible Causes:');
          console.log('   1. The authkey does not match the widget');
          console.log('   2. The widget ID is incorrect');
          console.log('   3. The authkey is from a different MSG91 account');
          console.log('\n💡 Solution:');
          console.log('   1. Go to MSG91 Dashboard: https://control.msg91.com/');
          console.log('   2. Navigate to: OTP → Widget');
          console.log('   3. Find your widget and verify:');
          console.log('      - Widget ID matches: ' + MSG91_WIDGET_ID);
          console.log('      - Widget Token matches: ' + MSG91_WIDGET_TOKEN);
          console.log('   4. Go to: Settings → API Keys');
          console.log('   5. Copy the "authkey" and verify it matches: ' + MSG91_AUTH_KEY);
          console.log('\n⚠️  IMPORTANT: All three values must be from the SAME MSG91 account!');
        } else if (errorData.message && errorData.message.includes('template')) {
          console.log('\n⚠️  Widget/Template Issue');
          console.log('   The authkey is valid but the widget ID might be wrong.');
          console.log('   Verify the Widget ID in MSG91 dashboard.');
        } else {
          console.log('\n⚠️  Unexpected error:', errorData.message);
        }
      } else {
        console.error('\n❌ Network error:', error.message);
      }
    }
    
  } catch (error) {
    console.error('\n❌ Diagnostic failed:', error.message);
  }
}

async function testAccessTokenVerification() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('🔍 Testing Access Token Verification Endpoint\n');
  
  // Create a fake JWT-like token to test the endpoint
  const fakeToken = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJtb2JpbGUiOiI5MTk5OTk5OTk5OTkiLCJleHAiOjE3MDAwMDAwMDB9.fake_signature';
  
  console.log('🔄 Testing with fake access token...\n');
  
  try {
    const response = await axios.post(
      'https://control.msg91.com/api/v5/widget/verifyAccessToken',
      {
        authkey: MSG91_AUTH_KEY,
        'access-token': fakeToken,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
    
    console.log('📥 Response:');
    console.log(`   Status: ${response.status}`);
    console.log(`   Data:`, JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    if (error.response) {
      console.log('📥 Response:');
      console.log(`   Status: ${error.response.status}`);
      console.log(`   Data:`, JSON.stringify(error.response.data, null, 2));
      
      const errorData = error.response.data;
      
      if (errorData.code === '418' && errorData.message === 'AuthenticationFailure') {
        console.log('\n❌ CONFIRMED: The authkey is being rejected by MSG91');
        console.log('\n🔍 This means:');
        console.log('   - The authkey value is incorrect, OR');
        console.log('   - The authkey is from a different MSG91 account than the widget');
        console.log('\n💡 Action Required:');
        console.log('   1. Login to MSG91: https://control.msg91.com/');
        console.log('   2. Go to Settings → API Keys');
        console.log('   3. Copy the AUTHKEY (not API key, not token)');
        console.log('   4. Update MSG91_AUTH_KEY in your .env file');
        console.log('   5. Make sure the authkey is from the SAME account as the widget');
      }
    }
  }
}

(async () => {
  await checkWidgetConfig();
  await testAccessTokenVerification();
  
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('📊 Diagnostic Complete\n');
  console.log('🎯 Next Steps:\n');
  console.log('1. Verify all credentials are from the SAME MSG91 account');
  console.log('2. Double-check the authkey in MSG91 Dashboard → Settings → API Keys');
  console.log('3. Ensure the widget is active and published');
  console.log('4. Update .env files with correct values');
  console.log('5. Restart dev server\n');
  console.log('═══════════════════════════════════════════════════════\n');
})();
