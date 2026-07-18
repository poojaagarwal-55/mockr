#!/usr/bin/env node
/**
 * Test script to verify LaTeX AI doesn't invent metrics
 * 
 * Usage: node apps/api/scripts/test-latex-ai-metrics.cjs
 */

const testCases = [
  {
    name: "Rewrite without metrics",
    input: "\\item Built a web application for user management",
    expectedBehavior: "Should use placeholders like [N users] instead of inventing numbers",
    shouldNotContain: ["50,000", "99.9%", "10,000+", "million"],
    shouldContain: ["[", "]"] // Should contain placeholder brackets
  },
  {
    name: "Suggest improvements",
    input: "\\item Improved system performance",
    expectedBehavior: "Should ask for metrics with placeholders like [X%] improvement",
    shouldNotContain: ["40%", "2x faster", "50% reduction"],
    shouldContain: ["[", "]"]
  },
  {
    name: "Preserve existing metrics",
    input: "\\item Reduced load time by 45% serving 100,000 users",
    expectedBehavior: "Should keep the existing 45% and 100,000 numbers",
    shouldContain: ["45%", "100,000"],
    shouldNotContain: ["[X%]", "[N users]"] // Should not add placeholders when numbers exist
  }
];

console.log("LaTeX AI Metrics Test Cases");
console.log("=" .repeat(60));
console.log("\nThese test cases verify that the LaTeX AI:");
console.log("1. Never invents specific numbers or percentages");
console.log("2. Uses placeholders like [X%], [N users] for missing metrics");
console.log("3. Preserves existing metrics in the original text");
console.log("\n" + "=".repeat(60));

testCases.forEach((testCase, index) => {
  console.log(`\n${index + 1}. ${testCase.name}`);
  console.log(`   Input: ${testCase.input}`);
  console.log(`   Expected: ${testCase.expectedBehavior}`);
  console.log(`   Should NOT contain: ${testCase.shouldNotContain.join(", ")}`);
  console.log(`   Should contain: ${testCase.shouldContain.join(", ")}`);
});

console.log("\n" + "=".repeat(60));
console.log("\nTo test manually:");
console.log("1. Start the API server: npm run dev");
console.log("2. Open the LaTeX resume builder in the web app");
console.log("3. Select text without metrics and click 'Rewrite'");
console.log("4. Verify the AI uses placeholders instead of inventing numbers");
console.log("5. Try the 'Suggest' feature and verify it asks for metrics");
console.log("6. Use the chat feature to ask for optimization");
console.log("\n" + "=".repeat(60));
