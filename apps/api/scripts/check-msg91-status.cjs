/**
 * Check MSG91 OTP delivery status
 * Usage: node apps/api/scripts/check-msg91-status.cjs [request_id]
 */

const axios = require('axios');
require('dotenv').config({ path: 'apps/api/.env' });

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const REQUEST_ID = process.argv[2] || '3665616343725251556b7557'; // Default to latest

async function checkMSG91Status() {
  if (!MSG91_AUTH_KEY) {
    console.error('❌ MSG91_AUTH_KEY not found in environment');
    return;
  }

  console.log('🔍 Checking MSG91 OTP status...');
  console.log('Request ID:', REQUEST_ID);
  console.log('Auth Key:', MSG91_AUTH_KEY.substring(0, 10) + '...');
  console.log('');

  try {
    // Get OTP analytics
    const today = new Date().toISOString().split('T')[0];
    const analyticsUrl = `https://control.msg91.com/api/v5/report/analytics/p/otp?startDate=${today}&endDate=${today}&authkey=${MSG91_AUTH_KEY}`;
    
    console.log('📊 Fetching OTP analytics...');
    const analyticsResponse = await axios.get(analyticsUrl, {
      headers: {
        'content-type': 'application/json',
      },
    });

    console.log('✅ Analytics Response:');
    console.log(JSON.stringify(analyticsResponse.data, null, 2));
    console.log('');

    // Try to get specific request status
    try {
      const statusUrl = `https://control.msg91.com/api/v5/otp/status/${REQUEST_ID}`;
      console.log('📱 Fetching specific OTP status...');
      
      const statusResponse = await axios.get(statusUrl, {
        headers: {
          'authkey': MSG91_AUTH_KEY,
          'content-type': 'application/json',
        },
      });

      console.log('✅ Status Response:');
      console.log(JSON.stringify(statusResponse.data, null, 2));
    } catch (statusError) {
      console.log('⚠️  Could not fetch specific request status');
      if (statusError.response) {
        console.log('Error:', statusError.response.data);
      }
    }

  } catch (error) {
    console.error('❌ Error checking MSG91 status:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error(error.message);
    }
  }
}

checkMSG91Status();
