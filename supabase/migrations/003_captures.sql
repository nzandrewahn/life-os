create table if not exists captures (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  raw_content text not null,
  content_type text not null check (content_type in ('link', 'text', 'voice')),
  classification text,
  project text,
  confidence float,
  routed_to text,
  reviewed boolean default false
);

create index if not exists captures_created_at_idx on captures(created_at desc);

alter table captures disable row level security;
