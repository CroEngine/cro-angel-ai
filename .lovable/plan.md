## Status

Implementerat: src-baserad dedup för `customer_logos`. Container-dedup-passet körs nu bara för `trusted_by`. `_debug`-blocket borttaget.

## Verifiering

Kör Personio / Teamtailor / Talentium och bekräfta:
- Exakt **1** `customer_logos`-entry per sida.
- `logoCount` = unika srcs, `aboveFoldLogoCount` separat fält.

## Inte i scope

`trusted_by` text-entries, stars, org_number FP, badge dedup, geo-proxies, carousel-uppdelning hero/footer.
