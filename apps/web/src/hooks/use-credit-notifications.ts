"use client";

import { useEffect, useRef } from "react";
import { useBilling } from "./use-billing";
import { addNotification } from "@/lib/notifications";
import type { BillingSnapshot } from "./use-billing";
import type { PlanKey } from "@interviewforge/shared";

type CreditNotificationSnapshot = Pick<BillingSnapshot, "plan" | "entitlements" | "wallet">;

type TrackedSnapshot = {
  plan: PlanKey;
  total: number;
  planDisplayName: string;
};

export function formatMinuteCount(minutes: number): string {
  return `${minutes} interview minute${minutes !== 1 ? "s" : ""}`;
}

export function getPlanChangeNotification(snapshot: TrackedSnapshot) {
  const currentTotal = formatMinuteCount(snapshot.total);

  return {
    title: "Plan Updated",
    message: `Your plan is now ${snapshot.planDisplayName}. You now have ${currentTotal} available.`,
  };
}

function toTrackedSnapshot(snapshot: CreditNotificationSnapshot): TrackedSnapshot {
  return {
    plan: snapshot.plan,
    total: snapshot.wallet.total,
    planDisplayName: snapshot.entitlements.displayName || snapshot.plan,
  };
}

export function useCreditNotifications() {
  const { snapshot } = useBilling();
  const previousSnapshotRef = useRef<TrackedSnapshot | null>(null);
  const isInitialLoadRef = useRef(true);
  const pendingReservationDeltaRef = useRef(0);

  useEffect(() => {
    if (snapshot?.wallet?.total !== undefined) {
      const currentSnapshot = toTrackedSnapshot(snapshot);
      const currentTotal = currentSnapshot.total;

      // Skip notification on initial load
      if (isInitialLoadRef.current) {
        previousSnapshotRef.current = currentSnapshot;
        isInitialLoadRef.current = false;
        return;
      }

      const previousSnapshot = previousSnapshotRef.current;

      if (previousSnapshot && previousSnapshot.plan !== currentSnapshot.plan) {
        const notification = getPlanChangeNotification(currentSnapshot);
        addNotification({
          type: "success",
          ...notification,
        });
      } else if (previousSnapshot && previousSnapshot.total !== currentTotal) {
        const delta = currentTotal - previousSnapshot.total;

        if (delta < 0) {
          pendingReservationDeltaRef.current += delta;
        } else if (delta > 0) {
          const pendingReservation = pendingReservationDeltaRef.current;

          if (pendingReservation < 0) {
            const netUsed = Math.abs(Math.min(0, pendingReservation + delta));
            pendingReservationDeltaRef.current = 0;

            if (netUsed > 0) {
              addNotification({
                type: 'info',
                title: 'Minutes Used',
                message: `${formatMinuteCount(netUsed)} used. Remaining: ${currentTotal}`,
              });
            }
          } else {
            addNotification({
              type: 'success',
              title: 'Minutes Added',
              message: `You received ${formatMinuteCount(delta)}. Total: ${currentTotal}`,
            });
          }
        }
      }

      previousSnapshotRef.current = currentSnapshot;
    }
  }, [
    snapshot?.plan,
    snapshot?.wallet?.total,
    snapshot?.entitlements.displayName,
  ]);
}
