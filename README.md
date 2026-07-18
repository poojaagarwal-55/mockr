<p align="center">
  <img src="apps/web/public/logo_big.png" width="300" alt="Mockr"/>
</p>

<h3 align="center">Practice smarter, interview better.</h3>

<p align="center">
You don't fail interviews because you don't know enough.<br/>
You fail because you never practised the one thing that actually happens in the room — <b>talking</b>.
</p>

---

## 😰 The problem

You prepare for months. Then you sit down, your mind knows the answer… and you freeze, because you've never once said it out loud to another person.

```mermaid
flowchart LR
    A["📚 Grind DSA"] --> X(("Interview<br/>day"))
    B["🖥️ System design"] --> X
    C["📝 DBMS notes"] --> X
    X --> Q{"Explain it<br/>out loud?"}
    Q -->|never practised| F["❄️ Freeze"]
    F --> L["❌ Offer lost"]
    style F fill:#fff3cd,stroke:#f59e0b,color:#000
    style L fill:#fee2e2,stroke:#ef4444,color:#000
```

> The gap isn't knowledge. It's **reps** — real interview reps most students never get until it already counts.

---

## 💡 The solution — Mockr

An AI that sits across from you like a real interviewer, every night, until the room stops being scary.

```mermaid
flowchart LR
    A["🎤 Answer the<br/>AI interviewer"] --> B["📊 Instant feedback<br/>logic + clarity"]
    B --> C["🔁 Do it again<br/>tonight"]
    C --> A
    C -.->|after 50 reps| D["✅ Real interview<br/>feels ordinary"]
    style D fill:#dcfce7,stroke:#22c55e,color:#000
```

---

## 🤔 "Can't I just ask ChatGPT to interview me?"

Sure — and it'll lob you softballs and call every answer "great." That isn't an interview.

A real one has an **editor that runs your code against hidden test cases**, a **live SQL console**, a **whiteboard you actually draw on**, a clock, a camera — and an interviewer who **interrupts, digs, and won't let you hand-wave**. ChatGPT can't watch you code, can't pressure-test your silence, and can't tell you whether you're *actually* getting better week over week.

Mockr can — because it isn't a chat box, it's the whole room. *(Scroll down and see. 👇)*

---

## 🚀 What you get

**🎤 AI Mock Interviews** — a real, talking interview with follow-ups and honest feedback on *what* you said **and** *how* you said it.

**🧑‍🏫 AI Tutor** — stuck on a concept? It explains in plain language until it actually clicks.

**📚 Question Bank** — real questions across **SQL · System Design · DBMS · CS Fundamentals · DSA**.

---

## 🎬 What one session actually feels like

> Not a quiz you click through. A conversation that pushes back.

```mermaid
flowchart LR
    S1["🎧 Join the call<br/>the AI greets you"] --> S2["🗣️ Explain your<br/>approach out loud"] --> S3["💻 Code it live<br/>in the editor"] --> S4["🔍 AI probes your<br/>edge cases"] --> S5["📊 Full report:<br/>exactly what to fix"]
    style S5 fill:#dcfce7,stroke:#22c55e,color:#000
```

It listens to your words, reacts to your code, and digs in exactly where a real interviewer would:

```mermaid
sequenceDiagram
    participant You
    participant AI as 🎤 Mockr
    AI->>You: "Let's start — walk me through your approach."
    You->>AI: you think out loud
    AI->>You: "Why a hashmap here? What's the complexity?"
    Note over You,AI: 💻 you write real code in the live editor
    AI->>You: "Test case 3 fails — which edge case did you miss?"
    You->>AI: you debug and talk it through
    AI-->>You: 📊 instant report — logic, clarity, communication
```

It interrupts. It follows up. It notices when you go quiet — the same pressure as the real room, without the cost of failing. **Ninety seconds in, you forget it's an AI.**

![A live Mockr interview — you on camera, coding against real test cases, the clock running](docs/screenshots/live-interview.jpeg)

<p align="center"><b>👉 Do one interview tonight. That's all it takes to feel the difference.</b></p>

---

## 🖼️ A look inside Mockr

**Pick how you want to practise** — AI interviewer, live peer-to-peer, or an expert.

![Interview options](docs/screenshots/interview-modes.png)

**💻 Code it · 🗄️ query it · 🎨 design it — for real.**

<p align="center">
  <img src="docs/screenshots/dsa-ide.png" width="32%"/>
  <img src="docs/screenshots/sql-editor.png" width="32%"/>
  <img src="docs/screenshots/system-design-canvas.png" width="32%"/>
</p>

**Learn from it, and watch yourself improve.**

<p align="center">
  <img src="docs/screenshots/ai-tutor.png" width="48%"/>
  <img src="docs/screenshots/reports.png" width="48%"/>
</p>

---

<details>
<summary><b>🛠️ How it's built · run it locally</b></summary>

<br/>

A Turborepo monorepo — `apps/web` (Next.js frontend) · `apps/api` (Node backend) · `packages/db`, `packages/shared`. Powered by Supabase (Postgres), MongoDB (question bank), Redis, and Groq (LLM).

```bash
npm install
cp .env.example .env    # add your own keys
npm run dev:b2c         # → http://localhost:3000
```

`.env` files are gitignored — never commit real secrets. Set them in your host's dashboard for production (Vercel for `web`, Render/Railway for `api`).
</details>

---

<p align="center"><i>Built with AI for the OpenAI × NamasteDev Codex Hackathon.</i></p>
