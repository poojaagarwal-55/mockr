/**
 * Test script to verify Resend email configuration
 * Run with: node apps/api/scripts/test-resend-email.cjs
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Resend } = require('resend');

async function testResendEmail() {
  console.log('\n🔍 Testing Resend Email Configuration...\n');

  // Check API key
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('❌ RESEND_API_KEY not found in environment variables');
    process.exit(1);
  }

  console.log('✅ RESEND_API_KEY found:', apiKey.substring(0, 10) + '...');

  // Initialize Resend
  const resend = new Resend(apiKey);

  // Test 1: Send a test email
  console.log('\n📧 Sending test email...');
  try {
    const result = await resend.emails.send({
      from: 'Practers <noreply@practers.com>',
      to: 'thearpit2005@gmail.com', // Your email
      subject: 'Test Email from Practers',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #4A7CFF;">🎉 Resend Email Test</h2>
          <p>If you're reading this, your Resend configuration is working correctly!</p>
          <div style="background: #f4f5f7; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Test Details:</strong></p>
            <ul>
              <li>From: Practers &lt;noreply@practers.com&gt;</li>
              <li>To: thearpit2005@gmail.com</li>
              <li>Time: ${new Date().toLocaleString()}</li>
            </ul>
          </div>
          <p style="color: #666; font-size: 12px;">This is a test email from your Practers application.</p>
        </div>
      `,
    });

    console.log('✅ Email sent successfully!');
    console.log('📬 Email ID:', result.data?.id);
    console.log('\n⚠️  IMPORTANT: Check your inbox (and spam folder) for the test email');
    console.log('📧 Sent to: thearpit2005@gmail.com');
    
  } catch (error) {
    console.error('❌ Failed to send email:', error.message);
    
    if (error.message.includes('domain')) {
      console.error('\n🔧 DOMAIN ISSUE DETECTED:');
      console.error('   The domain "practers.com" may not be verified in Resend.');
      console.error('\n   Solutions:');
      console.error('   1. Verify your domain in Resend dashboard: https://resend.com/domains');
      console.error('   2. Or use Resend\'s test domain temporarily:');
      console.error('      Change from: "Practers <noreply@practers.com>"');
      console.error('      To: "Practers <onboarding@resend.dev>"');
    }
    
    if (error.message.includes('API key')) {
      console.error('\n🔧 API KEY ISSUE:');
      console.error('   Your API key may be invalid or expired.');
      console.error('   Get a new one from: https://resend.com/api-keys');
    }
    
    process.exit(1);
  }

  // Test 2: List domains
  console.log('\n🌐 Checking configured domains...');
  try {
    const domains = await resend.domains.list();
    
    if (domains.data && domains.data.data && domains.data.data.length > 0) {
      console.log('✅ Found domains:');
      domains.data.data.forEach(domain => {
        const status = domain.status === 'verified' ? '✅' : '⚠️';
        console.log(`   ${status} ${domain.name} - Status: ${domain.status}`);
      });
    } else {
      console.log('⚠️  No domains configured');
      console.log('   You can still send emails using onboarding@resend.dev');
    }
  } catch (error) {
    console.log('⚠️  Could not fetch domains:', error.message);
  }

  console.log('\n✨ Test complete!\n');
}

testResendEmail().catch(console.error);
