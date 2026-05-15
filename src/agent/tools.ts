import type Anthropic from '@anthropic-ai/sdk';

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_notion_tasks',
    description:
      'Read tasks from Notion for a given date, optionally filtered by project. Returns each task with title, project, effort, time estimate, priority, status, and why. Call this at the start of morning briefs, when the user asks about their workload, or when planning a day.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: {
          type: 'string',
          description: 'ISO date (YYYY-MM-DD). Defaults to today.',
        },
        project: {
          type: 'string',
          description: 'Optional project name to filter by.',
        },
      },
      required: [],
    },
  },
  {
    name: 'write_notion_task',
    description:
      'Create a new task in Notion. Use this for anything actionable that belongs to an active project — work deliverables, creative tasks, project milestones. Do NOT use for personal errands, groceries, admin, or anything not tied to a named project. Always include effort, time_estimate, priority, and why.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Task name.' },
        project: { type: 'string', description: 'Project this task belongs to.' },
        effort: {
          type: 'string',
          enum: ['Low', 'Medium', 'High'],
          description: 'Effort level.',
        },
        time_estimate: {
          type: 'number',
          description: 'Hours (0.5, 1, 2, etc.).',
        },
        priority: {
          type: 'string',
          enum: ['Critical', 'High', 'Normal', 'Low'],
          description: 'Priority level.',
        },
        why: {
          type: 'string',
          description: 'One sentence — why this task matters.',
        },
        due: {
          type: 'string',
          description: 'Optional due date (YYYY-MM-DD).',
        },
      },
      required: ['title', 'project', 'effort', 'time_estimate', 'priority', 'why'],
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
      'Read events from Google Calendar for today and the next N days. Use this when the user asks what is on their calendar, what they have planned, or during morning briefs. Returns event titles, start/end times, and locations.',
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
