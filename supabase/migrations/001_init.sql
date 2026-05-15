create table if not exists messages (
  id uuid default gen_random_uuid() primary key,
  chat_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now()
);

create index if not exists messages_chat_id_created_at_idx
  on messages(chat_id, created_at asc);

create table if not exists daily_logs (
  id uuid default gen_random_uuid() primary key,
  date date not null unique,
  message_count integer not null default 0,
  first_message_at timestamptz,
  last_message_at timestamptz
);
