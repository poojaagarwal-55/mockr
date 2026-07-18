# Mockr

### Practice smarter, interview better.

---

It was my first on-campus placement interview, the very first one of my life. The night before, I could not sleep. It was not the DSA that scared me, I had done the problems. It was the thought of sitting in front of a real person and actually having to speak, explain my thinking out loud, and not freeze. I had never once practised that part.

The next morning I froze. I knew the answer. I just could not say it well. I walked out knowing I had lost the offer, not because I did not know enough, but because I had never practised the one thing that actually happens in an interview: *talking*.

## The real problem

Every student prepares the same way. We grind DSA. We watch system design videos. We read DBMS notes the night before. We collect hundreds of solved problems.

But nobody practises the interview itself.

Nobody practises explaining a solution out loud while someone is watching. Nobody practises what to say when they are stuck. Nobody practises staying calm when the follow-up question comes. So we walk in prepared on paper and unprepared for the room, and the offer slips away over something we could have fixed with practice.

The gap is not knowledge. The gap is **reps** — real interview reps that most students never get until it already counts.

## The solution: Mockr

Mockr gives you those reps before they matter.

It is an AI that sits across from you like a real interviewer. It asks you a question, listens to how you explain it, pushes back with follow-ups, and then tells you exactly where you lost points — your logic, your clarity, the things you did not say. You can do it again tonight, and again tomorrow, until the room stops being scary.

By the time you sit in the real interview, you have already sat through fifty. It feels like something you have done a hundred times, because you have.

## What Mockr gives you

**🎤 AI Mock Interviews**
A real, talking interview. The AI asks, you explain out loud, it follows up like a human would, and you get honest feedback on both your answer *and* how you communicated it. Every session makes the next real one feel ordinary.

**🧑‍🏫 AI Tutor**
Stuck on a concept? The tutor explains it in plain language, at your pace, and walks you through it until it actually clicks — not just memorised, understood.

**📚 Question Bank**
A focused bank of real interview questions across **SQL, System Design, DBMS, and CS Fundamentals** — the topics that actually decide interviews, in one place, ready to practise.

## Why it works

You do not get better at interviews by solving more problems. You get better by *interviewing*. Mockr turns the one thing you could never practise alone into something you can practise every single night — until walking into the real room feels like just one more rep.

---

## For developers

Mockr is a Turborepo monorepo.

| Path | What it is |
|------|-----------|
| `apps/web` | Next.js frontend (the app users see) |
| `apps/api` | Node backend — interviews, tutor, questions, auth |
| `packages/db` | Database schema & client |
| `packages/shared` | Shared types and utilities |

**Powered by:** Supabase (Postgres) · MongoDB (question bank) · Redis · Groq (LLM).

### Run it locally

```bash
# Node >= 20
npm install

# copy the env template and add your own keys
cp .env.example .env

# start the frontend + API
npm run dev:b2c
```

The app runs at `http://localhost:3000`.

> Never commit real secrets. `.env` files are gitignored — copy `.env.example` and fill in your own values. In production, set them in your host's dashboard (Vercel for `web`, Render/Railway for `api`).

Built with AI for the OpenAI × NamasteDev Codex Hackathon.
