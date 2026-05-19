import type Anthropic from '@anthropic-ai/sdk';

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_notion_tasks',
    description:
      'Read all open tasks from the Andrew Task Board in Notion. Filters out Done tasks. Returns task name, status, priority, energy, project, time estimate, why, and date. Use during morning briefs and whenever Andrew asks about his task list.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'write_notion_task',
    description:
      'Create a new task in the Andrew Task Board in Notion and returns its page_id for immediate use in follow-up updates. Use for ALL project tasks — Lost Marbles, Abstracted Objects, Blender, Sketching, and any other project work. Do NOT use write_supabase_life_task for project tasks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Task title.' },
        project: {
          type: 'string',
          enum: ['Lost Marbles', 'Abstracted Objects', 'Blender', 'Sketching', 'Personal', 'Other'],
          description: 'Project this task belongs to.',
        },
        priority: {
          type: 'string',
          enum: ['Critical', 'High', 'Normal', 'Low'],
          description: 'Task priority.',
        },
        time_estimate: { type: 'number', description: 'Estimated hours (optional).' },
        energy: {
          type: 'string',
          enum: ['Low', 'Medium', 'High'],
          description: 'Energy level required (optional).',
        },
        why: { type: 'string', description: 'Why this task matters (optional).' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_notion_task_status',
    description:
      'Update one or more fields on a task in the Andrew Task Board. Use when Andrew changes status, priority, energy, time estimate, or project. Get page_id from read_notion_tasks. All fields except page_id are optional — only pass what needs changing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        page_id: { type: 'string', description: 'Notion page ID of the task.' },
        status: {
          type: 'string',
          enum: ['Not started', 'In progress', 'Paused', 'Done'],
          description: 'New status.',
        },
        priority: {
          type: 'string',
          enum: ['Critical', 'High', 'Normal', 'Low'],
          description: 'New priority.',
        },
        energy: {
          type: 'string',
          enum: ['Low', 'Medium', 'High'],
          description: 'New energy level.',
        },
        time_estimate: {
          type: 'number',
          description: 'New time estimate in hours.',
        },
        project: {
          type: 'string',
          enum: ['Lost Marbles', 'Abstracted Objects', 'Blender', 'Sketching', 'Personal', 'Other'],
          description: 'New project assignment.',
        },
        why: {
          type: 'string',
          description: 'Updated why/rationale for the task.',
        },
        name: {
          type: 'string',
          description: 'New task name — use to fix casing or rename the task.',
        },
      },
      required: ['page_id'],
    },
  },
  {
    name: 'read_training_today',
    description:
      'Read the next incomplete training session from the 16-week plan database. Returns session text, session name (e.g. "Week 1 — Day 2"), and page_id. When Andrew says he completed training, call mark_training_done with that page_id. Include in morning brief under — training —.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'mark_training_done',
    description:
      'Mark a training session as completed. Call this when Andrew says he finished his training. Pass the page_id returned by read_training_today.',
    input_schema: {
      type: 'object' as const,
      properties: {
        page_id: { type: 'string', description: 'The page ID from read_training_today.' },
      },
      required: ['page_id'],
    },
  },
  {
    name: 'read_sketching_today',
    description:
      'Read the next incomplete sketching session from the Sketching Programme database (ordered by Day Number). Returns the session title, which week it belongs to, and the page_id. Always prepends the 5-min warm-up note. Include in morning brief under — sketching —. When Andrew says he completed his sketching session, call mark_sketching_done with the returned page_id.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'mark_sketching_done',
    description:
      'Mark a sketching session as completed. Call this when Andrew says he finished his sketching. Pass the page_id returned by read_sketching_today.',
    input_schema: {
      type: 'object' as const,
      properties: {
        page_id: { type: 'string', description: 'The page ID from read_sketching_today.' },
      },
      required: ['page_id'],
    },
  },
  {
    name: 'read_supabase_history',
    description:
      'Read recent conversation and energy logs from Supabase. Returns messages from the last N days. Use this during morning briefs to understand recent context — what was deferred, what energy levels have been, what is in progress.',
    input_schema: {
      type: 'object' as const,
      properties: {
        days: {
          type: 'number',
          description: 'Number of days to look back. Default 3 for morning brief, 14 for general context.',
        },
      },
      required: [],
    },
  },
  {
    name: 'write_supabase_capture',
    description:
      'Log a raw capture to Supabase with metadata. Call this for every incoming message that goes through the capture pipeline — before routing. Stores the original content, type, classification, and where it was routed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        raw_content: { type: 'string', description: 'Original message content.' },
        content_type: {
          type: 'string',
          enum: ['link', 'text', 'voice', 'image'],
          description: 'Type of capture.',
        },
        summary: { type: 'string', description: 'One-line summary.' },
        classification: {
          type: 'string',
          enum: ['idea', 'task', 'reference', 'inspiration', 'noise'],
          description: 'How the capture was classified.',
        },
        project: {
          type: 'string',
          description: 'Related project if applicable.',
        },
        routed_to: {
          type: 'string',
          enum: ['notion', 'obsidian', 'life_tasks', 'discarded'],
          description: 'Where the capture was routed.',
        },
      },
      required: ['raw_content', 'content_type', 'classification', 'routed_to'],
    },
  },
  {
    name: 'read_life_tasks',
    description: "Read Andrew's personal life tasks (groceries, errands, personal todos) from Google Tasks. Use during morning briefs and when Andrew asks about his personal todo list.",
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'write_life_task',
    description: "Add a personal task or reminder to Google Tasks. Use for todos, action items, AND time-based reminders (\"remind me to X at Y time\", \"follow up on X tomorrow\"). For time-based items, pass the due datetime. Shows natively on Andrew's phone. Persists across server restarts.",
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Task title.' },
        notes: { type: 'string', description: 'Optional notes.' },
        due: { type: 'string', description: 'Optional due date as RFC 3339 timestamp (e.g. 2026-05-20T09:00:00+12:00).' },
      },
      required: ['title'],
    },
  },
  {
    name: 'complete_life_task',
    description: 'Mark a personal life task as completed in Google Tasks. Get the task_id from read_life_tasks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'Google Tasks task ID from read_life_tasks.' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'update_life_task',
    description: 'Update a life task title, notes, or due date in Google Tasks. Get task_id from read_life_tasks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'Google Tasks task ID.' },
        title: { type: 'string', description: 'New task title.' },
        notes: { type: 'string', description: 'New notes.' },
        due: { type: 'string', description: 'New due date as RFC 3339 timestamp.' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'delete_life_task',
    description: 'Permanently delete a life task from Google Tasks. Requires explicit confirmation from Andrew before calling.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'Google Tasks task ID from read_life_tasks.' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'write_supabase_life_task',
    description:
      'Create a life task in Supabase. Use for personal, logistical, non-project tasks — errands, admin, health, groceries, personal appointments. Always call create_reminder immediately after this tool — these two are always called together. Do NOT use for project tasks; those go to write_notion_task.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Task title.' },
        category: {
          type: 'string',
          enum: ['errands', 'admin', 'health', 'personal'],
          description: 'Life task category.',
        },
        time_estimate: {
          type: 'number',
          description: 'Optional estimated hours.',
        },
        priority: {
          type: 'string',
          enum: ['high', 'normal', 'low'],
          description: 'Priority level.',
        },
        due_date: {
          type: 'string',
          description: 'Optional due date (YYYY-MM-DD).',
        },
      },
      required: ['title', 'category', 'priority'],
    },
  },
  {
    name: 'read_obsidian_index',
    description:
      'Query the Obsidian note index in Supabase to find existing notes by title keyword or project. Always call this before write_obsidian_note — use the returned titles as [[wikilinks]] in the related field. This is what builds connections across the vault automatically.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Title keyword or topic to search for.',
        },
        project: {
          type: 'string',
          description: 'Filter by project name (e.g. "Lost Marbles Studio", "Abstracted Objects").',
        },
        limit: {
          type: 'number',
          description: 'Max results. Default 10.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'write_obsidian_note',
    description:
      'Create a new note in the Obsidian vault. Folder routing is enforced server-side based on type and content — pass type "learning" for learnings, "daily" for daily logs, anything else goes to Inbox. ' +
      'Use filename YYYY-MM-DD for daily notes, kebab-case for everything else. Never pass project, source, or related — those fields are ignored.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Descriptive title in the user\'s voice.',
        },
        content: {
          type: 'string',
          description: 'Note body — no frontmatter.',
        },
        filename: {
          type: 'string',
          description: 'Filename without extension. YYYY-MM-DD for daily, kebab-case otherwise.',
        },
        type: {
          type: 'string',
          enum: ['learning', 'idea', 'reference', 'daily'],
          description: 'Note type. Determines folder: learning → 2.Notes/Learnings, daily → 2.Notes/Daily, everything else → 1.Inbox.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags.',
        },
      },
      required: ['title', 'content', 'filename', 'type'],
    },
  },
  {
    name: 'update_obsidian_note',
    description:
      'Append new content to an existing note in the Obsidian vault. Use this for project reflection notes at 2.Notes/Projects/[project-name].md. Appends a date-stamped section — does not overwrite existing content. Creates the file if it does not exist yet.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Full vault path to the note (e.g. 2.Notes/Projects/lost-marbles-studio.md).',
        },
        content: {
          type: 'string',
          description: 'New content to append. Will be prefixed with a date-stamped section header.',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_obsidian_note',
    description:
      'Read an existing note from the Obsidian vault by full path. Use when the user asks about a specific note, or before update_obsidian_note when you need to see the current state first.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Full vault path (e.g. 2.Notes/Projects/lost-marbles-studio.md).',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'create_reminder',
    description:
      'Create a reminder in Apple Reminders via CalDAV. Always call this immediately after write_supabase_life_task — these two tools are always called as a pair for life tasks. Do not call this for project tasks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Reminder title.' },
        due_date: {
          type: 'string',
          description: 'Optional due date-time (ISO 8601).',
        },
        notes: {
          type: 'string',
          description: 'Optional notes to attach.',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'read_google_calendar',
    description:
      'Read events from Google Calendar for today and the next N days. Use this when the user asks about their schedule, what is on their calendar, or during morning briefs. Returns event title, start/end times in Auckland timezone (Pacific/Auckland), attendees, location, and event ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        days: {
          type: 'number',
          description: 'Number of days ahead to fetch, including today. Default 7.',
        },
      },
      required: [],
    },
  },
  {
    name: 'create_calendar_event',
    description:
      'Create a new event in Google Calendar. All times default to Pacific/Auckland timezone. Resolve natural language times (e.g. "9pm Friday") into ISO 8601 datetimes before calling. If no end time is given, default to 1 hour after start. Always echo back the resolved time to the user before creating. Returns the created event link.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Event title.' },
        start: {
          type: 'string',
          description: 'Start datetime ISO 8601 with Auckland offset, e.g. 2026-05-16T21:00:00+12:00.',
        },
        end: {
          type: 'string',
          description: 'End datetime ISO 8601 with Auckland offset. Defaults to 1 hour after start.',
        },
        description: { type: 'string', description: 'Optional notes or agenda.' },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional attendee email addresses.',
        },
      },
      required: ['title', 'start', 'end'],
    },
  },
  {
    name: 'update_calendar_event',
    description:
      'Update an existing Google Calendar event by ID. Only pass the fields to change — omitted fields are preserved. Get the event ID from read_google_calendar first. Times must be ISO 8601 with Auckland offset.',
    input_schema: {
      type: 'object' as const,
      properties: {
        event_id: { type: 'string', description: 'Google Calendar event ID.' },
        title: { type: 'string', description: 'New event title.' },
        start: { type: 'string', description: 'New start datetime (ISO 8601 with Auckland offset).' },
        end: { type: 'string', description: 'New end datetime (ISO 8601 with Auckland offset).' },
        description: { type: 'string', description: 'New description.' },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Replacement attendee list (overwrites all existing attendees).',
        },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'delete_notion_task',
    description: 'Move a Notion task to trash. Requires explicit confirmation from Andrew before calling. Get page_id from read_notion_tasks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        page_id: { type: 'string', description: 'Notion page ID from read_notion_tasks.' },
      },
      required: ['page_id'],
    },
  },
  {
    name: 'delete_calendar_event',
    description:
      'Delete a Google Calendar event by ID. You MUST ask the user to confirm before calling this — pass confirmed: true only after they explicitly say yes. Get the event ID from read_google_calendar first.',
    input_schema: {
      type: 'object' as const,
      properties: {
        event_id: { type: 'string', description: 'Google Calendar event ID to delete.' },
        confirmed: {
          type: 'boolean',
          description: 'Must be true — only set after the user explicitly confirms deletion.',
        },
      },
      required: ['event_id', 'confirmed'],
    },
  },
  {
    name: 'update_context',
    description:
      "Persist something worth remembering about Andrew to long-term context. Use proactively for: behavioural patterns, preferences, important life updates, AND commitments Andrew makes (format: '[date] commitment: X by [deadline]. status: active. source: conversation.'). Be specific and write in third person. Do NOT use for temporary state or single-session info.",
    input_schema: {
      type: 'object' as const,
      properties: {
        entry: {
          type: 'string',
          description: 'The context entry to persist. Format: "[date] [category]: [observation]" e.g. "2026-05-19 behaviour: Andrew tends to default to ritual (sketching, exercise) over high-leverage work when time is short. needs nudging toward output over process."',
        },
      },
      required: ['entry'],
    },
  },
  {
    name: 'read_commitments',
    description: "Read active commitments Andrew has made from context-updates.md. Use during morning brief, evening log, and when assessing whether Andrew is on track.",
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'mark_commitment_complete',
    description: "Mark a commitment as complete in context-updates.md when Andrew confirms something is done.",
    input_schema: {
      type: 'object' as const,
      properties: {
        commitment: {
          type: 'string',
          description: 'The commitment text to mark complete (first 30 chars is enough to identify it).',
        },
      },
      required: ['commitment'],
    },
  },
  {
    name: 'search_notion',
    description: "search Andrew's Notion workspace for any page or database by keyword. use this to find project pages, pipelines, docs before reading them.",
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Keyword or phrase to search for.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_notion_page',
    description: "read the full content of any Notion page by page ID. use after search_notion to get the actual content of a page or pipeline doc.",
    input_schema: {
      type: 'object' as const,
      properties: {
        page_id: { type: 'string', description: 'Notion page ID.' },
      },
      required: ['page_id'],
    },
  },
  {
    name: 'fetch_url',
    description:
      'Fetch and summarise a URL — works for YouTube videos, articles, and web pages. Returns the title, description, and a one-paragraph summary of the content. Call this whenever the user sends a link before routing it to the inspiration archive or creating a reference note.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to fetch and summarise.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'transcribe_audio',
    description:
      'Transcribe a Telegram voice message via OpenAI Whisper. Returns the transcript as plain text. Call this when the user sends a voice message, then treat the transcript as a regular text capture and run it through the capture pipeline.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_id: {
          type: 'string',
          description: 'Telegram file_id of the voice message.',
        },
      },
      required: ['file_id'],
    },
  },
];
