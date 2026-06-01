## Minimal fix

Bara två rader ändras. Inga nya states, ingen UI-logik.

### 1. `src/lib/tests/browserbase.server.ts` — skapa keepAlive-session
I `createSession()`, byt:
```
const session = await client.sessions.create({ projectId });
```
till:
```
const session = await client.sessions.create({ projectId, keepAlive: true, timeout: 300 });
```

### 2. Det var allt
- Vår CDP-WebSocket stänger efter load — det är OK, för med `keepAlive: true` river inte Browserbase ner browsern bara för att en kontrollanslutning kopplas ner. Live-vyn håller sig ansluten.
- Resten av flödet (Stop, hard timeout 5 min, error-pill) är redan korrekt.

### Verifiering
Run → iframe laddar och blir kvar. Stop → sessionen släpps. Klart.