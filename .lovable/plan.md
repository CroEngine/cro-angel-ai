# Plan: Konsolidera här, flytta in data — skapa inte nytt projekt

## TL;DR
Skapa **inte** ett nytt Lovable-projekt. Det löser inget och tappar PR-historik. Lös istället de två faktiska problemen i tur och ordning:

1. Få in koden från PR #4 + #5 i det här projektet (main).
2. Få in datan från `upvthvbhqzqqimsyjpxw` i den Cloud-instans Lovable redan äger här (`hmhuqqgckuujxwrtdrkj`).

## Varför inte ett nytt projekt
- Ett nytt Lovable-projekt = ny tom Cloud-instans + nytt GitHub-repo. Samma problem som idag, plus att PR #4/#5 hänger kvar mot det gamla repot.
- Lovable Cloud kan **inte** pekas om till en extern Supabase-instans (`upvthvbhqzqqimsyjpxw`). Cloud-projektet är managerat 1:1 mot Lovable-projektet.
- Det "byte av Supabase" du gjorde i Supabase-dashboarden påverkar inte den här sandboxen — `.env` här pekar fortfarande på `hmhuqqgckuujxwrtdrkj`, och det är den Lovable använder.

## Steg 1 — Konsolidera kod (gör först)
- Merga PR #4 (migrationer) och PR #5 (motor + adaptive.js) på GitHub till `main`.
- GitHub-integrationen syncar ner till sandbox automatiskt — sen är main = sanningen, en branch.
- Om du vill att jag tittar på diff och föreslår merge-ordning innan du klickar: säg till så kollar jag PR-innehåll vs nuvarande main.

## Steg 2 — Flytta data till Lovable Cloud-instansen
Två alternativ, du väljer:

**A) Migrera datan in i `hmhuqqgckuujxwrtdrkj` (rekommenderat)**
- Kör PR #4-migrationerna som vanliga Lovable-migrationer här → schemat finns i Cloud-instansen.
- Exportera CSV per tabell från `upvthvbhqzqqimsyjpxw` (Supabase dashboard → Table editor → Export).
- Importera CSV via Lovable Cloud → Database → Tables → Import.
- Resultat: en enda källa till sanning (Lovable Cloud), allt kopplat, inga divergerande states.

**B) Behåll `upvthvbhqzqqimsyjpxw` som extern Supabase**
- Kräver att vi tar bort Lovable Cloud-integrationen och hårdkodar externa Supabase-nycklar i `.env` + `src/integrations/supabase/client.ts`.
- Du tappar Lovable Cloud-verktygen (migration-godkännanden, types-regenerering, edge function-deploy via Lovable, secrets-UI).
- Inte rekommenderat om datan är ~0–låg volym och du ändå tänkt köra Lovable som nav.

## Vad jag behöver från dig för att gå vidare
- Bekräfta: kör Steg 1 (merga PR #4 + #5) — vill du att jag granskar diff först?
- Välj Steg 2: **A** (migrera in i Cloud) eller **B** (extern Supabase)?
