"use client";

import { useState, useCallback } from "react";
import { UpgradeModal, shouldShowUpgradeForError, copyFromUpgradeError, type UpgradeFeature } from "@/components/upgrade-modal";
import { useBilling } from "./use-billing";

type FeatureLimitError = {
    error?: string;
    code?: string;
    message?: string;
    plan?: string;
    detail?: Record<string, unknown>;
};

const ERROR_TO_FEATURE_MAP: Record<string, UpgradeFeature> = {
    "resume_analysis": "resume_improve_ai",
    "resume_improve_ai": "resume_improve_ai",
    "latex_ai_tokens": "latex_ai",
    "tutor_tokens": "ai_tutor",
    "dsa_submit": "dsa_submit",
};

const ERROR_CODE_TO_FEATURE_MAP: Record<string, UpgradeFeature> = {
    "FEATURE_LOCKED": "interview_minutes",
    "FEATURE_LIMIT_REACHED": "interview_minutes",
    "TOKEN_LIMIT_REACHED": "ai_tutor",
    "INSUFFICIENT_CREDITS": "interview_minutes",
    "DSA_SUBMIT_LOCKED": "dsa_submit",
};

export function useFeatureLimit() {
    const [showUpgrade, setShowUpgrade] = useState(false);
    const [upgradeFeature, setUpgradeFeature] = useState<UpgradeFeature>("interview_minutes");
    const [upgradeTitle, setUpgradeTitle] = useState<string | undefined>();
    const [upgradeDescription, setUpgradeDescription] = useState<string | undefined>();
    const [upgradeReason, setUpgradeReason] = useState<"locked" | "minutes" | "tokens" | "limit">("locked");

    const { snapshot } = useBilling();

    const handleFeatureError = useCallback((error: unknown, defaultFeature?: UpgradeFeature) => {
        // Check if this is a feature limit error
        if (!shouldShowUpgradeForError(error)) {
            return false; // Not a feature limit error
        }

        let errorData: FeatureLimitError = {};

        // Parse error data
        if (typeof error === "object" && error !== null) {
            errorData = error as FeatureLimitError;
        } else if (typeof error === "string") {
            try {
                errorData = JSON.parse(error);
            } catch {
                errorData = { message: error };
            }
        }

        // Determine the feature
        let feature: UpgradeFeature = defaultFeature || "interview_minutes";

        // Try to determine feature from error code
        const errorCode = errorData.code || errorData.error;
        if (errorCode && ERROR_CODE_TO_FEATURE_MAP[errorCode]) {
            feature = ERROR_CODE_TO_FEATURE_MAP[errorCode];
        }

        // Try to determine feature from detail.featureKey
        if (errorData.detail?.featureKey && typeof errorData.detail.featureKey === "string") {
            const featureKey = errorData.detail.featureKey;
            if (ERROR_TO_FEATURE_MAP[featureKey]) {
                feature = ERROR_TO_FEATURE_MAP[featureKey];
            }
        }

        // Determine reason
        let reason: "locked" | "minutes" | "tokens" | "limit" = "locked";
        if (errorCode === "FEATURE_LIMIT_REACHED") {
            reason = "limit";
        } else if (errorCode === "TOKEN_LIMIT_REACHED") {
            reason = "tokens";
        } else if (errorCode === "INSUFFICIENT_CREDITS") {
            reason = "minutes";
        }

        // Get custom message
        const customMessage = copyFromUpgradeError(error);

        setUpgradeFeature(feature);
        setUpgradeReason(reason);
        setUpgradeTitle(undefined); // Use default
        setUpgradeDescription(customMessage);
        setShowUpgrade(true);

        return true; // Error was handled
    }, []);

    const closeUpgradeModal = useCallback(() => {
        setShowUpgrade(false);
    }, []);

    const UpgradeModalComponent = useCallback(() => {
        if (!showUpgrade) return null;

        return (
            <UpgradeModal
                open={showUpgrade}
                onClose={closeUpgradeModal}
                feature={upgradeFeature}
                title={upgradeTitle}
                description={upgradeDescription}
                reason={upgradeReason}
                currentPlan={snapshot?.plan || "FREE"}
                showMinutePacks={upgradeReason === "minutes"}
                currentSubscriptionId={snapshot?.subscriptionId ?? undefined}
            />
        );
    }, [showUpgrade, upgradeFeature, upgradeTitle, upgradeDescription, upgradeReason, snapshot, closeUpgradeModal]);

    return {
        handleFeatureError,
        showUpgradeModal: setShowUpgrade,
        UpgradeModal: UpgradeModalComponent,
    };
}
