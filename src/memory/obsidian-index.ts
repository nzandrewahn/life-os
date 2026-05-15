import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export interface IndexEntry {
  title: string;
  path: string;
  folder: string;
  type: string;
  project?: string;
  tags?: string[];
}

export async function queryIndex(params: {
  query?: string;
  project?: string;
  limit?: number;
}): Promise<IndexEntry[]> {
  let q = supabase
    .from('obsidian_index')
    .select('title, path, folder, type, project, tags')
    .order('created_at', { ascending: false })
    .limit(params.limit ?? 10);

  if (params.project) {
    q = q.eq('project', params.project);
  }

  if (params.query) {
    q = q.ilike('title', `%${params.query}%`);
  }

  const { data, error } = await q;
  if (error) throw new Error(`obsidian_index query: ${error.message}`);
  return (data ?? []) as IndexEntry[];
}

export async function insertIndex(entry: IndexEntry): Promise<void> {
  const { error } = await supabase.from('obsidian_index').insert(entry);
  if (error) throw new Error(`obsidian_index insert: ${error.message}`);
}
