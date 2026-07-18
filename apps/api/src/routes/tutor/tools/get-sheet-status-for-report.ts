import { prisma } from "../../../lib/prisma.js";
import type { TutorToolRunInput } from "../tool-types.js";

export async function runGetSheetStatusForReportTool(input: TutorToolRunInput) {
    const sheet = await prisma.questionSheet.findFirst({
        where: { reportId: input.context.report.id },
        select: {
            id: true,
            generatedAt: true,
            label: true,
            questions: true,
            progress: true,
        },
    });

    const progressObj = (sheet?.progress as Record<string, any> | null) || {};
    const completedQuestions = Object.values(progressObj).filter((v: any) => v?.status === "solved").length;
    const totalQuestions = Array.isArray(sheet?.questions) ? (sheet?.questions as any[]).length : 0;

    return sheet
        ? {
              sheet: {
                  sheetId: sheet.id,
                  generatedAt: sheet.generatedAt,
                  label: sheet.label,
                  totalQuestions,
                  completedQuestions,
              },
          }
        : { sheet: null };
}
