import { createClient } from '@supabase/supabase-js';
import { detectContent } from './detect';
import { classify, type Classification } from './classify';
import { runAgentLoop } from '../agent/loop';
import type { DbMessage } from '../types';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export type PipelineResult =
  | { type: 'reply'; message: string }
  | { type: 'clarify'; question: string; classification: Classification };

// Routing table: classification → folder/action hint for agent directive
const ROUTING: Record<string, string> = {
  'project-task':  'call write_notion_task',
  'life-task':     'call write_supabase_life_task then create_reminder',
  'insight':       'call write_obsidian_note with type "idea" — routes to 1.Inbox',
  'idea':          'call write_obsidian_note with type "idea" — routes to 1.Inbox',
  'reference':     'call write_obsidian_note with type "reference" — routes to 1.Inbox',
  'learning':      'call write_obsidian_note with type "learning" — routes to 2.Notes/Learnings',
  'noise':         'call write_supabase_capture only — do not route anywhere else',
};

export async function runCapturePipeline(
  message: string,
  history: DbMessage[],
  contentType: 'text' | 'voice' = 'text'
): Promise<PipelineResult> {
  const detected = detectContent(message);

  if (detected.isSplit && detected.url && detected.text) {
    return runSplitPipeline(detected.url, detected.text, history);
  }

  const textToClassify = detected.hasUrl ? (detected.url ?? message) : message;
  const cls = await classify(textToClassify);

  await logCapture(message, detected.hasUrl ? 'link' : contentType, cls);

  if (cls.confidence < 0.7) {
    return { type: 'clarify', question: 'task or thought?', classification: cls };
  }

  const reply = await runAgentLoop(buildDirective(message, detected.hasUrl ? 'link' : contentType, cls), history);
  return { type: 'reply', message: reply };
}

// Resolve a pending clarification: user answered "task" or "thought" (or similar)
export async function resolvePending(
  answer: string,
  originalMessage: string,
  pendingCls: Classification,
  history: DbMessage[]
): Promise<string> {
  const resolved = resolveFromAnswer(answer, pendingCls);
  const detected = detectContent(originalMessage);
  const directive = buildDirective(originalMessage, detected.hasUrl ? 'link' : 'text', resolved);
  return runAgentLoop(directive, history);
}

// For messages with both a URL and meaningful surrounding text — route each separately
async function runSplitPipeline(
  url: string,
  thought: string,
  history: DbMessage[]
): Promise<PipelineResult> {
  const [urlCls, thoughtCls] = await Promise.all([classify(url), classify(thought)]);

  await Promise.all([
    logCapture(url, 'link', urlCls),
    logCapture(thought, 'text', thoughtCls),
  ]);

  const directive = `[pipeline: split — url + thought]

url: ${url}
url classification: ${urlCls.classification} — ${ROUTING[urlCls.classification] ?? 'log only'}

thought: "${thought}"
thought classification: ${thoughtCls.classification}${thoughtCls.project ? `, project: ${thoughtCls.project}` : ''} — ${ROUTING[thoughtCls.classification] ?? 'log only'}

handle both parts using the appropriate tools. reply with one short line per route, all lowercase.`;

  const reply = await runAgentLoop(directive, history);
  return { type: 'reply', message: reply };
}

function buildDirective(
  message: string,
  contentType: 'link' | 'text' | 'voice',
  cls: Classification
): string {
  const routing = ROUTING[cls.classification] ?? 'log to supabase captures only';
  const projectLine = cls.project ? `\nproject: ${cls.project}` : '';

  return `[pipeline: ${cls.classification}, confidence: ${cls.confidence}${projectLine}]
action: ${routing}
reply with one line confirming what was filed and where, all lowercase.

---
capture: "${message}"`;
}

function resolveFromAnswer(answer: string, pending: Classification): Classification {
  const lower = answer.toLowerCase();
  if (lower.includes('project') || lower.includes('work')) {
    return { ...pending, classification: 'project-task', confidence: 1 };
  }
  if (lower.includes('life') || lower.includes('errand') || lower.includes('task')) {
    return { ...pending, classification: 'life-task', confidence: 1 };
  }
  if (lower.includes('idea')) {
    return { ...pending, classification: 'idea', confidence: 1 };
  }
  return { ...pending, classification: 'insight', confidence: 1 };
}

async function logCapture(
  raw_content: string,
  content_type: 'link' | 'text' | 'voice',
  cls: Classification
): Promise<void> {
  await supabase.from('captures').insert({
    raw_content,
    content_type,
    classification: cls.classification,
    project: cls.project || null,
    confidence: cls.confidence,
    routed_to: cls.classification === 'noise' ? 'discarded' : routedTo(cls.classification),
  });
}

function routedTo(cls: string): string {
  if (cls === 'project-task') return 'notion';
  if (cls === 'life-task') return 'life_tasks';
  if (['insight', 'idea', 'learning'].includes(cls)) return 'obsidian';
  if (cls === 'reference') return 'notion';
  return 'discarded';
}
