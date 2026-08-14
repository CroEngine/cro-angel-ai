// A/B-ytans etiketter och svarskortets rubrikval som REN LOGIK (UI-buggjaktens
// fynd 2026-08-14). Bakgrund: sajtens testMetric styr vad abTest.*.conversions
// FAKTISKT räknar — dashboard.functions.ts fyller fältet med CONTINUATIONS när
// test_metric='continuation' och exponerar VariantAbView.metric just därför.
// Overview hårdkodade ändå "Conversions"/"Conv. rate" och "convert more/less",
// så continuation-tal visades under conversion-rubriker. Här bor översättningen
// metric ⇒ etiketter/copy och rubrikreglerna — testbara utan DOM.

export type AbMetric = "conversion" | "continuation";

export interface AbMetricLabels {
  /** Kolumnrubrik för andelen i armtabellen. */
  rateLabel: string;
  /** Kolumnrubrik för räknaren — continuation-läget delar formulering med
   *  metricTableRows ("Continued (2nd page)") så tabellerna talar samma språk. */
  countLabel: string;
  /** Verbet i svarskortets mening: "Adapted visitors <verb> more …". */
  verb: string;
  /** Måttets namn i fallback-fotnoten "Judged on <judgedOn> only; …". */
  judgedOn: string;
}

export function abMetricLabels(metric: AbMetric | null | undefined): AbMetricLabels {
  if (metric === "continuation") {
    return {
      rateLabel: "Continuation rate",
      countLabel: "Continued (2nd page)",
      verb: "continue to a second page",
      judgedOn: "continuation (reaching a second page)",
    };
  }
  return {
    rateLabel: "Conv. rate",
    countLabel: "Conversions",
    verb: "convert",
    judgedOn: "conversions",
  };
}

export type MeasuredVerdict = "win" | "loss" | "no_effect" | "inconclusive";

export interface MeasuredHeadline {
  title: string;
  body: string;
  /** true bara när matten faktiskt kallat en vinst — styr det gröna firandet. */
  celebrate: boolean;
}

/** Svarskortets rubrik för state="measured". Tre ärliga regler:
 *  - bara verdict "win" får fira ("Yes — …") — en osignifikant +20% är ingen
 *    vinst hur grön den än ser ut (fil-kontraktet: inga tal vi inte försvarar);
 *  - liftRel === null (kontrollarmen 0 konverteringar ⇒ relativ lyft
 *    odefinierad) får en egen mening i stället för ett tomt kort;
 *  - loss/no_effect säger det rakt ut. Okänt/inconclusive-domslut firar
 *    aldrig — det faller i den försiktiga grenen. */
export function measuredHeadline(
  verdict: MeasuredVerdict | undefined,
  liftRel: number | null,
  metric: AbMetric | null | undefined,
): MeasuredHeadline {
  const { verb } = abMetricLabels(metric);
  if (verdict !== "win" && verdict !== "loss") {
    return {
      title: "No proven effect yet",
      body: `Adapted and control visitors ${verb} at rates the math can't tell apart yet — no lift is claimed either way.`,
      celebrate: false,
    };
  }
  if (liftRel === null) {
    // Kontrollarmen konverterade aldrig: diff/hRate är odefinierat, men själva
    // skillnaden kan vara statistiskt verklig — säg det i stället för tomhet.
    if (verdict === "win") {
      return {
        title:
          metric === "continuation"
            ? "Yes — adapted continues, control didn't"
            : "Yes — adapted converts, control didn't",
        body: `Adapted visitors ${verb}; the held-back control group recorded none, so a relative lift percent is undefined — but the difference itself is statistically real.`,
        celebrate: true,
      };
    }
    return {
      title: "Not yet",
      body: `Adapted visitors ${verb} less than the held-back control group.`,
      celebrate: false,
    };
  }
  const pctStr = `${liftRel > 0 ? "+" : ""}${(liftRel * 100).toFixed(0)}%`;
  if (verdict === "win") {
    return {
      title: `Yes — ${pctStr} lift`,
      body: `Adapted visitors ${verb} more than the held-back control group.`,
      celebrate: true,
    };
  }
  return {
    title: `Not yet — ${pctStr}`,
    body: `Adapted visitors ${verb} less than the held-back control group.`,
    celebrate: false,
  };
}
