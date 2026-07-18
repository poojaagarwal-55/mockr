// contest-loadtest.js — k6 synchronized-entry load test for contest-service.
//
// Simulates the "thundering herd": every user hits Enter within ~5s, then polls
// my-rank + leaderboard for the contest duration — the exact pattern that walled
// the CPU quota on 2 Jul.
//
// Prereqs:
//   1. Raise the Cloud Run CPU quota FIRST (else you just reproduce the crash).
//   2. node prepare-users.mjs --create   → writes tokens.json (see README).
//   3. Install k6: https://k6.io/docs/get-started/installation/
//
// Target the live ALB host (AWS ECS Fargate). Pre-warm contest-service first
// (infra/aws/scripts/prewarm-contest.sh up N) — Fargate autoscaling is too slow
// to catch a synchronized burst on its own.
//
// Run (ramp the herd size up across separate runs to find the ceiling):
//   k6 run -e CONTEST_API=https://contest.practers.com \
//          -e CONTEST_ID=<real-contest-id> -e USERS=150 contest-loadtest.js
//   ...then USERS=300, USERS=500.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Trend, Rate } from 'k6/metrics';

const CONTEST_API = __ENV.CONTEST_API || 'http://localhost:3002';
const CONTEST_ID = __ENV.CONTEST_ID || 'REPLACE_ME';
const USERS = Number(__ENV.USERS || 150);

// tokens.json is produced by prepare-users.mjs
const tokens = new SharedArray('tokens', () => JSON.parse(open('./tokens.json')));

const entryLatency = new Trend('entry_latency', true);
const pollLatency = new Trend('poll_latency', true);
const errorRate = new Rate('errors');

export const options = {
  scenarios: {
    contest_entry: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5s', target: USERS },   // synchronized entry burst
        { duration: '2m', target: USERS },   // steady polling
        { duration: '10s', target: 0 },      // drain
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    errors: ['rate<0.01'],            // <1% application errors
    entry_latency: ['p(95)<1500'],    // entry p95 < 1.5s
    poll_latency: ['p(95)<800'],      // poll p95 < 0.8s
    http_req_failed: ['rate<0.02'],   // watch for 429/503 (quota / cold-start)
  },
};

function h(token) {
  return { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}

// treat 200 as ok; 404 on leaderboard/my-rank = "not generated yet", not an error
function ok(res) {
  return res.status === 200 || res.status === 404;
}

export default function () {
  if (CONTEST_ID === 'REPLACE_ME') throw new Error('Set -e CONTEST_ID=<real id>');
  const token = tokens[(__VU - 1) % tokens.length];
  const auth = h(token);
  const base = `${CONTEST_API}/contests/${CONTEST_ID}`;

  // 1. Entry burst — load contest details + rounds (what the Enter click fires)
  const entry = http.batch([
    ['GET', `${base}`, null, auth],
    ['GET', `${base}/rounds`, null, auth],
  ]);
  entryLatency.add(entry[0].timings.duration);
  errorRate.add(!check(entry[0], { 'entry ok': ok }));

  // 2. Steady polling — mirror the app's my-rank + leaderboard every ~15s (jittered)
  for (let i = 0; i < 6; i++) {
    const polls = http.batch([
      ['GET', `${base}/my-rank`, null, auth],
      ['GET', `${base}/leaderboard`, null, auth],
    ]);
    pollLatency.add(polls[0].timings.duration);
    errorRate.add(!check(polls[0], { 'poll ok': ok }));
    sleep(15 + Math.random() * 7); // 15–22s, matches the app's jittered poll
  }
}
