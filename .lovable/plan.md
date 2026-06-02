Minska `trusted_by`-bruset i `src/lib/tests/scripts/trustSignals.ts`. Mål: bara äkta "X+ kunder/använd av/featured in"-claims rapporteras, inte hela innehållssektioner.

## Observerade problem (från teamtailor-audit)

- 18 `trusted_by`-träffar, varav ~2 äkta ("Används av 10 000+ företag")
- Långa contentblock klassas som trust ("Attrahera och konvertera..." 800 tecken)
- Samma claim rapporteras 3-4 ggr via parent/grandparent (`section`, `div:nth-of-type(8)`, `div:nth-of-type(2)`...)
- H2 "Så här tycker våra kunder 💖" matchar på `våra kunder` men är en testimonials-rubrik, inte trusted_by
- Stycken som "...med våra kunder varje månad" → falsk positiv

## Ändringar — endast `trusted_by`-flödet

### 1. Stramare regex (rad 10)

Före:
```js
trusted_by: /trusted by|used by|anv[äa]nds av|v[åa]ra kunder|featured in|som setts i|our clients/i,
```

Efter:
```js
trusted_by: /\\b(trusted by|used by|anv[äa]nds av|joined by|loved by|trusted globally by)\\s+[\\d\\w]|featured in|som setts i|as seen in/i,
```

- Kräver att "trusted by/used by/används av" följs av siffra eller ord (= en kvantifiering eller logo-grupp följer)
- Tar bort `våra kunder` och `our clients` — för generiska, matchar testimonial-rubriker
- Behåller `featured in / som setts i / as seen in` utan krav (de står oftast självständigt)

### 2. Kortare maxlängd för trusted_by-träffar

I textloopen (rad 188–198): efter regexmatch, om `type === 'trusted_by'` och `text.length > 160`, hoppa över. Riktiga "used by 10,000+ companies"-claims är korta. Långa textblobbar är aldrig äkta.

### 3. Stramare leaf-check

Rad 183–187: Lägg till `DIV`, `SECTION`, `ARTICLE` i listan av barn som diskvalificerar leaf. Då slipper vi att stora wrappers (`div:nth-of-type(8)`, `section:nth-of-type(1)`) också får trust-träffar utöver det inre stycket.

### 4. Parent-dedup för trusted_by

I `push()` (eller efter loopen): för `trusted_by` specifikt, om en redan tillagd post har samma `text` och `block` är en ancestor till den nya — eller tvärtom — behåll bara den med minst `visualWeight` (= det smala stycket, inte hela sektionen).

Implementation: efter textloopen, filtrera `out`:
```js
out = out.filter((a, i) => {
  if (a.type !== 'trusted_by') return true;
  return !out.some((b, j) =>
    j !== i && b.type === 'trusted_by' && b.text === a.text && b.visualWeight < a.visualWeight
  );
});
```

## Inte i scope

- `customer_logos`-dubbletter, `stars`-rating-exponering, `org_number`-postnummerfilter — separata steg.
- Övriga PATTERNS-kategorier rörs inte.

## Verifiering

Manuell genomgång av audit-JSON efter ändring:
- Förväntat: ~2 `trusted_by`-träffar för teamtailor (de äkta "Används av 10 000+")
- "Så här tycker våra kunder 💖" ska INTE bli trusted_by
- Långa contentblock ("Attrahera och konvertera...") ska INTE bli trusted_by
- Inga regressioner i andra typer (testimonial, stars, customer_logos, contact_info, org_number ska kvarstå som idag)