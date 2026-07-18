/**
 * Test MSG91 Widget credentials
 * Usage: node apps/api/scripts/test-msg91-widget.cjs
 */

const axios = require('axios');
require('dotenv').config({ path: 'apps/api/.env' });

const MSG91_WIDGET_ID = process.env.MSG91_WIDGET_ID;
const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;

async function testWidget() {
  console.log('🧪 Testing MSG91 Widget Configuration...\n');
  
  console.log('Widget ID:', MSG91_WIDGET_ID || 'NOT SET');
  console.log('Auth Key:', MSG91_AUTH_KEY ? MSG91_AUTH_KEY.substring(0, 10) + '...' : 'NOT SET');
  console.log('');

  if (!MSG91_WIDGET_ID || !MSG91_AUTH_KEY) {
    console.error('❌ MSG91 credentials not configured');
    return;
  }

  // Test sending OTP using the regular OTP API (not widget API)
  try {
    console.log('📤 Testing Send OTP API (Regular OTP endpoint)...');
    const testMobile = '919876543210'; // Without + sign
    const response = await axios.post(
      'https://control.msg91.com/api/v5/otp',
      {
        mobile: testMobile,
        template_id: MSG91_WIDGET_ID, // Optional: use widget ID as template
      },
      {
        headers: {
          'authkey': MSG91_AUTH_KEY,
          'content-type': 'application/json',
        },
      }
    );

    console.log('✅ Send OTP Response:');
    console.log(JSON.stringify(response.data, null, 2));
    
    if (response.data.type === 'success') {
      console.log('\n✅ Widget is configured correctly!');
      console.log('Request ID:', response.data.data?.reqId);
    } else {
      console.log('\n⚠️  Widget responded but with an error');
    }
  } catch (error) {
    console.error('\n❌ Error testing widget:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
      
      if (error.response.status === 401) {
        console.error('\n💡 Authentication failed. Possible issues:');
        console.error('   1. Widget ID is incorrect');
        console.error('   2. Auth Key is incorrect');
        console.error('   3. Widget is not created in MSG91 dashboard');
        console.error('   4. Widget is disabled');
      }
    } else {
      console.error(error.message);
    }
  }
}

testWidget();
