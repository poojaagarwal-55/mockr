import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
    const user = await prisma.user.findFirst({ where: { email: "fahadkorba@gmail.com" } });
    console.log("DB User:", JSON.stringify(user, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
