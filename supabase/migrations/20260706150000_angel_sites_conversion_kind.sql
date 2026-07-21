-- Persist WHAT converting means, not just where it is clicked.
--
-- confirmGoal used to keep only the candidate's selector/text/url and DISCARD
-- its judged kind — so the runtime engine could never condition on the goal
-- taxonomy the judge ranks by (a lead-gen site's clarify_cta hunted for
-- demo/trial labels forever). Set by confirmGoal from the confirmed
-- GoalCandidate.kind; cleared by a raw owner override (setMeasurementConfig),
-- which carries no judged kind.
--
-- Values mirror the GoalKind union in src/adaptive/crawler-inventory.ts.
-- Adding a kind there requires a migration here — deliberate: the enum IS the
-- shared goal vocabulary and must not drift silently.

alter table public.angel_sites
  add column if not exists conversion_kind text
    check (conversion_kind in (
      'signup', 'purchase', 'booking', 'trial', 'quote', 'contact',
      'lead', 'outbound', 'start_flow', 'subscribe', 'download', 'donate'
    ));
