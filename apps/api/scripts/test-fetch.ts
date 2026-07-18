import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    const questions = await prisma.question.findMany({
        where: {
            category: "DSA",
            difficulty: { in: ["Easy", "Medium"] },
            isActive: true,
        },
        select: {
            id: true,
            title: true,
            category: true,
            difficulty: true,
        }
    });
    
    console.log("Found questions:", questions.length);
    console.log(questions.slice(0, 3));
}

main().catch(console.error).finally(() => prisma.$disconnect());
