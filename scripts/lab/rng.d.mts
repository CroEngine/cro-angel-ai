// Typdeklaration för den handskrivna rng.mjs — labbets deterministiska PRNG.
// Filnamnet är BÄRANDE: under moduleResolution "Bundler" mappas en
// ./rng.mjs-specificerare bara mot .mts/.d.mts, aldrig mot .d.ts.
//
// Källan är .mjs med avsikt (run-lab.mjs kör under node), så den kan inte
// bara bli .ts. En typad tvilling av samma algoritm finns i scripts/sim-rng.ts
// — konsolidering är ett EGET ärende med egen runtime-ekvivalensbörda, inte
// något att smyga in i en typkolls-fix.
export declare function mulberry32(seed: number): () => number;
