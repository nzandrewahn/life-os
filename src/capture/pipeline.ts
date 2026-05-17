import { detectContent } from './detect';
import { classify, type Classification } from './classify';
import { runAgentLoop } from '../agent/loop';

export type PipelineResult =
  | { type: 'reply'; message: string }
  | { type: 'clarify'; question: string; classification: Classification };

// Routing table: classification → action hint for agent directive
const ROUTING: Record<string, string> = {
  'project-task':  'call write_notion_task',
  'life-task':     'call write_life_task',
  'insight':       'call write_obsidian_note with type "idea" — routes to 1.Inbox',
  'idea':          'call write_obsidian_note with type "idea" — routes to 1.Inbox',
  'reference':     'call write_obsidian_note with type "reference" — routes to 1.Inbox',
  'learning':      'call write_obsidian_note with type "learning" — routes to 2.Notes/Learnings',
};

type ConvoHistory = Array<{ role: string; content: string }>;

export async function runCapturePipeline(
  message: string,
  history: ConvoHistory,
  contentType: 'text' | 'voice' = 'text'
): Promise<PipelineResult> {
  const detected = detectContent(message);

  if (detected.isSplit && detected.url && detected.text) {
    return runSplitPipeline(detected.url, detected.text, history);
  }

  const textToClassify = detected.hasUrl ? (detected.url ?? message) : message;
  const cls = await classify(textToClassify);

  if (cls.confidence < 0.7) {
    return { type: 'clarify', question: 'task or thought?', classification: cls };
  }

  if (cls.classification === 'noise') {
    return { type: 'reply', message: 'noted.' };
  }

  const reply = await runAgentLoop(buildDirective(message, detected.hasUrl ? 'link' : contentType, cls), history);
  return { type: 'reply', message: reply };
}

// Resolve a pending clarification: user answered "task" or "thought" (or similar)
export async function resolvePending(
  answer: string,
  originalMessage: string,
  pendingCls: Classification,
  history: ConvoHistory
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
  history: ConvoHistory
): Promise<PipelineResult> {
  const [urlCls, thoughtCls] = await Promise.all([classify(url), classify(thought)]);

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
  const routing = ROUTING[cls.classification] ?? 'call write_obsidian_note with type "idea" — routes to 1.Inbox';
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

