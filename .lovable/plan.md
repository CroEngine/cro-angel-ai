Mål: när sessionen tar slut ska användaren aldrig se Browserbases råa "debugging connection was closed · reopen devtools"-meddelande. Istället en polerad overlay som signalerar att testet är klart.

Ändringar i `src/components/browser-shell/Viewport.tsx`:
1. När `ended === true`, lägg en heltäckande overlay ovanpå iframen (samma stack, `absolute inset-0`, `backdrop-blur-sm`, mjuk gradient i bakgrunden).
2. Innehåll i overlayen:
   - Liten ikon (CheckCircle eller liknande) i en mjuk badge.
   - Rubrik: "Session ended".
   - Underrad: kort förtroendebyggande text, t.ex. "Test run completed successfully. The live preview has been closed."
   - Två knappar: primär "Run again" (kallar samma callback som "Run tests" — behöver en ny prop `onRunAgain`) och sekundär "Close" (befintlig `onClose`).
3. Behåll status-chippet uppe till vänster men ändra "ended · session paused" → "Completed".
4. iframen ligger kvar bakom overlayen men görs visuellt nedtonad (`opacity-40`) så Browserbases reconnect-text aldrig syns ren.

Ändringar i `src/components/browser-shell/BrowserShell.tsx` (eller där `Viewport` används):
5. Skicka ned en `onRunAgain`-prop som triggar samma flöde som "Run tests"-knappen.

Inga ändringar i backend/lifecycle — vi täcker bara över det fula meddelandet visuellt. Tokens från `src/styles.css`, ingen hårdkodad färg.