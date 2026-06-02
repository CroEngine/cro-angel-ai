## Mål

Aktivera Browserbase residential proxies så att fler sites (t.ex. personio.com med Cloudflare-challenge) kan auditeras.

## Ändring

En rad i `src/lib/tests/browserbase.server.ts`, rad 22:

```ts
const session = await client.sessions.create({
  projectId,
  keepAlive: true,
  timeout: 16 * 60,
  proxies: true,  // ← residential proxies, hjälper mot Cloudflare/anti-bot
});
```

Inget annat ändras. SDK-typerna i `@browserbasehq/sdk` stöder fältet direkt.

## Konsekvenser

- **Kostnad:** Proxies debiteras per GB bandbredd (utöver session-minuter). För audit-runs är payload liten (~några MB per sida) så marginell kostnad per run, men det är inte gratis.
- **Latens:** Residential proxies adderar ~200–1000 ms per request. Audits blir lite långsammare.
- **Geografi:** Default är US residential exit. Om vi vill ha specifik geo (EU för GDPR-sites) kan det konfigureras senare via `proxies: [{ type: 'browserbase', geolocation: { country: 'SE' } }]`.

## Inte i scope

- Advanced Stealth (kräver Scale plan, separat beslut)
- Per-run opt-in flagga för proxies (kan läggas till senare om kostnaden blir ett problem)
- Geo-targeting

## Verifiering

Kör test mot:
1. `talentium.io` — ska fortsätta funka (baseline)
2. `teamtailor.com/sv` — ska fortsätta visa customer_logos-regressionen (oförändrat beteende vad gäller dedup-buggen)
3. `personio.com` — förhoppningsvis tar sig förbi Cloudflare nu; annars rapporterar vi att stealth också behövs

## Filer som ändras

- `src/lib/tests/browserbase.server.ts` (en rad)
