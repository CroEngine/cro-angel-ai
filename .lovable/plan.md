Ta bort de två badge-overlayerna i `src/components/browser-shell/Viewport.tsx`:

1. Live-badge (rad 46–48): tas bort helt.
2. Frozen-badge (rad 93–96): tas bort helt.

`Snowflake`-importen behålls (används fortfarande i no-snapshot-fallbacken på rad 61). Inga andra ändringar.