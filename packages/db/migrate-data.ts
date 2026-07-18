import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting data migration...');

  // 1. Move SQL questions
  const sqlQuestions = await prisma.question.findMany({
    where: { category: 'SQL' }
  });
  console.log(`Found ${sqlQuestions.length} SQL questions to migrate.`);

  for (const q of sqlQuestions) {
    await prisma.questionSql.upsert({
      where: { slug: q.slug },
      update: {},
      create: {
        id: q.id,
        slug: q.slug,
        title: q.title,
        category: q.category,
        subcategory: q.subcategory,
        difficulty: q.difficulty,
        problemMd: q.problemMd,
        constraints: q.constraints,
        examples: q.examples as any,
        hints: q.hints as any,
        followUpQuestions: q.followUpQuestions as any,
        tags: q.tags,
        companies: q.companies,
        targetRoles: q.targetRoles,
        targetLevels: q.targetLevels,
        isActive: q.isActive,
        createdAt: q.createdAt,
        updatedAt: q.updatedAt,
      }
    });
  }

  // 2. Move Fundamental questions (not DSA, not SQL)
  const fundamentalQuestions = await prisma.question.findMany({
    where: {
      category: { notIn: ['DSA', 'SQL'] }
    }
  });
  console.log(`Found ${fundamentalQuestions.length} Fundamental questions to migrate.`);

  for (const q of fundamentalQuestions) {
    await prisma.questionFundamental.upsert({
      where: { questionID: q.id },
      update: {},
      create: {
        questionID: q.id,
        question: q.problemMd || q.title,
        answer: null, // As requested
        hint: Array.isArray(q.hints) ? (q.hints as string[]).join('\n') : JSON.stringify(q.hints),
      }
    });
  }

  // 3. Delete migrated questions from original table
  // Since we have ON DELETE CASCADE, this cleans up their old analytis etc.
  const toDeleteIds = [...sqlQuestions, ...fundamentalQuestions].map(q => q.id);
  
  if (toDeleteIds.length > 0) {
    console.log(`Deleting ${toDeleteIds.length} migrated questions from original table...`);
    await prisma.question.deleteMany({
      where: { id: { in: toDeleteIds } }
    });
  }

  console.log('Migration completed successfully.');
}

main()
  .catch(e => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
