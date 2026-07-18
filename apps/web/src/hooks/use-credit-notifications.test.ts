import { formatMinuteCount, getPlanChangeNotification } from "./use-credit-notifications";

describe("credit notification copy", () => {
  test("formats paid plan changes with monthly entitlement and current total", () => {
    expect(
      getPlanChangeNotification({
        plan: "PRO",
        total: 300,
        planDisplayName: "Pro",
      })
    ).toEqual({
      title: "Plan Updated",
      message: "Your plan is now Pro. You now have 300 interview minutes available.",
    });
  });

  test("formats plan changes without monthly entitlement using available minutes only", () => {
    expect(
      getPlanChangeNotification({
        plan: "FREE",
        total: 15,
        planDisplayName: "Free",
      })
    ).toEqual({
      title: "Plan Updated",
      message: "Your plan is now Free. You now have 15 interview minutes available.",
    });
  });

  test("formats singular and plural minute counts", () => {
    expect(formatMinuteCount(1)).toBe("1 interview minute");
    expect(formatMinuteCount(2)).toBe("2 interview minutes");
  });
});
