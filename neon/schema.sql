-- ============================================================
-- Fourier — Neon (Postgres) cloud mirror schema
--
-- Model: the local agent is the single source of truth. It mirrors
-- events/memory/requests here one-way, keyed by agent_id. Online
-- viewers authenticate with an ACCESS CODE (not a login): the code
-- resolves to one agent_id, and the viewer API only ever reads.
--
-- Security notes:
--   - Access codes are stored HASHED (sha256); a leaked DB does not
--     leak usable codes. Rotation = new row, old row revoked.
--   - No RLS / anon roles: the only client is the server-side process
--     (agent sync + viewer API) holding FOURIER_DATABASE_URL. It must
--     never be exposed to browsers.
--   - The cloud layer has no execution authority by design.
-- ============================================================

-- 1. Access codes: the "account". One agent may have several rows over
--    time (rotation); only unrevoked rows resolve.
create table if not exists public.agent_codes (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  code_hash text not null unique,          -- sha256 hex of the raw code
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists idx_agent_codes_lookup
  on public.agent_codes (code_hash) where revoked_at is null;

-- 2. Agent events (audit & chart data)
create table if not exists public.agent_events (
  id uuid primary key,                     -- deterministic uuid from agent
  agent_id text not null,
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
  policy_version int,
  source text,                             -- live | scenario | demo-fixture
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_events_lookup
  on public.agent_events (agent_id, created_at desc);

-- 2b. Agent state snapshot (policy + thresholds for the online viewer)
create table if not exists public.agent_state (
  agent_id text primary key,
  policy jsonb,
  updated_at timestamptz not null default now()
);

-- 3. Agent memory (learning & decision feedback)
create table if not exists public.agent_memory (
  id uuid primary key,                     -- deterministic uuid from agent
  agent_id text not null,
  action text not null check (action in ('TOP_UP', 'TRIAGE', 'HOLD', 'WARN')),
  runway_days_at_decision numeric not null,
  amount_if_topup numeric,
  outcome text,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_memory_fetch
  on public.agent_memory (agent_id, created_at desc);

-- 4. Delegation requests (child <-> treasury)
create table if not exists public.agent_requests (
  id text primary key,                     -- req_<hex> from the agent
  requesting_agent_id text not null,
  treasury_agent_id text not null,
  requesting_agent_address text,
  amount_requested numeric not null check (amount_requested > 0),
  reason text not null,
  status text not null check (status in ('pending', 'approved', 'rejected')) default 'pending',
  tx_hash text,
  rejection_reason text,
  created_at timestamptz not null default now(),
  evaluated_at timestamptz,
  settled_at timestamptz
);

create index if not exists idx_agent_requests_queue
  on public.agent_requests (treasury_agent_id, status, created_at asc);
