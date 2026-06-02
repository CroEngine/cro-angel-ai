## Plan

Jag ska fixa screenshot-flödet så att den frysta vyn visar sidan i korrekt skala och inte tappas bort när bilden blir stor.

### Vad som verkar vara fel
- Servern tar en `fullPage`-screenshot och skickar hela bilden som en base64-data-URL i eventströmmen.
- Vyn renderar bilden med `aspect-ratio` baserat på hela sidans höjd och `object-contain`, vilket gör långa sidor extremt nedskalade.
- För stora sidor kan eventpayloaden bli så stor att screenshoten inte når klienten stabilt.

### Ändringar
1. **Ta viewport-screenshot istället för fullPage**
   - Ändra screenshot-capture till normal viewport-höjd, så bilden motsvarar det användaren faktiskt ser.
   - Behåll overlay-koordinater filtrerade till synlig viewport så markeringarna hamnar rätt.

2. **Fixa Frozen viewport-renderingen**
   - Visa screenshoten med fast viewport-aspekt och `object-cover`/naturlig fyllning i stället för att trycka ihop hela sidan.
   - Ta bort layouten som gör att långa screenshots krymper till en tunn remsa.

3. **Gör sparandet robustare**
   - Minska payloadstorleken genom att bara skicka viewport-bilden.
   - Behåll loggning när screenshot misslyckas, så UI kan visa tydligare “no snapshot captured” om det händer igen.

4. **Verifiering**
   - Köra flödet i preview med Teamtailor-URL:en.
   - Kontrollera att screenshoten syns i normal storlek efter körning och att den inte försvinner i den frysta vyn.