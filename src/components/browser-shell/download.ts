/** Ladda ner ett objekt som pretty-printad JSON-fil via ett temporärt
 *  <a download>-element — delas av panelerna i browser-skalet (fanns i tre
 *  identiska kopior före sajt-genomgången 2026-07-18). */
export function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
