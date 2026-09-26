// Every number that drives pace and difficulty, in one place.
// The simulator (`npm run sim`) can override any of them without touching code:
//   BAL='{"shadowMul":1.2,"frog":{"bites":22}}' npm run sim
// Tune here, re-run the sim, then commit the values.

export const BAL = {
  // ---------------------------------------------------------------- pace
  /** multiplies every biome's length (biomes.ts `height`) */
  lenMul: 1,
  /** per-biome length in world units (swarm cruises at ~150–200 u/s) */
  biomeLen: [21000, 18000, 24000, 15000, 24000],
  /** fly top speed range (u/s); the swarm moves at roughly the mean */
  flySpeed: [175, 260] as [number, number],
  /** the Shadow: per-biome base + ramp (u/s) from biomes.ts, times this */
  shadowMul: 1,
  /** gap (u) behind the swarm after which the Shadow speeds up to catch up */
  shadowLeash: 1250,
  shadowCatchUp: 1.2,
  /** chance per second that a fly inside the Shadow goes out */
  shadowKill: 2.8,

  // ---------------------------------------------------------------- economy
  startFlies: 200,
  startBlask: 60,
  maxFlies: 800,
  /** Blask per second */
  regen: 1.0,
  flashCost: 35,
  perfectCost: 10,
  lanternBlask: 40,
  /** units between lanterns [min, max] (the first comes around 1.7–2k) */
  lanternGap: [2100, 2600] as [number, number],
  /** sleeping larvae per biome in total (clusters are scaled to hit it, so every level gives the same) */
  larvae: [130, 60, 60, 60, 90],
  /** larvae cluster size multiplier (all biomes) */
  larvaMul: 0.26,
  /** extra larvae when the swarm is small: [below N flies, multiplier] */
  mercy: [[40, 1.5]] as [number, number][],
  /** flies carried into the next biome at least */
  carryMin: 1,

  // ---------------------------------------------------------------- hazards
  /** predator bite caps scale with sqrt(swarm / biteRef), clamped to biteScale */
  biteRef: 160,
  biteScale: [0.85, 1.5] as [number, number],
  web: { catch: 0.35, cap: 26, capRamp: 14, starve: 5 },
  bat: { bites: 6, speed: 300, speedRamp: 90, warn: 1.1, interval: 2.4 },
  frog: { range: 300, bites: 9, cool: 2.0, aim: 0.85 },
  dragonfly: { bites: 5, aim: 0.55, interval: 3.2, dash: 880 },
  owl: { bites: 24, warn: 1.35 },
  moth: { bites: 9.5, speed: 260, interval: 1.3, eatEvery: 0.3 },
  rain: { calm: 4, pour: 20, pourTime: 4.5, pourRamp: 2.5, calmTime: 7 },
  gust: { strength: 420, ramp: 260 },
  /** threat pieces per biome, spread evenly over its length (fillers go between) */
  threats: {
    sciolka: { web: 3, webField: 2, bats: 3, squeeze: 2 } as Record<string, number>,
    staw: { frogs: 5, dragonflies: 3, webs: 1 } as Record<string, number>,
    korony: { owl: 4, gusts: 3, bats: 3, webs: 1, squeeze: 1 } as Record<string, number>,
    burza: { bats: 2, gusts: 3, webs: 1, squeeze: 2 } as Record<string, number>,
    niebo: { moths: 6, currents: 3 } as Record<string, number>,
  },
  /** zone intervals shrink by this much (s) at the end of a biome */
  zoneRamp: 1.3,
};

export type Bal = typeof BAL;

/** Deep-merge overrides (from the sim) into BAL. */
export function tuneBal(over: Record<string, unknown>, into: Record<string, unknown> = BAL as unknown as Record<string, unknown>) {
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof into[k] === 'object') tuneBal(v as Record<string, unknown>, into[k] as Record<string, unknown>);
    else into[k] = v;
  }
}
