// prepare-users.mjs — create N test users, log them in, (optionally) register
// them for the test contest, and write tokens.json for the k6 load test.
//
// Requires: npm i @supabase/supabase-js   (run inside load-testing/ or the repo)
//
// Create users + get tokens:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
//   COUNT=150 node prepare-users.mjs --create
//
// Refresh tokens only (users already exist):
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... COUNT=150 node prepare-users.mjs
//
// Also register them for a contest (returns 200s on the contest endpoints):
//   ...as above... CONTEST_API=https://contest-service-xxxx.a.run.app \
//   CONTEST_ID=<id> node prepare-users.mjs --create --register
//
// NOTE: point this at a STAGING Supabase if you have one. Against prod it creates
// real auth users — clean them up afterwards (see README).

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COUNT = Number(process.env.COUNT || 100);
const PASSWORD = process.env.TEST_USER_PASSWORD || 'LoadTest_2026!';
const DOMAIN = process.env.TEST_EMAIL_DOMAIN || 'loadtest.practers.dev';
const CONTEST_API = process.env.CONTEST_API;
const CONTEST_ID = process.env.CONTEST_ID;
const doCreate = process.argv.includes('--create');
const doRegister = process.argv.includes('--register');

if (!URL || !ANON) throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY');
const email = (i) => `loadtest+${i}@${DOMAIN}`;

// 1. Create users (needs service-role)
if (doCreate) {
  if (!SERVICE) throw new Error('--create needs SUPABASE_SERVICE_ROLE_KEY');
  const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
  for (let i = 1; i <= COUNT; i++) {
    const { error } = await admin.auth.admin.createUser({
      email: email(i), password: PASSWORD, email_confirm: true,
    });
    if (error && !/already|registered|exists/i.test(error.message)) {
      console.error(`create ${email(i)}: ${error.message}`);
    }
  }
  console.log(`Ensured ${COUNT} test users exist.`);
}

// 2. Log in → collect access tokens
const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const tokens = [];
for (let i = 1; i <= COUNT; i++) {
  const { data, error } = await anon.auth.signInWithPassword({ email: email(i), password: PASSWORD });
  if (error) { console.error(`login ${email(i)}: ${error.message}`); continue; }
  tokens.push(data.session.access_token);
}

// 3. (optional) register each user for the contest so endpoints return 200
if (doRegister) {
  if (!CONTEST_API || !CONTEST_ID) throw new Error('--register needs CONTEST_API and CONTEST_ID');
  let ok = 0;
  for (const token of tokens) {
    try {
      const r = await fetch(`${CONTEST_API}/contests/${CONTEST_ID}/register`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (r.ok || r.status === 409) ok++; // 409 = already registered
    } catch (e) { /* ignore */ }
  }
  console.log(`Registered ${ok}/${tokens.length} for contest ${CONTEST_ID}.`);
}

writeFileSync(new URL('./tokens.json', import.meta.url), JSON.stringify(tokens, null, 2));
console.log(`Wrote ${tokens.length} tokens -> tokens.json`);
