"use client";

import ContestSolveContent from "./contest-solve";

/**
 * Contest Solve Page
 * 
 * This is a dedicated solve page for contests with contest-specific features:
 * - No Solution tab
 * - No Topics section  
 * - Copy/paste protection (blocks external paste, allows internal)
 * - Tab switching detection and auto-submit
 * - Back button routes to contest detail page
 * - Submission follows contest-service architecture (queue-based with Judge0)
 * - Real-time submission tracking via WebSocket
 */
export default function ContestSolvePage() {
  return <ContestSolveContent />;
}
