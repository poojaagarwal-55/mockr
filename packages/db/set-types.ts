import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const fundamentals = await prisma.questionFundamental.findMany();
    
    for (const q of fundamentals) {
        let qType = 'General';
        const text = q.question.toLowerCase();
        
        if (text.includes('process vs thread') || text.includes('acid properties')) {
            qType = 'OS';
        } else if (text.includes('tcp vs udp')) {
            qType = 'Networking';
        } else if (text.includes('solid principles')) {
            qType = 'OOP';
        }

        await prisma.questionFundamental.update({
            where: { questionID: q.questionID },
            data: { questionType: qType }
        });
        
        console.log(`Updated ${q.questionID} with type ${qType}`);
    }
}

main().finally(() => prisma.$disconnect());
