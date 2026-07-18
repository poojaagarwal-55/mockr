// ============================================
// Seed Script — New DSA Questions
// ============================================
// Run: npx tsx prisma/seed-new-questions.ts
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

type LegacyQuestionClient = {
    question: {
        upsert(args: unknown): Promise<any>;
        count(args?: unknown): Promise<number>;
    };
    questionStarter: {
        upsert(args: unknown): Promise<any>;
    };
    questionTestCase: {
        deleteMany(args: unknown): Promise<any>;
        create(args: unknown): Promise<any>;
    };
    questionAnalytics: {
        upsert(args: unknown): Promise<any>;
    };
};

function getLegacyQuestionClient(): LegacyQuestionClient | null {
    const candidate = prisma as unknown as Partial<LegacyQuestionClient>;

    if (
        !candidate.question ||
        !candidate.questionStarter ||
        !candidate.questionTestCase ||
        !candidate.questionAnalytics
    ) {
        return null;
    }

    return candidate as LegacyQuestionClient;
}

// All question data is defined in seed-questions-data.ts
import { allNewQuestions } from './seed-questions-data';

async function main() {
    console.log('🌱 Seeding new DSA questions...');

    const legacy = getLegacyQuestionClient();
    if (!legacy) {
        console.warn('⚠️ Legacy question Prisma models are not present in this schema. Skipping seed-new-questions script.');
        return;
    }

    for (const q of allNewQuestions) {
        const { starters, testCases, ...questionData } = q as any;

        const question = await legacy.question.upsert({
            where: { slug: questionData.slug },
            update: {
                title: questionData.title,
                problemMd: questionData.problemMd,
                constraints: questionData.constraints,
                examples: questionData.examples,
                hints: questionData.hints || [],
                followUpQuestions: questionData.followUpQuestions || [],
            },
            create: {
                slug: questionData.slug,
                title: questionData.title,
                category: questionData.category,
                subcategory: questionData.subcategory,
                difficulty: questionData.difficulty,
                problemMd: questionData.problemMd,
                constraints: questionData.constraints,
                examples: questionData.examples || [],
                hints: questionData.hints || [],
                followUpQuestions: questionData.followUpQuestions || [],
                tags: questionData.tags || [],
                companies: questionData.companies || [],
                targetRoles: questionData.targetRoles || [],
                targetLevels: questionData.targetLevels || [],
            },
        });

        // Seed starters (with wrapper code)
        if (starters) {
            for (const s of starters) {
                await legacy.questionStarter.upsert({
                    where: {
                        questionId_language: { questionId: question.id, language: s.language },
                    },
                    update: { starter: s.starter, wrapperCode: s.wrapperCode || null, solution: s.solution || null },
                    create: {
                        questionId: question.id,
                        language: s.language,
                        starter: s.starter,
                        wrapperCode: s.wrapperCode || null,
                        solution: s.solution || null,
                    },
                });
            }
        }

        // Seed test cases
        if (testCases) {
            await legacy.questionTestCase.deleteMany({ where: { questionId: question.id } });
            for (const tc of testCases) {
                await legacy.questionTestCase.create({
                    data: {
                        questionId: question.id,
                        input: tc.input,
                        expected: tc.expected,
                        type: tc.type || 'sample',
                        orderIdx: tc.orderIdx || 0,
                    },
                });
            }
        }

        // Initialize analytics
        await legacy.questionAnalytics.upsert({
            where: { questionId: question.id },
            update: {},
            create: { questionId: question.id },
        });

        console.log(`  ✅ ${question.category}/${question.difficulty}: ${question.title}`);
    }

    const count = await legacy.question.count();
    console.log(`\n🎉 Total questions in DB: ${count}`);
}

main()
    .catch((e) => {
        console.error('❌ Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
