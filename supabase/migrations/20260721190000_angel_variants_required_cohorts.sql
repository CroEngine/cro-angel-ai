-- Kohortscopade varianter (E4b-kopplingen): den ägargodkända regelns
-- kohortkrav (labbets vokabulär ch:/src:/ret:/seen:) på variantposten.
-- NULL/tom = ingen grindning — mekanismen är av tills en regel sätter den.
-- Servern härleder besökarens nycklar själv (cohortsForVisitor) ur signaler
-- som redan samlas; inget nytt klientdata, inget klientförtroende.
alter table public.angel_variants
  add column if not exists required_cohorts text[] default null;
