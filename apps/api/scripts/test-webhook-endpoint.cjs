// Test webhook endpoint locally
// Usage: node scripts/test-webhook-endpoint.cjs

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Load environment variables from .env.local
const envLocalPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envLocalPath)) {
  const envContent = fs.readFileSync(envLocalPath, 'utf-8');
  envContent.split(/\r?\n/).forEach(line => {
    // Skip empty lines and comments
    if (!line || line.trim().startsWith('#')) return;
    
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      // Remove quotes if present
      value = value.replace(/^["'](.*)["']$/, '$1');
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
  console.log('✅ Loaded .env.local');
  console.log('📝 RAZORPAY_WEBHOOK_SECRET found:', process.env.RAZORPAY_WEBHOOK_SECRET ? 'Yes' : 'No');
  if (process.env.RAZORPAY_WEBHOOK_SECRET) {
    console.log('🔑 Secret value:', process.env.RAZORPAY_WEBHOOK_SECRET);
  }
} else {
  console.log('⚠️  .env.local not found at:', envLocalPath);
}

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'your_webhook_secret_here';
const API_URL = process.env.API_URL || 'http://localhost:3001';

console.log('🔑 Using webhook secret:', WEBHOOK_SECRET);

// Sample webhook payload from Razorpay
const samplePayload = {
  entity: 'event',
  account_id: 'acc_test123',
  event: 'payment.captured',
  contains: ['payment'],
  payload: {
    payment: {
      entity: {
        id: 'pay_test123',
        entity: 'payment',
        amount: 99900,
        currency: 'INR',
        status: 'captured',
        order_id: 'order_test123',
        method: 'card',
        amount_refunded: 0,
        captured: true,
        description: 'Test Payment',
        email: 'test@example.com',
        contact: '+919999999999',
        created_at: Math.floor(Date.now() / 1000),
      }
    }
  },
  created_at: Math.floor(Date.now() / 1000)
};

async function testWebhook() {
  console.log('\n🧪 Testing Webhook Endpoint\n');
  console.log('API URL:', API_URL);
  console.log('Webhook Secret:', WEBHOOK_SECRET.slice(0, 10) + '...\n');

  // Create signature
  const payloadString = JSON.stringify(samplePayload);
  const signature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(payloadString)
    .digest('hex');

  console.log('📦 Payload:', JSON.stringify(samplePayload, null, 2));
  console.log('\n🔐 Signature:', signature);

  try {
    console.log('\n📡 Sending webhook to:', `${API_URL}/webhooks/razorpay`);
    
    const response = await fetch(`${API_URL}/webhooks/razorpay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature,
      },
      body: payloadString,
    });

    console.log('\n✅ Response Status:', response.status, response.statusText);
    
    const responseText = await response.text();
    console.log('📄 Response Body:', responseText);

    if (response.ok) {
      console.log('\n✅ SUCCESS! Webhook endpoint is working correctly.');
      console.log('\nNext steps:');
      console.log('1. Check API logs for webhook processing');
      console.log('2. Run: node scripts/check-latest-payment.cjs');
      console.log('3. Verify payment_webhook_events and webhook_events tables');
    } else {
      console.log('\n❌ FAILED! Webhook endpoint returned an error.');
      console.log('\nTroubleshooting:');
      console.log('1. Check if API server is running');
      console.log('2. Verify RAZORPAY_WEBHOOK_SECRET in .env');
      console.log('3. Check API logs for errors');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.log('\nTroubleshooting:');
    console.log('1. Is API server running? Check: http://localhost:3001/health');
    console.log('2. Is the URL correct?', API_URL);
    console.log('3. Check firewall/network settings');
  }
}

// Run test
testWebhook().catch(console.error);
