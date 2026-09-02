-- ============================================================
-- Fourier v2 Database Schema & Row Level Security (RLS)
-- ============================================================

-- 1. Agent Events (Audit & Replay Log)
create table if not exists public.agent_events (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  user_id uuid references auth.users(id),
  mode text not null check (mode in ('live', 'simulate')),
  runway_days numeric not null,
  available_usdfc numeric not null,
  spend_rate_per_day numeric,
  action text not null,
  guardrail_status text not null,
  execution_status text not null,
  tx_hash text,
  reasoning text not null,
  raw_output_hash text not null,
  policy_version int not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_events_lookup 
on public.agent_events (agent_id, created_at desc);

-- 2. Agent Memory (Learning & Decision Feedback)
create table if not exists public.agent_memory (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  user_id uuid references auth.users(id),
  action text not null check (action in ('TOP_UP', 'TRIAGE', 'HOLD', 'WARN')),
  runway_days_at_decision numeric not null,
  amount_if_topup numeric,
  outcome text, -- evaluated and updated on next check cycle
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_memory_fetch 
on public.agent_memory (agent_id, created_at desc);

-- 3. Agent Requests (Multi-Agent Delegation)
create table if not exists public.agent_requests (
  id uuid primary key default gen_random_uuid(),
  requesting_agent_id text not null,
  treasury_agent_id text not null,
  user_id uuid references auth.users(id),
  amount_requested numeric not null check (amount_requested > 0),
  reason text not null,
  status text not null check (status in ('pending', 'approved', 'rejected')) default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_requests_queue 
on public.agent_requests (treasury_agent_id, status, created_at asc);

-- ============================================================
-- Row Level Security (RLS) Policies
-- ============================================================

alter table public.agent_events enable row level security;
alter table public.agent_memory enable row level security;
alter table public.agent_requests enable row level security;

revoke all on table public.agent_events from anon, authenticated;
revoke all on table public.agent_memory from anon, authenticated;
revoke all on table public.agent_requests from anon, authenticated;

-- Dashboard authenticated user read-only access (scoped to owner)
create policy "dashboard reads owned agent events"
on public.agent_events for select to authenticated
using (user_id = auth.uid());

create policy "dashboard reads owned agent memory"
on public.agent_memory for select to authenticated
using (user_id = auth.uid());

create policy "dashboard reads owned agent requests"
on public.agent_requests for select to authenticated
using (user_id = auth.uid());

-- Service role bypasses RLS automatically for backend agent synchronization
