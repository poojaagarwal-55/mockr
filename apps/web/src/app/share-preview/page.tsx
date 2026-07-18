"use client";

// TEMPORARY preview route for verifying the achievement share card.
// Delete this file once the card is confirmed.
import { ShareAchievement } from "@/components/contest/achievement-share";

export default function SharePreviewPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-10">
      <ShareAchievement
        name="Piyush Agarwal"
        rank={4}
        score={190}
        possibleScore={250}
        solved={2}
        totalQuestions={4}
        timeLabel="28:55"
        contestTitle="Weekly Contest 142"
        shareUrl="http://localhost:3000/contests/demo"
        mcqScore={90}
        codingScore={100}
        showBreakdown
      />
    </div>
  );
}
