create table public.project_tasks (
  id            uuid                     default gen_random_uuid() primary key,
  created_at    timestamp with time zone default now(),
  title         text                     not null,
  project       text,
  effort        text,
  time_estimate float,
  priority      text                     default 'normal',
  status        text                     default 'not started',
  why           text,
  due_date      date
);

alter table public.project_tasks disable row level security;
