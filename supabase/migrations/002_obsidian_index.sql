create table if not exists obsidian_index (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  path text not null unique,
  folder text not null,
  type text not null,
  project text,
  tags text[],
  created_at timestamptz default now()
);

create index if not exists obsidian_index_project_idx on obsidian_index(project);
create index if not exists obsidian_index_created_at_idx on obsidian_index(created_at desc);

alter table obsidian_index disable row level security;
