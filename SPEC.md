# Life OS — Build Spec v2.0

## Overview

A personal AI assistant running as a Telegram bot, built on an agent loop architecture. The assistant eliminates morning decision fatigue, manages task and project context, automatically builds your Obsidian second brain from raw captures, and runs your day without you having to think about it. You talk to it like a person. It handles the rest.

---

## Core Philosophy

**Capture raw, file clean.** You never organise anything manually. You dump thoughts, links, voice memos, and ideas into the bot. The agent processes, structures, and routes everything to the right place automatically.

**Execution over planning.** The assistant exists to reduce the gap between intention and action. Every morning you wake up knowing exactly what to do. Every capture gets processed. Every project stays current. You look up in six months and see compounding progress.

**Two systems, one intake.** Notion is for structured, actionable, managed work. Obsidian is for thinking, connecting, and building a second brain. The bot is the single intake point for both. You never have to decide where something goes — the agent decides.

---

## Architecture

```
You (Telegram)
      ↕
Railway server (Node.js · webhook · cron)
      ↕
Agent loop (Claude Sonnet · tools · multi-step reasoning)
      ↕              ↕              ↕              ↕
Notion MCP      Supabase       GitHub API      External
Tasks/projects  Memory/logs    Obsidian vault  URLs/Whisper
      ↕                             ↕
Apple Reminders              Obsidian (local Mac)
(CalDAV)                     ← auto-pulled via Git
```

---

## Agent Loop

Every message triggers an agent run. Claude receives your message plus the system prompt, then reasons about what tools to call before responding. It decides the execution path — you give it a goal, it figures out how to achieve it.

**Tool call sequence example — morning check-in:**
1. Calls `read_notion_tasks` for today
2. Calls `read_notion_programs` for training and sketching schedule
3. Calls `read_supabase_history` for last 3 days
4. Reasons over all results
5. Produces morning brief and sends to Telegram

No pre-defined prompt templates per flow. One agent loop handles everything based on what you ask.

---

## Tools

Every tool has a precise description — this is where most of the agent's intelligence lives. Vague descriptions produce wrong tool calls.

| Tool | Description | Destination |
|---|---|---|
| `read_notion_tasks` | Read tasks for a date + optional project filter | Notion MCP |
| `write_notion_task` | Create a task with effort, time, priority, why | Notion MCP |
| `read_notion_project` | Read a project page including phase and status | Notion MCP |
| `read_notion_programs` | Read training and sketching schedule for a date | Notion MCP |
| `write_notion_inspiration` | Add a link or reel to inspiration archive | Notion MCP |
| `read_supabase_history` | Read recent conversation and energy logs | Supabase |
| `write_supabase_capture` | Log a raw capture with metadata | Supabase |
| `write_supabase_life_task` | Create a life task (non-project) | Supabase |
| `read_obsidian_index` | Query the note index for related existing notes | Supabase |
| `write_obsidian_note` | Write a structured atomic note to vault via GitHub | GitHub API |
| `read_obsidian_note` | Read a specific note by path | GitHub API |
| `create_reminder` | Create a life task in Apple Reminders via CalDAV | iCloud CalDAV |
| `fetch_url` | Fetch and summarise a URL — YouTube, article, reel | Web |
| `transcribe_audio` | Transcribe a Telegram voice message via Whisper | OpenAI |

**Tool routing rules baked into descriptions:**
- `write_obsidian_note` — for reflections, insights, ideas, reference notes. Not for actionable tasks with deadlines.
- `write_notion_task` — for anything actionable belonging to an active project. Not for personal errands.
- `write_supabase_life_task` + `create_reminder` — always called together for life tasks. Groceries, errands, admin.
- `write_notion_inspiration` — for links and reels only. Thoughts *about* them go to `write_obsidian_note`.

---

## Task Architecture

### Project tasks — Notion

Anything connected to an active project. Full schema with weights and priorities.

| Field | Type | Description |
|---|---|---|
| Title | Text | Task name |
| Project | Relation | Which project |
| Effort | Select | Low / Medium / High |
| Time estimate | Number | Hours (0.5, 1, 2 etc.) |
| Priority | Select | Critical / High / Normal / Low |
| Status | Select | Not started / In progress / Done / Deferred |
| Why | Text | One sentence — why this matters |
| Due | Date | Optional hard deadline |

### Life tasks — Supabase + Apple Reminders

Personal, logistical, non-project. Written to both simultaneously.

```
life_tasks
├── id              uuid
├── created_at      timestamp
├── title           text
├── category        text      -- errands / admin / health / personal
├── time_estimate   float     -- optional
├── priority        text      -- high / normal / low
├── status          text      -- pending / done / deferred
└── due_date        date      -- optional
```

