import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Get the latest session with a resume
  const session = await prisma.interviewSession.findFirst({
    where: { resumeId: { not: null } },
    orderBy: { createdAt: 'desc' },
    include: {
      resume: { select: { analysis: true } },
    },
  });

  if (!session) {
    console.log('No sessions with resume found');
    return;
  }

  console.log('Session ID:', session.id);
  console.log('Resume ID:', session.resumeId);
  
  const analysis = session.resume?.analysis as any;
  console.log('\n=== analysis type:', typeof analysis);
  console.log('=== analysis is null:', analysis === null);
  console.log('=== analysis raw:', JSON.stringify(analysis));
  console.log('=== analysis top keys:', analysis ? Object.keys(analysis) : 'NULL or empty');
  console.log('=== analysis.summary type:', typeof analysis?.summary);
  
  // Check ALL resumes
  const resumes = await prisma.resume.findMany({
    select: { id: true, fileName: true, analysis: true },
  });
  console.log('\n=== All resumes:');
  for (const r of resumes) {
    const a = r.analysis as any;
    const keys = a ? Object.keys(a) : [];
    const hasSummary = !!a?.summary;
    console.log(`  ${r.id} | ${r.fileName} | keys: [${keys.join(',')}] | hasSummary: ${hasSummary}`);
  }
}

main().then(() => process.exit(0));
