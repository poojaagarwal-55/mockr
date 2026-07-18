import { shouldApplyMonthlyPlanTopUp } from "./entitlements.js";

describe("shouldApplyMonthlyPlanTopUp", () => {
    test("returns false when entitlement does not exceed current wallet balance", () => {
        expect(
            shouldApplyMonthlyPlanTopUp({
                entitledMonthlyInterviewMinutes: 100,
                walletMonthlyBalance: 100,
                hasGrantForCurrentPlanThisPeriod: false,
            })
        ).toBe(false);

        expect(
            shouldApplyMonthlyPlanTopUp({
                entitledMonthlyInterviewMinutes: 80,
                walletMonthlyBalance: 100,
                hasGrantForCurrentPlanThisPeriod: false,
            })
        ).toBe(false);
    });

    test("returns false after normal spend when current plan was already granted", () => {
        expect(
            shouldApplyMonthlyPlanTopUp({
                entitledMonthlyInterviewMinutes: 200,
                walletMonthlyBalance: 150,
                hasGrantForCurrentPlanThisPeriod: true,
            })
        ).toBe(false);
    });

    test("returns true for a real plan-change top-up gap", () => {
        expect(
            shouldApplyMonthlyPlanTopUp({
                entitledMonthlyInterviewMinutes: 200,
                walletMonthlyBalance: 60,
                hasGrantForCurrentPlanThisPeriod: false,
            })
        ).toBe(true);
    });
});
