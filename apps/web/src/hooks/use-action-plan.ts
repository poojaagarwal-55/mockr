/**
 * React hooks for action plan API integration
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/context/auth-context";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

type DayQuestion = {
    id: string;
    slug: string | null;
    title: string;
    difficulty: string;
    topics: string[];
    estimatedMinutes: number;
    why: string;
    solveUrl: string;
};

type DayPlan = {
    dayNumber: number;
    date: string;
    title: string;
    focusAreas: string[];
    estimatedHours: number;
    goals: string[];
    tips: string[];
    milestone: string | null;
    questions: {
        dsa: DayQuestion[];
        csFundamentals: DayQuestion[];
        sql: DayQuestion[];
        systemDesign: DayQuestion[];
    };
    completed: boolean;
    completedQuestions: string[];
};

type ActionPlan = {
    id: string;
    artifactId: string | null;
    reportId: string;
    sessionId: string;
    title: string;
    startDate: string;
    endDate: string;
    totalDays: number | null;
    currentDay: number;
    content: {
        summary: string | null;
        priorityFocus: string | null;
        totalDays: number;
        hoursPerDay: number;
        days: DayPlan[];
        planSummary: {
            totalQuestions: number;
            questionsByDifficulty: { easy: number; medium: number; hard: number };
            topicCoverage: Array<{ topic: string; count: number }>;
        };
    };
};

type ActivePlanResponse = {
    plan: ActionPlan | null;
    progress?: {
        completedDays: number;
        totalDays: number;
        completedQuestions: number;
        totalQuestions: number;
        percentComplete: number;
    };
};

type DayDetailsResponse = {
    day: DayPlan;
    progress: {
        completedQuestions: string[];
        totalQuestions: number;
        isCompleted: boolean;
    };
};

// ─────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────

/**
 * Fetch the user's active action plan
 */
export function useActiveActionPlan() {
    const { session } = useAuth();
    
    return useQuery<ActivePlanResponse>({
        queryKey: ["action-plan", "active"],
        queryFn: async () => {
            if (!session?.access_token) {
                throw new Error("No authentication token available");
            }
            return api.get<ActivePlanResponse>("/users/me/action-plan/active", session.access_token);
        },
        enabled: !!session?.access_token,
        staleTime: 30 * 1000,
        gcTime: 5 * 60 * 1000,
        refetchOnMount: true,
        // Was `true` + staleTime:0 — during a contest, users alt-tab constantly and
        // this fired /users/me/action-plan/active on the shared API in lockstep on
        // every refocus. The dashboard doesn't need second-fresh plan data.
        refetchOnWindowFocus: false,
    });
}

/**
 * Fetch details for a specific day
 */
export function useDayDetails(dayNumber: number | null) {
    const { session } = useAuth();
    
    return useQuery<DayDetailsResponse>({
        queryKey: ["action-plan", "day", dayNumber],
        queryFn: async () => {
            if (!dayNumber) throw new Error("Day number required");
            if (!session?.access_token) {
                throw new Error("No authentication token available");
            }
            return api.get<DayDetailsResponse>(`/users/me/action-plan/active/day/${dayNumber}`, session.access_token);
        },
        enabled: !!dayNumber && !!session?.access_token,
        staleTime: 1000 * 60 * 2, // 2 minutes
    });
}

/**
 * Mark a question as complete/incomplete
 */
export function useMarkQuestionComplete() {
    const queryClient = useQueryClient();
    const { session } = useAuth();

    return useMutation({
        mutationFn: async ({
            dayNumber,
            questionId,
            completed,
        }: {
            dayNumber: number;
            questionId: string;
            completed: boolean;
        }) => {
            if (!session?.access_token) {
                throw new Error("No authentication token available");
            }
            return api.post(
                `/users/me/action-plan/active/day/${dayNumber}/question/${questionId}/complete`,
                { completed },
                session.access_token
            );
        },
        onSuccess: (_, variables) => {
            // Invalidate both the active plan and the specific day
            queryClient.invalidateQueries({ queryKey: ["action-plan", "active"] });
            queryClient.invalidateQueries({ queryKey: ["action-plan", "day", variables.dayNumber] });
        },
    });
}

/**
 * Mark an entire day as complete
 */
export function useMarkDayComplete() {
    const queryClient = useQueryClient();
    const { session } = useAuth();

    return useMutation({
        mutationFn: async (dayNumber: number) => {
            if (!session?.access_token) {
                throw new Error("No authentication token available");
            }
            return api.post(
                `/users/me/action-plan/active/day/${dayNumber}/complete`,
                {},
                session.access_token
            );
        },
        onSuccess: () => {
            // Invalidate the active plan to refresh progress
            queryClient.invalidateQueries({ queryKey: ["action-plan", "active"] });
            queryClient.invalidateQueries({ queryKey: ["action-plan", "day"] });
        },
    });
}

/**
 * Get all questions for a day across all categories
 */
export function getAllDayQuestions(day: DayPlan | undefined): DayQuestion[] {
    if (!day) return [];
    return [
        ...(day.questions.dsa || []),
        ...(day.questions.csFundamentals || []),
        ...(day.questions.sql || []),
        ...(day.questions.systemDesign || []),
    ];
}

/**
 * Calculate progress for a specific day
 */
export function calculateDayProgress(
    day: DayPlan | undefined,
    completedQuestions: string[]
): { completed: number; total: number; percentage: number } {
    if (!day) return { completed: 0, total: 0, percentage: 0 };

    const allQuestions = getAllDayQuestions(day);
    const completed = allQuestions.filter((q) => completedQuestions.includes(q.id)).length;
    const total = allQuestions.length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { completed, total, percentage };
}
