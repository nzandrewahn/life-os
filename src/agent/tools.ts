import type Anthropic from '@anthropic-ai/sdk';

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_notion_tasks',
    description:
      'Read all active tasks from the Andrew Task Board in Notion (Status != Done). Returns each task with: name, status, priority, project, time estimate, energy, why, date, page URL, whether it has sub-items. Sorted by priority (Critical first) then energy (High last — save for good energy days). Call this when the user asks about their workload, when planning a day, or when identifying a task to update.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project: {
          type: 'string',
          enum: ['Lost Marbles', 'Abstracted Objects', 'Blender', 'Sketching', 'Personal', 'Other'],
          description: 'Optional project filter.',
        },
      },
      required: [],
    },
  },
  {
    name: 'decompose_task',
    description:
      'Analyze a task to determine if it is atomic (create directly) or abstract (needs breakdown). Call this BEFORE write_notion_task for any task where: time estimate is over 2.5 hours, no estimate is given, or the verb is broad (build, develop, create, launch, design, set up, plan, system, campaign). Returns {atomic: true} if the task can be created directly. Returns {atomic: false, breakdown: {phases: [...]}} if the task should be broken into subtasks — in this case, show the breakdown to the user and ask "add all, just phase 1, or want to adjust?" before creating anything.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Task name to analyze.' },
        time_estimate: { type: 'number', description: 'Estimated hours (if known).' },
        why: { type: 'string', description: 'Why this task matters (if known).' },
      },
      required: ['name'],
    },
  },
  {
    name: 'write_notion_task',
    description:
      'Create a new task in the Andrew Task Board in Notion. Only call this AFTER decompose_task has confirmed the task is atomic, or after the user has confirmed a decomposition breakdown. For abstract tasks being created as parents, set status to "Paused". Do NOT use for personal errands — those go to write_supabase_life_task.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Task name.' },
        project: {
          type: 'string',
          enum: ['Lost Marbles', 'Abstracted Objects', 'Blender', 'Sketching', 'Personal', 'Other'],
          description: 'Project this task belongs to.',
        },
        priority: {
          type: 'string',
          enum: ['Critical', 'High', 'Normal', 'Low'],
          description: 'Priority level.',
        },
        energy: {
          type: 'string',
          enum: ['Low', 'Medium', 'High'],
          description: 'Energy required to do this task.',
        },
        time_estimate: { type: 'number', description: 'Hours (0.5, 1, 2, etc.).' },
        why: { type: 'string', description: 'One sentence — why this task matters.' },
        date: { type: 'string', description: 'Optional due date (YYYY-MM-DD).' },
        status: {
          type: 'string',
          enum: ['Not started', 'In progress', 'Paused'],
          description: 'Initial status. Use "Paused" for parent tasks awaiting subtask completion.',
        },
      },
      required: ['name', 'priority'],
    },
  },
  {
    name: 'write_notion_subtask',
    description:
      'Create a subtask under a parent task in Notion. Use after the user confirms a decomposition breakdown — call this once for each subtask in the breakdown. The parent_url comes from the write_notion_task call that created the parent.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Subtask name.' },
        parent_url: { type: 'string', description: 'Notion URL of the parent task.' },
        priority: { type: 'string', enum: ['Critical', 'High', 'Normal', 'Low'] },
        energy: { type: 'string', enum: ['Low', 'Medium', 'High'] },
        time_estimate: { type: 'number', description: 'Hours.' },
        why: { type: 'string', description: 'Why this subtask matters.' },
        project: {
          type: 'string',
          enum: ['Lost Marbles', 'Abstracted Objects', 'Blender', 'Sketching', 'Personal', 'Other'],
        },
      },
      required: ['name', 'parent_url'],
    },
  },
  {
    name: 'update_notion_task_status',
    description:
      'Update the Status of a task in the Andrew Task Board. Use when Andrew says "done with X", "finished X", "mark X as complete" (→ Done), "working on X" (→ In progress), "pausing X" or "blocked on X" (→ Paused). Get the task URL from read_notion_tasks first if you don\'t already have it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        page_url: { type: 'string', description: 'Notion page URL of the task to update.' },
        status: {
          type: 'string',
          enum: ['Not started', 'In progress', 'Paused', 'Done'],
          description: 'New status.',
        },
      },
      required: ['page_url', 'status'],
    },
  },
  {
    name: 'read_notion_project',
    description:
      'Read a project page from Notion, including current phase, status, goal, and any linked tasks. Use when the user asks about a specific project or when you need project context before writing tasks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project: {
          type: 'string',
          description: 'Project name.',
        },
      },
      required: ['project'],
    },
  },
  {
    name: 'read_notion_programs',
    description:
      'Read the training and sketching schedule from Notion for a given date. Returns planned sessions, type, duration, and progression notes. Call this during morning briefs to include training and sketching in the day plan.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: {
          type: 'string',
          description: 'ISO date (YYYY-MM-DD). Defaults to today.',
        },
      },
      required: [],
    },
  },
  {
    name: 'write_notion_inspiration',
    description:
      'Add a link or reel to the Notion inspiration archive. Use this for URLs, YouTube links, and visual references only. Do NOT use for thoughts about the link — those go to write_obsidian_note with a wikilink back to the inspiration entry. Claude auto-generates the title and summary from the URL.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'The URL to archive.' },
        title: { type: 'string', description: 'Title (auto-pulled from URL if omitted).' },
        summary: {
          type: 'string',
          description: 'One-line summary of why this is relevant.',
        },
        category: {
          type: 'string',
          enum: ['Visual ref', 'Concept', 'Brand', 'Motion', 'Other'],
          description: 'Inspiration category.',
        },
        project: {
          type: 'string',
          description: 'Optional related project name.',
        },
      },
      required: ['url', 'summary', 'category'],
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
