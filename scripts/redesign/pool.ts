// Fast-arbetarpool: kör `fn` över `items` med högst `concurrency` samtidigt,
// resultat i input-ordning. Delad av capture-test/scale-test/render-fidelity
// (var tre nästan identiska kopior). fn får (item, index) — index används av
// scale-test för framstegslogg; övriga anropare ignorerar det.
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}
