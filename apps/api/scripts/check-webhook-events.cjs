const { PrismaClient } = require('@interviewforge/db');

async function main() {
  const prisma = new PrismaClient();

  try {
    const [webhookEvents, paymentWebhookEvents] = await Promise.all([
      prisma.webhookEvent.findMany({
        orderBy: { id: 'desc' },
        take: 5
      }),
      prisma.paymentWebhookEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5
      })
    ]);

    console.log('\n=== WEBHOOK EVENTS ===');
    console.log(`Total count: ${webhookEvents.length}`);
    if (webhookEvents.length > 0) {
      console.log(JSON.stringify(webhookEvents, null, 2));
    } else {
      console.log('No webhook events found');
    }

    console.log('\n=== PAYMENT WEBHOOK EVENTS ===');
    console.log(`Total count: ${paymentWebhookEvents.length}`);
    if (paymentWebhookEvents.length > 0) {
      console.log(JSON.stringify(paymentWebhookEvents, null, 2));
    } else {
      console.log('No payment webhook events found');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
