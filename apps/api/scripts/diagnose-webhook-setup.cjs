// Diagnose webhook setup
// Usage: node scripts/diagnose-webhook-setup.cjs

const fs = require('fs');
const path = require('path');

console.log('\n🔍 Webhook Setup Diagnostic\n');
console.log('='.repeat(50));

// Check 1: Environment variables
console.log('\n1️⃣ Checking Environment Variables...');
const envFiles = [
  '.env',
  'apps/api/.env',
  'apps/api/.env.local',
];

let webhookSecretFound = false;
let razorpayKeyFound = false;

for (const envFile of envFiles) {
  const fullPath = path.resolve(process.cwd(), envFile);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf-8');
    
    if (content.includes('RAZORPAY_WEBHOOK_SECRET')) {
      const match = content.match(/RAZORPAY_WEBHOOK_SECRET=(.+)/);
      if (match && match[1].trim() && !match[1].includes('your_')) {
        console.log(`   ✅ RAZORPAY_WEBHOOK_SECRET found in ${envFile}`);
        console.log(`      Value: ${match[1].trim().slice(0, 15)}...`);
        webhookSecretFound = true;
      } else {
        console.log(`   ⚠️  RAZORPAY_WEBHOOK_SECRET found but not set in ${envFile}`);
      }
    }

    if (content.includes('RAZORPAY_KEY_ID')) {
      const match = content.match(/RAZORPAY_KEY_ID=(.+)/);
      if (match && match[1].trim() && !match[1].includes('your_')) {
        console.log(`   ✅ RAZORPAY_KEY_ID found in ${envFile}`);
        razorpayKeyFound = true;
      }
    }
  }
}

if (!webhookSecretFound) {
  console.log('   ❌ RAZORPAY_WEBHOOK_SECRET not found or not set!');
  console.log('   📝 Action: Add to apps/api/.env.local:');
  console.log('      RAZORPAY_WEBHOOK_SECRET=whsec_your_secret_here');
}

if (!razorpayKeyFound) {
  console.log('   ❌ RAZORPAY_KEY_ID not found!');
}

// Check 2: Webhook route registration
console.log('\n2️⃣ Checking Webhook Route Registration...');
const indexPath = path.resolve(process.cwd(), 'apps/api/src/index.ts');
if (fs.existsSync(indexPath)) {
  const content = fs.readFileSync(indexPath, 'utf-8');
  
  if (content.includes('webhookRoutes')) {
    console.log('   ✅ webhookRoutes imported');
  } else {
    console.log('   ❌ webhookRoutes not imported!');
  }

  if (content.includes('register(webhookRoutes)')) {
    console.log('   ✅ webhookRoutes registered');
  } else {
    console.log('   ❌ webhookRoutes not registered!');
  }
} else {
  console.log('   ⚠️  Could not find apps/api/src/index.ts');
}

// Check 3: Webhook handler exists
console.log('\n3️⃣ Checking Webhook Handler...');
const webhookPath = path.resolve(process.cwd(), 'apps/api/src/routes/webhooks.ts');
if (fs.existsSync(webhookPath)) {
  const content = fs.readFileSync(webhookPath, 'utf-8');
  
  if (content.includes('/webhooks/razorpay')) {
    console.log('   ✅ Webhook route defined: /webhooks/razorpay');
  } else {
    console.log('   ❌ Webhook route not found!');
  }

  if (content.includes('validateWebhookSignature') || content.includes('verifyRazorpaySignature')) {
    console.log('   ✅ Signature verification implemented');
  } else {
    console.log('   ⚠️  Signature verification might be missing');
  }

  if (content.includes('paymentWebhookEvent') || content.includes('webhookEvent')) {
    console.log('   ✅ Webhook event persistence implemented');
  } else {
    console.log('   ⚠️  Webhook event persistence might be missing');
  }
} else {
  console.log('   ❌ Webhook handler not found at apps/api/src/routes/webhooks.ts');
}

// Check 4: API server status
console.log('\n4️⃣ Checking API Server...');
const apiUrl = process.env.API_URL || 'http://localhost:3001';

fetch(`${apiUrl}/health`)
  .then(res => {
    if (res.ok) {
      console.log(`   ✅ API server is running at ${apiUrl}`);
      return res.json();
    } else {
      console.log(`   ⚠️  API server responded with status ${res.status}`);
      return null;
    }
  })
  .then(data => {
    if (data) {
      console.log(`   📊 Health check:`, data);
    }
  })
  .catch(err => {
    console.log(`   ❌ API server is not running at ${apiUrl}`);
    console.log(`      Error: ${err.message}`);
    console.log('   📝 Action: Start API server with: npm run dev');
  })
  .finally(() => {
    // Check 5: ngrok status
    console.log('\n5️⃣ Checking ngrok Tunnel...');
    
    fetch('http://127.0.0.1:4040/api/tunnels')
      .then(res => res.json())
      .then(data => {
        if (data.tunnels && data.tunnels.length > 0) {
          const tunnel = data.tunnels.find(t => t.proto === 'https');
          if (tunnel) {
            console.log('   ✅ ngrok tunnel is running');
            console.log(`   🌐 Public URL: ${tunnel.public_url}`);
            console.log(`   📍 Webhook URL: ${tunnel.public_url}/webhooks/razorpay`);
            console.log('\n   📝 Action: Copy this URL to Razorpay Dashboard:');
            console.log(`      ${tunnel.public_url}/webhooks/razorpay`);
          } else {
            console.log('   ⚠️  ngrok running but no HTTPS tunnel found');
          }
        } else {
          console.log('   ❌ No ngrok tunnels found');
        }
      })
      .catch(err => {
        console.log('   ❌ ngrok is not running');
        console.log('   📝 Action: Start ngrok with: ngrok http 3001');
      })
      .finally(() => {
        // Summary
        console.log('\n' + '='.repeat(50));
        console.log('\n📋 Summary\n');

        if (webhookSecretFound && razorpayKeyFound) {
          console.log('✅ Environment variables configured');
        } else {
          console.log('❌ Missing environment variables');
        }

        console.log('\n📝 Next Steps:');
        console.log('1. Make sure API server is running: npm run dev');
        console.log('2. Start ngrok tunnel: ngrok http 3001');
        console.log('3. Copy ngrok URL to Razorpay Dashboard');
        console.log('4. Test webhook: node scripts/test-webhook-endpoint.cjs');
        console.log('5. Make a test payment and check logs');
        console.log('\n');
      });
  });
