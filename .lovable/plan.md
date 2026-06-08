Problemet är inte att filerna saknas: `/api/public/corpus/...` svarar och screenshots laddas med 200. Det som stoppar dig är Lovable Preview/editorn: en vanlig `<a href="/api/public/..." download>` blir en toppnivå-navigation/download i previewmiljön, och den kan hamna i Lovables preview-auth/proxy i stället för att sparas som fil. Det är därför bilder/inline JSON kan fungera men själva download-knappen ändå skickar dig mot inloggning.

Do I know what the issue is? Ja.

Plan:

1. Ändra download-knapparna i `src/routes/corpus.tsx`
   - Byt från `<a href=... download>` till en riktig `button` med `onClick`.
   - Klicket kör `fetch(apiUrl(...)?download=1)`, läser filen som `Blob`, skapar en temporär `blob:`-URL och triggar en lokal nedladdning.
   - Då navigerar browsern aldrig till Lovable-route direkt, så preview-authen får inget att kapa.

2. Behåll befintlig visning
   - Screenshot `<img>` och inline JSON kan fortsätta använda `apiUrl(...)`.
   - `listCorpus` och intern RPC rörs inte.

3. Gör public-routen CORS-säker för fallback-hostar
   - I `src/routes/api/public/corpus.$.ts`, lägg till `Access-Control-Allow-Origin: *` och relevanta headers på filsvaret.
   - Lägg till `OPTIONS`-handler, så fetch fungerar även om appen körs från `id-preview--...` och filen hämtas från stabil preview-host.

4. Verifiering
   - Öppna `/corpus` i preview.
   - Klicka `golden.json`, `page.mhtml` och `screenshot.jpg`.
   - Bekräfta att filerna laddas ner utan att sidan navigerar till Lovable-login.

<presentation-actions>
  <presentation-open-history>View History</presentation-open-history>
</presentation-actions>

<presentation-actions>
<presentation-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</presentation-link>
</presentation-actions>