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
      'Create a new task in the Andrew Task Board in Notion. Use for ALL project tasks — Lost Marbles, Abstracted Objects, Blender, Sketching, and any other project work. Do NOT use write_supabase_life_task for project tasks.',
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
      'Create a new atomic note in the Obsidian vault via GitHub API. Always call read_obsidian_index first — pass the returned note titles as the related field to auto-generate [[wikilinks]]. ' +
      'Folder routing rules: unclassified captures → "1.Inbox"; processed insights → "2.Notes/Captures"; references from URLs/YouTube → "2.Notes/Learnings"; daily logs → "2.Notes/Daily" with filename YYYY-MM-DD; weekly synthesis → "4.Synthesis" with filename YYYY-MM-DD-theme. ' +
      'For project-specific reflections use update_obsidian_note on the existing project file instead. ' +
      'Never write to: 3.Maps, Goals, Archive, Templates.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Descriptive title — not a dump of the raw capture. Written in the user\'s voice.',
        },
        content: {
          type: 'string',
          description: 'Note body text only — no frontmatter. One idea, written clearly.',
        },
        folder: {
          type: 'string',
          enum: ['1.Inbox', '2.Notes/Captures', '2.Notes/Learnings', '2.Notes/Daily', '4.Synthesis'],
          description: 'Vault folder to write into.',
        },
        filename: {
          type: 'string',
          description: 'Filename without extension. Use YYYY-MM-DD for daily notes, kebab-case for everything else.',
        },
        type: {
          type: 'string',
          enum: ['insight', 'capture', 'reference', 'daily', 'synthesis'],
          description: 'Note type for frontmatter.',
        },
        project: {
          type: 'string',
          description: 'Related project name for frontmatter (e.g. "Lost Marbles Studio").',
        },
        source: {
          type: 'string',
          description: 'Origin of the content. Defaults to "telegram-capture".',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for frontmatter and indexing.',
        },
        related: {
          type: 'array',
          items: { type: 'string' },
          description: 'Note titles from read_obsidian_index to include as [[wikilinks]] in the related frontmatter field.',
        },
      },
      required: ['title', 'content', 'folder', 'filename', 'type'],
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
      'Persist an important fact learned through conversation that should be remembered permanently beyond the 14-day message history window. Use when Andrew mentions something significant that changes his situation — a new client, a location change, a business decision, a major life update. Do NOT use for tasks or fleeting thoughts — those go to Supabase or Obsidian. Appends to context-updates.md with a timestamp.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fact: {
          type: 'string',
          description: 'The fact to persist, written in third person (e.g. "Andrew is moving to Sydney in June").',
        },
        category: {
          type: 'string',
          enum: ['situation', 'business', 'personal', 'financial'],
          description: 'Category of the update.',
        },
      },
      required: ['fact', 'category'],
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
