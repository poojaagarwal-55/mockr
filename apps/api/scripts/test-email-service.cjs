#!/usr/bin/env node

/**
 * Test script to verify email service is working
 * Usage: node apps/api/scripts/test-email-service.cjs
 */

require('dotenv').config({ path: '.env' });
require('dotenv').config({ path: 'apps/api/.env' });
require('dotenv').config({ path: 'apps/api/.env.local' });

async function testEmailService() {
  console.log('\n🔍 Testing Email Service Configuration...\n');

  // Check if Resend API key is configured
  const resendApiKey = process.env.RESEND_API_KEY;
  
  if (!resendApiKey) {
    console.error('❌ RESEND_API_KEY is not configured in .env file');
    console.log('\nPlease add RESEND_API_KEY to your .env file:');
    console.log('RESEND_API_KEY=re_xxxxxxxxxxxxx\n');
    process.exit(1);
  }

  console.log('✅ RESEND_API_KEY is configured');
  console.log(`   Key: ${resendApiKey.substring(0, 10)}...${resendApiKey.substring(resendApiKey.length - 4)}\n`);

  // Check FROM email
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  console.log(`📧 FROM Email: ${fromEmail}\n`);

  // Try to send a test email
  console.log('📤 Attempting to send test email...\n');

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(resendApiKey);

    const testEmail = process.argv[2] || 'test@example.com';
    
    console.log(`   Sending to: ${testEmail}`);
    console.log(`   From: ${fromEmail}\n`);

    const result = await resend.emails.send({
      from: fromEmail,
      to: testEmail,
      subject: 'Test Email from Mockr',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #2563eb;">Email Service Test</h1>
          <p>This is a test email from your Mockr application.</p>
          <p>If you received this email, your email service is configured correctly! ✅</p>
          <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
          <p style="color: #6b7280; font-size: 14px;">
            Sent at: ${new Date().toLocaleString()}
          </p>
        </div>
      `,
    });

    console.log('✅ Email sent successfully!');
    console.log(`   Email ID: ${result.data?.id || 'N/A'}\n`);
    
    if (result.error) {
      console.error('⚠️  Warning:', result.error);
    }

  } catch (error) {
    console.error('❌ Failed to send email:', error.message);
    console.error('\nError details:', error);
    process.exit(1);
  }

  console.log('✅ Email service test completed!\n');
}

testEmailService().catch(console.error);
