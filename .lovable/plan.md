Problemet just nu verkar inte vara en trasig appkod: lokal server svarar 200 och appen renderar i test-browsern. Din iframe visar däremot Lovables “Preview has not been built yet”, vilket pekar på att preview-lagret är stale eller inte kopplat till den körande dev-servern.

Plan:

1. Starta om preview/dev-servern kontrollerat
   - Använd Lovables preview-restart så iframe-lagret kopplas om till den server som redan svarar lokalt.
   - Kontrollera serverloggarna direkt efter omstart för build/runtime-fel.

2. Verifiera rätt route och API
   - Öppna `/` och `/corpus` i preview.
   - Testa `/api/public/corpus/hibob/golden.json?download=1` via fetch/nätverk, inte som vanlig toppnivå-navigation.

3. Om preview fortfarande visar placeholder
   - Behandla det som Lovable-preview/proxyproblem, inte appkod.
   - Samla bevis: server 200, preview placeholder, tomma runtime errors.
   - Då är nästa praktiska steg att använda History/restart eller publicera ny preview när byggsystemet släpper låsningen.

4. Endast om loggar visar nytt fel
   - Fixa det specifika felet i aktuell fil.
   - Ändra inte `routeTree.gen.ts` manuellt igen; routeträdet ska genereras från faktiska filer under `src/routes/`.

Tekniskt nuläge:
- `src/routes/api/public/corpus.$.ts` finns.
- `src/routeTree.gen.ts` pekar nu på `./routes/api/public/corpus.$`, inte den gamla saknade `/src/routes/api/corpus.$.ts`.
- `curl http://localhost:8080/` returnerar 200 HTML.
- Browser-test visar appens UI, inte placeholdern.