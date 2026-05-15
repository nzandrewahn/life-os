import { createClient } from '@supabase/supabase-js';
import type { DbMessage } from './types';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export async function logMessage(
  chatId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  const now = new Date().toISOString();
  const today = now.split('T')[0];

  const { error: msgError } = await supabase
    .from('messages')
    .insert({ chat_id: chatId, role, content });
  if (msgError) throw new Error(`Failed to log message: ${msgError.message}`);

  const { data: existing } = await supabase
    .from('daily_logs')
    .select('message_count, first_message_at')
    .eq('date', today)
    .maybeSingle();

  const { error: logError } = await supabase
    .from('daily_logs')
    .upsert(
      {
        date: today,
        message_count: (existing?.message_count ?? 0) + 1,
        first_message_at: existing?.first_message_at ?? now,
        last_message_at: now,
      },
      { onConflict: 'date' }
    );
  if (logError) throw new Error(`Failed to update daily log: ${logError.message}`);
}

export async function getRecentHistory(chatId: string, days = 14): Promise<DbMessage[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('chat_id', chatId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch history: ${error.message}`);
  return data ?? [];
}
