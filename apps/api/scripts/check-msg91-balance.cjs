/**
 * Check MSG91 account balance
 * Usage: node apps/api/scripts/check-msg91-balance.cjs
 */

const axios = require('axios');
require('dotenv').config({ path: 'apps/api/.env' });

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;

async function checkBalance() {
  if (!MSG91_AUTH_KEY) {
    console.error('❌ MSG91_AUTH_KEY not found in environment');
    return;
  }

  console.log('💰 Checking MSG91 account balance...');
  console.log('Auth Key:', MSG91_AUTH_KEY.substring(0, 10) + '...');
  console.log('');

  try {
    const response = await axios.get(
      `https://control.msg91.com/api/v5/balance?authkey=${MSG91_AUTH_KEY}`,
      {
        headers: {
          'content-type': 'application/json',
        },
      }
    );

    console.log('✅ Balance Response:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('❌ Error checking balance:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error(error.message);
    }
  }
}

checkBalance();