### Routing logic

Agent classifies on capture:
- Contains project keyword → `write_notion_task`
- Logistical or personal → `write_supabase_life_task` + `create_reminder`
- Ambiguous → bot asks in one line before acting

---

## Notion Structure

**Databases the agent reads and writes:**
- Tasks — project task database with full schema
- Projects — active project hubs with phase tracking
- Inspiration — reels and links archive, auto-populated
- Training — scheduled sessions and progression
- Sketching — exercises and schedule

**Inspiration archive schema:**

| Field | Type |
|---|---|
| Title | Text (auto-pulled from URL) |
| URL | URL |
| Summary | Text (Claude one-liner) |
| Category | Select — Visual ref / Concept / Brand / Motion / Other |
| Project | Relation (optional) |
| Date captured | Date |
| Reviewed | Checkbox |

---

## Obsidian — Second Brain Layer

The bot is the primary intake point for Obsidian. You never organise the vault manually. The agent processes raw captures and writes clean, structured, linked atomic notes automatically.

### What the bot writes

**Every processed capture that isn't a task or link** → atomic note in `/captures`

**Project insights and reflections** → appended to `/projects/[project-name].md`

**YouTube and article summaries with your thoughts** → `/references`

**Daily reflections from evening log** → `/daily/YYYY-MM-DD.md`

**Weekly synthesis** → `/synthesis/YYYY-MM-DD-[theme].md`

### Atomic note format

Every note the bot writes follows this structure:

```markdown
---
date: 2026-05-10
type: insight
project: abstracted-objects
source: telegram-capture
related: [[abstracted-objects]], [[brand-world-building]]
---

# [Descriptive title — not a dump of the raw capture]

[Structured, cleaned version of the raw thought — one idea,
written clearly, in your voice]

**Raw capture:** [original words if useful for context]
**Source:** Telegram, 10 May 2026
```

### Linking — the critical piece

Before writing any note, the agent queries `read_obsidian_index` to find existing related notes. It includes `[[wikilinks]]` to any relevant existing notes automatically. This is what makes it a second brain rather than a folder of files — the connections build themselves over time.

### Vault folder structure

```
/daily          — daily reflections from evening log
/captures       — processed fleeting captures
/ideas          — half-formed concepts not ready for projects
/projects       — one note per project, reflections only
/references     — YouTube, articles, links with your thoughts
/synthesis      — weekly theme synthesis notes
/goals          — long-term vision, written by you, read by agent
```

### Sync method

Obsidian Git plugin on Mac → auto-commit every 30 minutes → private GitHub repo → Railway server reads and writes via GitHub API.

Write lag: ~30 minutes from bot write to appearing in Obsidian on Mac. Acceptable — the bot builds the vault, you read it. Reads by the bot are retrospective and never time-critical.

### Obsidian note index

Maintained in Supabase. Updated every time the bot writes a new note. Enables fast linking without reading the entire vault on every call.

```
obsidian_index
├── id            uuid
├── title         text
├── path          text
├── tags          text[]
├── project       text
└── created_at    timestamp
```

---

## Supabase Schema

```
messages
├── id              uuid
├── created_at      timestamp
├── role            text      -- 'user' / 'assistant'
├── content         text
└── session_date    date

daily_logs
├── id              uuid
├── date            date
├── energy          integer   -- 1–10
├── available_hours float
├── tasks_planned   jsonb
├── tasks_completed jsonb
└── reflection      text

captures
├── id              uuid
├── created_at      timestamp
├── raw_content     text
├── content_type    text      -- link / text / voice / image
├── summary         text
├── classification  text      -- idea / task / reference / inspiration / noise
├── project         text
├── routed_to       text      -- notion / obsidian / life_tasks / discarded
└── reviewed        boolean

life_tasks
├── id              uuid
├── created_at      timestamp
├── title           text
├── category        text
├── time_estimate   float
├── priority        text
├── status          text
└── due_date        date

obsidian_index
├── id              uuid
├── title           text
├── path            text
├── tags            text[]
├── project         text
└── created_at      timestamp
```

---

## Scheduled Flows

### Morning brief — 7am daily

Agent run triggered by cron. Claude calls:
1. `read_notion_tasks` for today
2. `read_notion_programs` for training and sketching
3. `read_supabase_history` for last 3 days

Produces a formatted brief sent to your Telegram:

```
good morning andrew.

— projects —
1. abstracted objects — finalise logo directions [2hr, high]
   why: gates the rest of the visual identity work
2. blender — complete cloth shader study [1hr, normal]
   why: building toward procedural material fluency

— training —
upper body push + 20 min zone 2

— sketching —
timed figure sketch, 10 × 2min gestures

— life —
groceries, reply to landlord

reply with your energy (1–10) and hours available.
```

