/**
 * Check User Interview Minutes
 * 
 * This script checks a user's minute wallet and ledger entries
 * to diagnose why minutes aren't being added after phone verification.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkUserCredits() {
  try {
    // Get the user's email from command line or use a default
    const userEmail = process.argv[2];
    
    if (!userEmail) {
      console.log('\n❌ Please provide a user email:');
      console.log('   node apps/api/scripts/check-user-credits.cjs user@example.com\n');
      process.exit(1);
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('🔍 User Interview Minutes Diagnostic');
    console.log('═══════════════════════════════════════════════════════\n');

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: {
        id: true,
        email: true,
        fullName: true,
        mobile: true,
        mobileVerified: true,
        mobileVerifiedAt: true,
      },
    });

    if (!user) {
      console.log(`❌ User not found: ${userEmail}\n`);
      process.exit(1);
    }

    console.log('📋 User Information:\n');
    console.log(`   ID: ${user.id}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Name: ${user.fullName}`);
    console.log(`   Mobile: ${user.mobile || 'NOT SET'}`);
    console.log(`   Mobile Verified: ${user.mobileVerified ? '✅ YES' : '❌ NO'}`);
    console.log(`   Verified At: ${user.mobileVerifiedAt || 'N/A'}\n`);

    // Check minute wallet
    const wallet = await prisma.creditWallet.findUnique({
      where: { userId: user.id },
    });

    console.log('═══════════════════════════════════════════════════════');
    console.log('💰 Interview Minute Wallet:\n');

    if (!wallet) {
      console.log('   ❌ NO WALLET FOUND');
      console.log('   This user has never had a minute wallet created.\n');
    } else {
      console.log(`   Wallet ID: ${wallet.id}`);
      console.log(`   Free Minutes: ${wallet.freeCreditsRemaining}`);
      console.log(`   Free Minutes Granted: ${wallet.freeCreditsGranted ? 'YES' : 'NO'}`);
      console.log(`   Monthly Balance: ${wallet.monthlyBalance}`);
      console.log(`   Purchased Balance: ${wallet.purchasedBalance}`);
      console.log(`   Created At: ${wallet.createdAt}`);
      console.log(`   Updated At: ${wallet.updatedAt}\n`);
    }

    // Check minute ledger
    const ledgerEntries = await prisma.creditLedger.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    console.log('═══════════════════════════════════════════════════════');
    console.log('📊 Minute Ledger (Last 10 entries):\n');

    if (ledgerEntries.length === 0) {
      console.log('   ❌ NO LEDGER ENTRIES FOUND');
      console.log('   No minute transactions have been recorded.\n');
    } else {
      ledgerEntries.forEach((entry, index) => {
        console.log(`   ${index + 1}. ${entry.reason}`);
        console.log(`      Bucket: ${entry.bucket}`);
        console.log(`      Delta: ${entry.delta > 0 ? '+' : ''}${entry.delta}`);
        console.log(`      Balance After: ${JSON.stringify(entry.balanceAfter)}`);
        console.log(`      Created: ${entry.createdAt}`);
        console.log('');
      });
    }

    // Diagnosis
    console.log('═══════════════════════════════════════════════════════');
    console.log('🔍 Diagnosis:\n');

    if (!user.mobileVerified) {
      console.log('   ❌ Phone NOT verified');
      console.log('   → User needs to complete phone verification first\n');
    } else if (!wallet) {
      console.log('   ❌ Phone verified but NO wallet created');
      console.log('   → This is a BUG! Wallet should be created during verification\n');
      console.log('   💡 Fix: The verification endpoint might have failed silently\n');
    } else if (wallet.freeCreditsRemaining === 0) {
      console.log('   ⚠️  Phone verified, wallet exists, but 0 minutes');
      console.log('   → Minutes might have been used or not granted properly\n');
      
      const phoneVerificationEntry = ledgerEntries.find(e =>
        e.reason === 'PHONE_VERIFICATION_MINUTES_REWARD' || e.reason === 'PHONE_VERIFICATION_REWARD'
      );
      if (!phoneVerificationEntry) {
        console.log('   ❌ NO phone verification reward in ledger');
        console.log('   → Minutes were never granted!\n');
      } else {
        console.log('   ✅ Phone verification reward found in ledger');
        console.log('   → Minutes were granted but may have been used\n');
      }
    } else {
      console.log('   ✅ Everything looks good!');
      console.log(`   → User has ${wallet.freeCreditsRemaining} free minutes\n`);
    }

    console.log('═══════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUserCredits();
