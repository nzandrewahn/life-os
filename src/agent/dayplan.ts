import Anthropic from '@anthropic-ai/sdk';
import { readNotionTasks } from '../integrations/notion';
import { readCalendarEvents } from '../integrations/google-calendar';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function runDayPlan(energy: number, hoursAvailable: number): Promise<string> {
  const [tasks, events] = await Promise.all([
    readNotionTasks(),
    readCalendarEvents(1),
  ]);

  const committedHours = events.reduce((total, event) => {
    if (event.start && event.end && !event.allDay) {
      const duration = (new Date(event.end).getTime() - new Date(event.start).getTime()) / 3600000;
      return total + duration;
    }
    return total;
  }, 0);

  const freeHours = Math.max(0, hoursAvailable - committedHours);
  const plannableHours = Math.round(freeHours * 0.8 * 10) / 10;

  const taskList = tasks
    .map(t =>
      `- ${t.name} | project: ${t.project ?? 'untagged'} | priority: ${t.priority || 'normal'} | energy: ${t.energy || 'unknown'} | time: ${t.timeEstimate != null ? t.timeEstimate + 'hr' : 'unknown'} | why: ${t.why || 'not set'} | id: ${t.id}`
    )
    .join('\n');

  const prompt = `Andrew has ${energy}/10 energy and ${hoursAvailable} hours available today. Calendar takes ${committedHours.toFixed(1)}hrs, leaving ${plannableHours}hrs plannable (with 20% buffer).

Tasks:
${taskList}

Build a focused day plan using these rules:
- Critical tasks always included regardless of energy
- Energy <= 3: only Low/Medium energy tasks (+ Critical)
- Energy 4-6: Low/Medium/High tasks (+ Critical)
- Energy >= 7: all tasks
- Never exceed ${plannableHours}hrs total for scheduled tasks
- Tasks with no time estimate go to "if time allows"
- Order by: Critical first, then High, then Normal

Reply in this exact format, all lowercase:

${plannableHours}hrs to work with.

— plan —
[Xhr] task name (project)
why: one line

— if time allows —
task name
task name

Keep it tight. No padding. No intro sentence.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.find(b => b.type === 'text');
  return text?.text ?? 'could not generate plan.';
}
