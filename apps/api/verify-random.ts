import { prisma } from './src/lib/prisma';

async function main() {
    const difficulties = ["Easy", "Medium"];
    const whereClause = {
        category: "DSA",
        difficulty: { in: difficulties },
        isActive: true,
    };
    const totalMatching = await prisma.question.count({ where: whereClause });
    console.log(`Total DSA (Easy/Medium) questions: ${totalMatching}`);

    const counts: Record<string, number> = {};
    for (let i = 0; i < 100; i++) {
        const randomSkip = Math.floor(Math.random() * totalMatching);
        const question = await prisma.question.findFirst({
            where: whereClause,
            skip: randomSkip,
            select: { id: true, title: true }
        });
        if (question && question.title) {
            counts[question.title] = (counts[question.title] || 0) + 1;
        }
    }
    console.log("Selection distribution (100 runs):");
    console.table(counts);
}

main().catch(console.error);
