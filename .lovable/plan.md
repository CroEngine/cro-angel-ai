Jag hittade en trolig orsak: standardsekvensen kör `pageAudit` före `collect`, men screenshot tas bara i `collect`. Efter trust-signal-ändringarna kan `pageAudit` bli långsammare eller falla, och då nås aldrig screenshot-steget.

Plan:
1. Ändra standardsekvensen så `collect` körs direkt efter `goto/wait`, före `pageAudit`.
2. Behåll screenshot-capture inne i `collect`, så viewporten kan frysa även om `pageAudit` senare failar.
3. Lägg till tydligare logg/terminalstatus när körningen avslutas utan snapshot, så vi kan skilja mellan “collect kördes inte” och “screenshot failed”.
4. Om screenshot fortfarande saknas efter det: nästa steg blir att flytta stora screenshots ur SSE-payloaden till separat lagring/URL, eftersom data-URL i event stream kan bli för stor på långa sidor.

Tekniskt ändras sannolikt bara:
- `src/lib/tests/run.functions.ts` för step-ordningen
- event/logik i `src/components/browser-shell/BrowserShell.tsx` eller `Viewport.tsx` för bättre feedback om snapshot saknas