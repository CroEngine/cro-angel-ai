## Mål

Ta bort oanvända kontroller i `UrlBar` — de tar plats utan att göra något.

## Ändringar (`src/components/browser-shell/UrlBar.tsx`)

1. **Ta bort vänster ikon-grupp**: `ArrowLeft`, `ArrowRight`, `RotateCw` — alla `disabled`, har aldrig handlers.
2. **Ta bort "Frozen · click to resume"-pillen**: den klickbara chip-knappen är redundant — `Resume`-knappen till höger gör redan exakt samma sak. Behåll ändå statusvisning för `live`/`error`/`cold` genom att rendera chipen som en passiv `<span>` (ingen `onClick`, ingen hover-state).
   - Alternativ: ta bort chipen helt. Frågan nedan.
3. **Ta bort höger ikon-grupp**: `MousePointer2`, `Hand` — också `disabled` och oanvända (samma "inget av det används"-kategori).
4. **Städa imports**: ta bort `ArrowLeft`, `ArrowRight`, `RotateCw` (om inte används i Resume-knappen — den använder `RotateCw`, så behåll den), `MousePointer2`, `Hand`, `Snowflake` (om chipen tas bort helt).

## Inga andra filer rörs

`BrowserShell.tsx` skickar fortfarande samma props; vi tar bara bort renderingen.

## En fråga

För `frozen`-statusen: vill du

- **(a)** ta bort pillen helt (Resume-knappen visar redan tillståndet), eller
- **(b)** behålla en icke-klickbar status-pill ("Frozen") så man ser tillståndet även när Resume-knappen inte är i fokus?

Jag lutar åt **(a)** — minst kod, ingen dubblering.