You reply → agent reshuffles based on energy and time → sends revised plan.

### Evening log — 9pm daily

Bot sends a short check-in. You reply with what you completed, anything to carry forward, one reflection. Agent writes reflection to `/daily/YYYY-MM-DD.md` in Obsidian and logs completion data to `daily_logs`.

### Weekly digest — Sunday 6pm

Agent queries `captures` table for past 7 days where `reviewed = false`. Produces a digest in sections:

**Reels + links** — every link from the week with one-line summaries. You reply with what to keep, bot writes keepers to Notion inspiration archive and marks reviewed.

**Fleeting thoughts** — 5–10 most interesting text captures. You reply to anything worth developing, bot creates a proper Obsidian note or Notion task.

**Buried action items** — tasks extracted from captures not yet added to a project. You confirm or discard.

**Obsidian synthesis** — agent reads everything filed to Obsidian that week, identifies emerging themes, offers to write a synthesis note connecting related captures. This is the second brain compounding.

---

## Capture Pipeline

Every incoming message that isn't a command runs through the capture pipeline.

**Step 1 — Content type detection**
- Link → `fetch_url` to pull title and summary
- Voice message → `transcribe_audio` via Whisper, then treat as text
- Text with project keywords → likely project-relevant
- Plain text → idea or reflection

**Step 2 — Classification**
Agent classifies into: project insight / standalone idea / action item / reference / inspiration / noise

**Step 3 — Separation**
If message contains both a link and a thought about it — split them. Link → Notion inspiration archive. Thought → Obsidian reference note with `[[wikilink]]` to the inspiration entry.

**Step 4 — Routing**

| Classification | Destination |
|---|---|
| Project insight | Obsidian `/projects/[name].md` + Notion if actionable |
| Standalone idea | Obsidian `/ideas/` — atomic note |
| Action item | Notion task or Supabase life task |
| Reference / link | Notion inspiration archive |
| Thought about reference | Obsidian `/references/` — atomic note with wikilink |
| Noise | Supabase captures table only, not surfaced |

**Step 5 — Confirmation**
Bot replies in one line: *"filed to abstracted objects in obsidian + added to notion inspiration archive"*

Ambiguous routing → bot asks before acting: *"project task or life task?"*

---

## Prompt Architecture

Every agent run is constructed from four layers:

**Layer 1 — System prompt (static, written by you)**
Loaded from `system-prompt.md`. Your permanent life context — projects, values, working style, tone rules, priority logic. The agent's character and judgment live here entirely.

**Layer 2 — Tool results (dynamic)**
Whatever the agent fetches during its tool-calling loop. Fresh on every run. This replaces the old approach of manually injecting context.

**Layer 3 — Recent memory (dynamic)**
Last 14 days from Supabase `messages` table. Gives continuity — the agent knows what you said your energy was, what got deferred, what you're in the middle of.

**Layer 4 — Your message (dynamic)**
Appended last.

### Model routing

Not every call uses Sonnet. Route by complexity:

- Morning brief, planning, synthesis → Claude Sonnet (reasoning quality matters)
- Capture classification, quick routing decisions → Claude Haiku (15× cheaper, fast enough)
- Prompt caching on system prompt → 90% reduction on input token cost across all calls

---

## System Prompt — What You Write Yourself

This is the most important part of the build. Cannot be generated. Cover:

**Identity** — who you are, what stage you're in, what you're building toward. Mechatronics grad, full-stack background, working at Premier Business Forms while building toward a creative studio focused on physical objects and brand worlds.

**Active projects** — one paragraph each on current status and goal:
- Abstracted Objects rebrand
- Content work and creative output
- Blender and procedural material development
- Sketching practice
- Training program

**Working style** — when you're sharp, what derails you, how you think, what context switching costs you.

**Values** — what you're optimising for, what you won't compromise, the long-term vision.

**Tone rules** — direct, no filler, all lowercase, under ten words where possible, assumes high agency, never over-explains, never motivational, treats you like an adult.

**Priority logic** — how to handle conflicts, what to defer on low energy days, how to weigh training and sketching against project work, what critical means vs high.

**Obsidian rules** — what belongs in Obsidian vs Notion, how to write atomic notes, when to link vs create new.

---

## Tech Stack

