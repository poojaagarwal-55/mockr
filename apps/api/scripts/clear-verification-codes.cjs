/**
 * Clear old verification codes for testing
 * Usage: node apps/api/scripts/clear-verification-codes.cjs
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function clearVerificationCodes() {
  try {
    console.log('🧹 Clearing old verification codes...');

    const result = await prisma.verificationCode.deleteMany({
      where: {
        type: 'phone',
      },
    });

    console.log(`✅ Deleted ${result.count} phone verification codes`);
    console.log('You can now request a new OTP immediately!');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

clearVerificationCodes();
