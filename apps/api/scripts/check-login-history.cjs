#!/usr/bin/env node

/**
 * Check login history for a user to debug email sending
 * Usage: node apps/api/scripts/check-login-history.cjs <email>
 */

require('dotenv').config({ path: '.env' });
require('dotenv').config({ path: 'apps/api/.env' });
require('dotenv').config({ path: 'apps/api/.env.local' });

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkLoginHistory() {
  const email = process.argv[2];
  
  if (!email) {
    console.error('❌ Please provide an email address');
    console.log('\nUsage: node apps/api/scripts/check-login-history.cjs <email>\n');
    process.exit(1);
  }

  console.log(`\n🔍 Checking login history for: ${email}\n`);

  try {
    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        fullName: true,
        createdAt: true,
        lastLoginAt: true,
        lastLoginIp: true,
        lastLoginLocation: true,
      },
    });

    if (!user) {
      console.error(`❌ User not found with email: ${email}\n`);
      process.exit(1);
    }

    console.log('👤 User Information:');
    console.log(`   ID: ${user.id}`);
    console.log(`   Name: ${user.fullName}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Created: ${user.createdAt.toLocaleString()}`);
    console.log(`   Last Login: ${user.lastLoginAt ? user.lastLoginAt.toLocaleString() : 'Never'}`);
    console.log(`   Last IP: ${user.lastLoginIp || 'N/A'}`);
    console.log(`   Last Location: ${user.lastLoginLocation || 'N/A'}\n`);

    // Get login history
    const loginHistory = await prisma.loginHistory.findMany({
      where: { userId: user.id },
      orderBy: { loginAt: 'desc' },
      take: 10,
    });

    if (loginHistory.length === 0) {
      console.log('📝 No login history found\n');
    } else {
      console.log(`📝 Recent Login History (${loginHistory.length} entries):\n`);
      
      loginHistory.forEach((login, index) => {
        console.log(`   ${index + 1}. ${login.loginAt.toLocaleString()}`);
        console.log(`      IP: ${login.ipAddress}`);
        console.log(`      Device: ${login.browser} on ${login.os} (${login.deviceType})`);
        console.log(`      Location: ${login.location || 'Unknown'}`);
        console.log('');
      });

      // Check for recent logins (last 5 minutes)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const recentLogins = loginHistory.filter(l => l.loginAt >= fiveMinutesAgo);
      
      if (recentLogins.length > 1) {
        console.log(`⚠️  Found ${recentLogins.length} logins in the last 5 minutes`);
        console.log('   This would prevent login notification emails from being sent\n');
      } else if (recentLogins.length === 1) {
        console.log('✅ Only 1 login in the last 5 minutes - email should have been sent\n');
      }
    }

    // Check if user was created recently (would get welcome email instead)
    const userAge = Date.now() - user.createdAt.getTime();
    const userAgeMinutes = Math.floor(userAge / 60000);
    
    if (userAgeMinutes < 10) {
      console.log(`ℹ️  User was created ${userAgeMinutes} minutes ago`);
      console.log('   New users receive a WELCOME email instead of login notification\n');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

checkLoginHistory().catch(console.error);