| Layer | Tool | Notes |
|---|---|---|
| Interface | Telegram + Telegraf.js | Webhook-based, mobile-native |
| Server | Node.js + TypeScript on Railway | Cron support, auto-deploy from GitHub |
| Agent | Claude Sonnet via Anthropic SDK | Tool use, multi-step reasoning |
| Classification | Claude Haiku | Cheaper for simple routing calls |
| Project data | Notion MCP | Official MCP server, no raw API needed |
| Memory | Supabase | Postgres, free tier sufficient |
| Second brain | Obsidian via GitHub API | Write-heavy, 30min sync lag acceptable |
| Voice | OpenAI Whisper | Per-use pricing, cheap at personal scale |
| Life tasks | Apple Reminders via CalDAV (tsdav) | One-way write from bot |
| Hosting | Railway | Free tier to start, ~$5/mo when scaling |

---

## Project Structure

```
life-os/
├── src/
│   ├── bot/
│   │   ├── index.ts          # Telegraf setup + webhook
│   │   ├── handlers.ts       # Message routing
│   │   └── cron.ts           # Morning brief, evening log, weekly digest
│   ├── agent/
│   │   ├── loop.ts           # Core agent loop — tool call iteration
│   │   ├── tools.ts          # Tool definitions + descriptions
│   │   └── execute.ts        # Tool execution functions
│   ├── integrations/
│   │   ├── notion.ts         # Notion MCP calls
│   │   ├── obsidian.ts       # GitHub API reads + writes
│   │   ├── reminders.ts      # CalDAV via tsdav
│   │   └── whisper.ts        # OpenAI audio transcription
│   ├── memory/
│   │   ├── supabase.ts       # DB client
│   │   ├── messages.ts       # Conversation history
│   │   ├── captures.ts       # Capture log
│   │   ├── life-tasks.ts     # Life task management
│   │   └── obsidian-index.ts # Note index for linking
│   ├── capture/
│   │   ├── pipeline.ts       # Main capture flow
│   │   ├── classify.ts       # Haiku classification call
│   │   └── router.ts         # Route to correct destination
│   └── utils/
│       ├── formatter.ts      # Format data for prompts
│       └── note-writer.ts    # Atomic note construction
├── system-prompt.md          # Written by you — the agent's brain
├── railway.toml              # Cron schedule + deploy config
├── .env.example
└── package.json
```

---

## Environment Variables

```
# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Anthropic
ANTHROPIC_API_KEY=

# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=

# GitHub (Obsidian vault)
GITHUB_TOKEN=
GITHUB_OBSIDIAN_REPO=         # e.g. andrew/obsidian-vault
GITHUB_OBSIDIAN_BRANCH=main

# Apple Reminders
ICLOUD_USERNAME=
ICLOUD_APP_PASSWORD=

# OpenAI (Whisper)
OPENAI_API_KEY=

# Schedule (cron expressions, Auckland time)
MORNING_BRIEF_CRON=0 7 * * *
EVENING_LOG_CRON=0 21 * * *
WEEKLY_DIGEST_CRON=0 18 * * 0
TIMEZONE=Pacific/Auckland

# App
NODE_ENV=development
CAPTURE_WEBHOOK_SECRET=
```

---

## Build Phases

### Phase 1 — Core loop (Days 1–2)
Telegram → Claude Sonnet → response. System prompt hardcoded as a string. No tools, no memory. Goal: have a conversation with your assistant.

### Phase 2 — Memory (Days 3–4)
Supabase connected. Messages logged. Recent history injected into every agent run. Bot remembers across sessions.

### Phase 3 — Agent loop + tools (Days 5–8)
Refactor single Claude call into proper agent loop. Define all tools. Implement tool execution functions. Connect Notion MCP. Bot can now read live project data and reason over it.

### Phase 4 — Capture pipeline (Days 9–11)
Every non-command message runs through classify → route → confirm. Whisper transcription for voice messages. URL fetching and summarisation. Life task routing to Supabase + Apple Reminders simultaneously.

### Phase 5 — Obsidian second brain (Days 12–14)
GitHub API integration. Obsidian note index in Supabase. Atomic note writer with frontmatter and wikilinks. Bot starts building the vault from captures automatically.

### Phase 6 — Scheduled flows (Days 15–16)
Morning brief cron. Evening log cron. Weekly digest with Obsidian synthesis pass. Deploy to Railway and run live.

### Phase 7 — System prompt (Ongoing)
Write `system-prompt.md` properly. This is the work that makes the assistant feel like it knows you. Iterate weekly based on where it's getting things wrong.

---

## Success Criteria

The system is working when:
- You wake up and the brief is already there
- Every YouTube link you forward gets filed without you doing anything
- Your Obsidian vault is getting richer every week without you ever opening the organise panel
- You can ask about any project and get a real update in seconds
- After four weeks you've spent zero morning energy on planning
- After three months the vault has a graph of connected ideas you didn't consciously build