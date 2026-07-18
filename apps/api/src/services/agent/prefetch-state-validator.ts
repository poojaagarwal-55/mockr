import type { InterviewType } from "@interviewforge/shared";
import type { PrefetchRequirements } from "./interview-types/base.js";
import { getModuleCompatibilityManifest } from "./interview-types/index.js";

export interface PrefetchValidationState {
    interviewType: InterviewType;
    prefetchedDSAQuestion?: any | null;
    prefetchedCSQuestions?: Map<string, Array<{ questionId: string; questionText: string; referenceAnswer: string }>>;
    prefetchedSQLQuestion?: any | null;
    prefetchedSDQuestion?: any | null;
    prefetchedBehavioralQuestions?: Array<{ questionId: string; questionText: string; referenceAnswer: string; category: string }>;
    prefetchedGenAIConceptQuestions?: Array<{ questionId: string; questionText: string; referenceAnswer: string }>;
    prefetchedGenAICodingQuestion?: any | null;
    prefetchedGenAISystemDesignQuestion?: any | null;
    prefetchedDSConceptQuestions?: any[];
    prefetchedDSSQLQuestion?: any | null;
    prefetchedDSCodingQuestion?: any | null;
    prefetchedPMCaseQuestion?: any | null;
    prefetchedPMConceptQuestions?: any[];
    prefetchedPMStrategyQuestion?: any | null;
    prefetchedProblemSolvingCaseQuestion?: any | null;
    resumeSummary?: any | null;
    cachedQuestionData?: Map<string, any>;
    prefetchRequirements?: PrefetchRequirements;
}

export interface PrefetchValidationResult {
    complete: boolean;
    missing: string[];
    unpopulated: string[];
    warnings: string[];
}

export function validatePrefetchState(state: PrefetchValidationState): PrefetchValidationResult {
    const manifest = getModuleCompatibilityManifest(state.interviewType);
    const requirements = state.prefetchRequirements || manifest.prefetchRequirements;

    const missing: string[] = [];
    const unpopulated: string[] = [];
    const warnings: string[] = [];

    if (requirements.requiresResume && !state.resumeSummary) {
        warnings.push("resumeSummary");
    }

    if (requirements.requiresDSAQuestion && !state.prefetchedDSAQuestion) {
        missing.push("prefetchedDSAQuestion");
    }

    if (requirements.requiresCSQuestions) {
        if (!state.prefetchedCSQuestions) {
            missing.push("prefetchedCSQuestions");
        } else if (state.prefetchedCSQuestions.size === 0) {
            unpopulated.push("prefetchedCSQuestions");
        }
    }

    if (requirements.requiresSQLQuestion) {
        const sqlInCache = !!state.cachedQuestionData && [...state.cachedQuestionData.values()].some((q) => q?.category === "SQL");
        if (!state.prefetchedSQLQuestion && !sqlInCache) {
            missing.push("prefetchedSQLQuestion");
        }
    }

    if (requirements.requiresSDQuestion && !state.prefetchedSDQuestion) {
        missing.push("prefetchedSDQuestion");
    }

    if (requirements.requiresBehavioralQuestions) {
        if (!state.prefetchedBehavioralQuestions) {
            missing.push("prefetchedBehavioralQuestions");
        } else if (state.prefetchedBehavioralQuestions.length === 0) {
            unpopulated.push("prefetchedBehavioralQuestions");
        }
    }

    if (requirements.requiresGenAIConceptQuestions) {
        if (!state.prefetchedGenAIConceptQuestions) {
            missing.push("prefetchedGenAIConceptQuestions");
        } else if (state.prefetchedGenAIConceptQuestions.length === 0) {
            unpopulated.push("prefetchedGenAIConceptQuestions");
        }
    }

    if (requirements.requiresGenAICodingQuestion && !state.prefetchedGenAICodingQuestion) {
        missing.push("prefetchedGenAICodingQuestion");
    }

    if (requirements.requiresGenAISystemDesignQuestion && !state.prefetchedGenAISystemDesignQuestion) {
        missing.push("prefetchedGenAISystemDesignQuestion");
    }

    if (requirements.requiresDSConceptQuestions) {
        if (!state.prefetchedDSConceptQuestions) {
            missing.push("prefetchedDSConceptQuestions");
        } else if (state.prefetchedDSConceptQuestions.length === 0) {
            unpopulated.push("prefetchedDSConceptQuestions");
        }
    }

    if (requirements.requiresDSSQLQuestion && !state.prefetchedDSSQLQuestion) {
        missing.push("prefetchedDSSQLQuestion");
    }

    if (requirements.requiresDSCodingQuestion && !state.prefetchedDSCodingQuestion) {
        missing.push("prefetchedDSCodingQuestion");
    }

    if (requirements.requiresPMCaseQuestion && !state.prefetchedPMCaseQuestion) {
        missing.push("prefetchedPMCaseQuestion");
    }

    if (requirements.requiresPMConceptQuestions) {
        if (!state.prefetchedPMConceptQuestions) {
            missing.push("prefetchedPMConceptQuestions");
        } else if (state.prefetchedPMConceptQuestions.length === 0) {
            unpopulated.push("prefetchedPMConceptQuestions");
        }
    }

    if (requirements.requiresPMStrategyQuestion && !state.prefetchedPMStrategyQuestion) {
        missing.push("prefetchedPMStrategyQuestion");
    }

    if (requirements.requiresProblemSolvingCaseQuestion && !state.prefetchedProblemSolvingCaseQuestion) {
        missing.push("prefetchedProblemSolvingCaseQuestion");
    }

    return {
        complete: missing.length === 0 && unpopulated.length === 0,
        missing,
        unpopulated,
        warnings,
    };
}
