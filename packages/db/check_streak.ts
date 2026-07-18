import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, currentStreak: true, longestStreak: true, lastActivityDate: true },
    orderBy: { lastActivityDate: 'desc' },
    take: 5
  });
  console.log(JSON.stringify(users, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
