-- Block 3 (lansering): betalning. Prenumeration per KONTO (399 USD/mån,
-- 30 dagars trial med kort via Stripe Checkout). Sajtens billing_status
-- synkas av webhooken från kontots prenumeration:
--
--   exempt   — pilot/labb/legacy (alla rader som fanns före lanseringen);
--              serving gate:as inte av betalning. Sätts bara manuellt.
--   none     — ny sajt utan prenumeration: observation OK, serving stängd.
--   trialing/active    — serving tillåten.
--   past_due/canceled  — serving PAUSAD (besökarna ser originalsidan; datan
--                        bevaras). Snyggt avslut är också varumärke.

create table if not exists angel_billing (
  user_id uuid primary key,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  status text not null default 'none',
  trial_end timestamptz,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
alter table angel_billing enable row level security;

alter table angel_sites add column if not exists billing_status text not null default 'exempt';
