import Anthropic from '@anthropic-ai/sdk';

const haiku = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type ClassificationLabel =
  | 'project-task'
  | 'life-task'
  | 'insight'
  | 'idea'
  | 'reference'
  | 'learning'
  | 'noise'
  | 'conversation';

export interface Classification {
  classification: ClassificationLabel;
  project: string;
  confidence: number;
}

const PROMPT = `Classify this capture into exactly one category:
- project-task: actionable, belongs to a named project
- life-task: personal, logistical, domestic
- insight: thought, reflection, reaction to something
- idea: half-formed concept not ready to be a task
- reference: link or article worth keeping
- learning: something learned from a video, article, book
- noise: not worth keeping
- conversation: question, request for information, or general chat

Return JSON only: {"classification": "", "project": "", "confidence": 0.0}`;

export async function classify(text: string): Promise<Classification> {
  const response = await haiku.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 150,
    messages: [{ role: 'user', content: `${PROMPT}\n\nCapture: ${text}` }],
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('unexpected haiku response type');

  const raw = block.text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
  return JSON.parse(raw) as Classification;
}
