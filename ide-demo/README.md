# IDE + Code Execution Integration Demo
This directory contains a complete standalone demonstration of the IDE integration for the AI Interview Platform using React, Monaco Editor, Express, Supabase, and Judge0.
## Overview
- **Backend**: Express + Node.js server that connects to Supabase and Judge0. Provides REST endpoints and SSE (Server-Sent Events) for real-time execution results.
- **Frontend**: React app with `@monaco-editor/react`. Fetches questions, submits code, and receives per-test results via SSE.
## File Structure
```text
ide-demo/
├── README.md                           <-- This file
├── backend/
│   ├── package.json
│   ├── src/
│   │   ├── index.js                    <-- Main Express server, SSE, and Webhook
│   │   ├── judge0.js                   <-- Judge0 API integration and utils
│   │   └── supabase.js                 <-- Supabase client setup
│   └── .env                            <-- Environment variables (create this)
└── frontend/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx                    <-- React entrypoint
        ├── App.jsx                     <-- Main IDE layout and state
        ├── components/
        │   ├── Editor.jsx              <-- Monaco wrapper
        │   └── OutputPanel.jsx         <-- Test execution UI
        └── styles.css                  <-- Basic styling
```
## Getting Started
### 1. Database (Supabase) Setup
Run this example SQL in your Supabase SQL Editor to create the `questions` table and insert a sample question:
```sql
CREATE TABLE questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  statement TEXT NOT NULL,
  category TEXT NOT NULL,
  language TEXT NOT NULL,
  language_id INTEGER,
  starter_code JSONB,
  sample_tests JSONB
);
-- Example row for Two Sum
INSERT INTO questions (title, statement, category, language, language_id, starter_code, sample_tests)
VALUES (
  'Two Sum',
  'Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.',
  'DSA',
  'javascript',
  93, -- Node.js Language ID in Judge0
  '{"javascript": "function twoSum(nums, target) {\n  // your code here\n}"}',
  '[
    {"id": "test1", "stdin": "[2,7,11,15]\n9", "expected_output": "[0,1]"},
    {"id": "test2", "stdin": "[3,2,4]\n6", "expected_output": "[1,2]"}
  ]'
);
```
### 2. Environment Variables
Create `ide-demo/backend/.env`:
```env
PORT=3001
# Replace with your local ngrok/localtunnel URL for webhooks, e.g., https://your-ngrok-url.app/api/ide/judge0-callback
BASE_URL=http://localhost:3001 
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
JUDGE0_URL=https://judge0-ce.p.rapidapi.com
JUDGE0_HOST=judge0-ce.p.rapidapi.com
JUDGE0_KEY=your-rapidapi-key
```
**Webhook Approach (Recommended for Production)**: The backend sets `callback_url` in the submission. Judge0 fires a PUT request to the backend with the final result. The backend streams this to the frontend using Server-Sent Events (SSE). This is robust and scalable because the backend doesn't constantly poll. 
**Polling Approach (Good for simple Local testing)**: Instead of webhooks, you can pass `?wait=true` (or `?wait=false` and periodically `GET /submissions/{token}`) to Judge0. 
- *How it works*: Instead of passing `callback_url`, you hit `POST /submissions/batch?base64_encoded=true&wait=true`. Judge0 will block the HTTP connection until execution finishes and return the results immediately in the response.
- *Why not use it down the line?* `wait=true` holds connections open to your Node server and the Judge0 API. If your code infinite-loops (e.g. 2s), Judge0 blocks for 2s. Multiplied by hundreds of tests, it drains connection pools. Webhooks are strictly better.
### 3. Run Backend
```bash
cd backend
npm install
npm run dev
```
### 4. Run Frontend
```bash
cd frontend
npm install
npm run dev
```
## Multi-Testcase Approach Explanation
There are two main ways to execute multiple test cases on Judge0:
**Approach A (Chosen): One Submission Per Testcase**
- **How it works**: The backend loops over the `sample_tests` array and triggers a separate Judge0 API call (or batch call) for each test. The webhook fires for each testcase individually.
- **Why it was selected**: It securely isolates test cases. If test 1 crashes with a Memory Error or Infinite Loop, tests 2 and 3 can still execute independently. It is also easier to capture exact `stdout`/`stderr` strictly bounded to a single test.
- **How to change it later**: To switch to Approach B, modify `/api/ide/run` to instead wrap the user's code inside a custom "test harness" string (e.g. `try { assert(twoSum(...) == ...) }`) that iterates through all tests *in the code itself* and prints a combined JSON result. You'd parse the combined stdout safely.
**Approach B: Single-Run Harness**
- **How it works**: You generate a wrapper script (like JUnit for Java, or a custom JS runner) that dynamically embeds the user's code and all test scenarios, then run everything in *one* submission.
- **Pros/Cons**: Faster (only 1 Docker container spawned), but if a test infinite-loops, you lose output for subsequent tests. Also requires writing highly language-specific wrapper harnesses for every language supported.
