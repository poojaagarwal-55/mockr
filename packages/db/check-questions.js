require('dotenv').config({ path: '../../apps/.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const questions = await prisma.question.findMany({ select: { slug: true, title: true } });
    console.log("Total length:", questions.length);
    require('fs').writeFileSync('out.json', JSON.stringify(questions, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
