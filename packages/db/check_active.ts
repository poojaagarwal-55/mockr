import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany({
    where: { lastActivityDate: { not: null } },
    select: { id: true, email: true, currentStreak: true, longestStreak: true, lastActivityDate: true },
  });
  console.log("USERS WITH STREAKS:", JSON.stringify(users, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
