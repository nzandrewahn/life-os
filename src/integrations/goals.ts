import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

// ─── Types ─────────────────────────────────────────────────────────────────

export interface Goal {
  id: string;
  title: string;
  description?: string;
  parent_goal_id?: string;
  status: 'active' | 'complete' | 'paused' | 'dropped';
  priority: 'critical' | 'high' | 'normal' | 'low';
  deadline?: string;
  created_at: string;
  updated_at: string;
  children?: Goal[];
}

export interface Commitment {
  id: string;
  goal_id?: string;
  statement: string;
  deadline?: string;
  status: 'active' | 'complete' | 'slipped' | 'adjusted';
  slip_count: number;
  source?: string;
  last_checked?: string;
  last_reply?: string;
  created_at: string;
  updated_at: string;
  goals?: { title: string; parent_goal_id?: string };
}

// ─── Goals ─────────────────────────────────────────────────────────────────

export async function getGoalTree(): Promise<Goal[]> {
  const { data } = await supabase
    .from('goals')
    .select('*')
    .eq('status', 'active')
    .order('priority');

  if (!data) return [];

  const roots = data.filter((g: Goal) => !g.parent_goal_id);
  const withChildren = (goal: Goal): Goal => ({
    ...goal,
    children: data
      .filter((g: Goal) => g.parent_goal_id === goal.id)
      .map(withChildren),
  });

  return roots.map(withChildren);
}

export async function addGoal(params: {
  title: string;
  description?: string;
  parentGoalId?: string;
  priority?: string;
  deadline?: string;
}): Promise<Goal> {
  const { data, error } = await supabase
    .from('goals')
    .insert({
      title: params.title,
      description: params.description ?? null,
      parent_goal_id: params.parentGoalId ?? null,
      priority: params.priority ?? 'normal',
      deadline: params.deadline ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(`[goals] addGoal failed: ${error.message}`);
  return data as Goal;
}

export async function completeGoal(id: string): Promise<void> {
  const { error } = await supabase
    .from('goals')
    .update({ status: 'complete', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`[goals] completeGoal failed: ${error.message}`);
}

// ─── Commitments ───────────────────────────────────────────────────────────

export async function addCommitment(params: {
  statement: string;
  goalId?: string;
  deadline?: string;
  source?: string;
}): Promise<Commitment> {
  const { data, error } = await supabase
    .from('commitments')
    .insert({
      statement: params.statement,
      goal_id: params.goalId ?? null,
      deadline: params.deadline ?? null,
      source: params.source ?? 'conversation',
    })
    .select()
    .single();
  if (error) throw new Error(`[goals] addCommitment failed: ${error.message}`);
  return data as Commitment;
}

export async function getActiveCommitments(): Promise<Commitment[]> {
  const { data } = await supabase
    .from('commitments')
    .select('*, goals(title, parent_goal_id)')
    .eq('status', 'active')
    .order('deadline', { ascending: true, nullsFirst: false });
  return (data ?? []) as Commitment[];
}

export async function getOverdueCommitments(): Promise<Commitment[]> {
  const { data } = await supabase
    .from('commitments')
    .select('*, goals(title)')
    .eq('status', 'active')
    .lt('deadline', new Date().toISOString());
  return (data ?? []) as Commitment[];
}

export async function getDueTodayCommitments(): Promise<Commitment[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const { data } = await supabase
    .from('commitments')
    .select('*, goals(title)')
    .eq('status', 'active')
    .gte('deadline', today.toISOString())
    .lt('deadline', tomorrow.toISOString());
  return (data ?? []) as Commitment[];
}

export async function completeCommitment(id: string): Promise<void> {
  const { error } = await supabase
    .from('commitments')
    .update({ status: 'complete', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`[goals] completeCommitment failed: ${error.message}`);
}

export async function logSlip(params: {
  commitmentId: string;
  reason?: string;
  newDeadline?: string;
}): Promise<void> {
  // fetch current slip count and increment
  const { data: current } = await supabase
    .from('commitments')
    .select('slip_count')
    .eq('id', params.commitmentId)
    .single();

  const { error: slipError } = await supabase
    .from('commitment_slips')
    .insert({
      commitment_id: params.commitmentId,
      reason: params.reason ?? null,
      new_deadline: params.newDeadline ?? null,
    });
  if (slipError) throw new Error(`[goals] logSlip insert failed: ${slipError.message}`);

  const { error: updateError } = await supabase
    .from('commitments')
    .update({
      slip_count: (current?.slip_count ?? 0) + 1,
      status: params.newDeadline ? 'adjusted' : 'slipped',
      ...(params.newDeadline && { deadline: params.newDeadline }),
      last_reply: params.reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.commitmentId);
  if (updateError) throw new Error(`[goals] logSlip update failed: ${updateError.message}`);
}

export async function updateCommitmentLastChecked(id: string, reply?: string): Promise<void> {
  await supabase
    .from('commitments')
    .update({
      last_checked: new Date().toISOString(),
      last_reply: reply ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
}
