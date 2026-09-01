// Naturhöjdsmätningen för scenen (stardream-fyndet 2026-09-01): app-skal
// (Ionic/Angular m.fl.) bor i absolut positionerade behållare låsta till
// viewporthöjden — documentElement.scrollHeight rapporterar exakt 844 hur
// högt innehållet än är, och scenen fastnade i en oskrollbar 100svh-ram.
// Regeln: litar på roten när den redan bär innehållet (klart högre än
// frysviewporten); annars är sidan skal-låst och trädets största
// scrollHeight är innehållets sanna höjd. När ramen sedan sätts till den
// höjden växer skalets 100%-kedjor ut till den — layouten löser sig själv,
// och en ommätning konvergerar (procent expanderar TILL ramen, aldrig förbi;
// vh-enheter är redan px-neutraliserade i ?stage=1, så ingen jaktloop).
//
// Strukturella typer (locate.ts-mönstret) så mätningen vitest-testas utan DOM.

export interface SizedElement {
  scrollHeight: number;
  clientWidth: number;
}

export interface SizedDocument {
  documentElement: SizedElement | null;
  body: (SizedElement & { querySelectorAll(selectors: string): ArrayLike<SizedElement> }) | null;
}

/** Frysviewporten är 844 — en rot som når 1.5× den bär uppenbart sitt eget
 *  innehåll och trädskanningen (dyr på stora DOM:ar) behövs inte. */
const ROOT_TRUST_MIN = 1266;

/** Minsta bredd för att räknas som innehållsbärare — smala remsor (dolda
 *  paneler, skrollister, dekor) får inte diktera scenens höjd. */
const MIN_CONTENT_WIDTH = 250;

export function measureDocHeight(doc: SizedDocument): number {
  const root = doc.documentElement?.scrollHeight ?? 0;
  if (root >= ROOT_TRUST_MIN) return root;
  let max = root;
  const els = doc.body?.querySelectorAll("*");
  if (els) {
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (el.clientWidth >= MIN_CONTENT_WIDTH && el.scrollHeight > max) max = el.scrollHeight;
    }
  }
  return max;
}
