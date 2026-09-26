# Rój — notes for agents

Browser game (phone portrait first, laptop too): guide a swarm of fireflies up through a dark forest. Vite + TypeScript, raw WebGL2, no engine, no image/audio assets (everything procedural/synthesized). Design doc: `docs/PLAN.md` (Polish). Deployed to GitHub Pages from `dist/` by `.github/workflows/pages.yml`.

## Commands

```bash
npm run dev          # vite --host
npx tsc --noEmit     # typecheck after every change
npm run build        # typecheck + static build
npm run sim          # headless balance report (see "Balance")
```

Dev helper: `window.__roj = { game, renderer }` (e.g. `__roj.game.swarm`, `__roj.game.level.webs`).

## World and code map

- World units, **y up**. Playfield is ~600 wide (`HALF_W = 300`), the renderer fits 600×1100 units into the screen (`PLAY_W/PLAY_H`). Camera x is always 0; on wide screens the parallax forest fills the sides.
- `src/game/biomes.ts` — the 5 biomes of a run (Ściółka, Staw, Korony, Burza, Nad chmurami): palette, wall/backdrop style, moon/stars/aurora, wind, rain, Shadow speed, length.
- `src/game/level.ts` — generic level container: walls, silhouette shapes, entities (larvae, lanterns, webs, frogs, owls, zones, gusts, pads), builder helpers (`branch`, `bigLeaf`, `mushroomCluster`…), baked collision **SDF** (`sdfAt`). Use `L.rng`, never `Math.random()`, so a seed reproduces the level.
- `src/game/gen/*.ts` — one generator per biome built from weighted "pieces" via `sequence()` in `shared.ts` (lantern every ~2.3k units, `force` to introduce a threat early).
- `src/game/hazards.ts` — frogs (aim line → tongue), dragonflies (hover → aim → dash ×3), owls (eyes open → bezier swoop; flash while eyes are open blinds it), gusts, rain waves + lightning, moths (drawn to lit star lanterns). `flashHazards` is what a Rozbłysk does to them.
- `src/game/swarm.ts` — fireflies in typed arrays; steering via personal orbiting offsets + **flow field** (`flow.ts`, Dijkstra on a 16-unit grid around the swarm) so the swarm pours around obstacles; SDF collision; Kuramoto phase coupling (`order`, `psi`) drives synchronized blinking and the perfect flash.
- `src/game/game.ts` — rules for one biome: Shadow (Cień), webs, bats, larvae, lanterns, flash, revive, scoring, events for UI/audio. A run is a chain of `Game`s: `game.next()` returns the `Carry` (flies, Blask, score, height, revive) for the next biome; the last biome ends with `formConstellation()` (swarm `formOn` targets), saved to `roj.sky.v1`.
- Testing: `#b3` in the URL starts a run at biome 3.
- `src/game/meta.ts` — everything that outlives a run: `Mods` (numbers the rules read) built by `computeMods(species, night, mutations)`; `SPECIES` (4, unlocks in `speciesUnlocked`), `NIGHTS` (1–10, cumulative, score ×1.15 per night), `MUTATIONS` (pick 1 of 3 between biomes, offer seeded by run seed), meta save `roj.meta.v1`, run save `roj.run.v1` (resume at the last lit lantern via `Game.snapshot()` / `restoreAt()`), sky `roj.sky.v1`, daily seed from the date. New rule knob → add it to `Mods` and read `g.mods.x`, don't hardcode.
- `src/game/input.ts` — absolute: the target follows the pointer's screen position, re-projected every frame (camera moves); touch aims 46 px above the finger. Second finger / double tap = flash; double click / space = flash.
- `src/render/renderer.ts` — pipeline: occluders (¼ res) → swarm light (¼) → shadowed light + shafts (¼) → scene (bg, 3 parallax layers from `backdrop.ts`, playfield silhouettes, dynamic silhouettes, additive sprites, haze, Shadow) → bloom → composite (shockwave, CA, ACES, grain). Shaders in `shaders.ts`; silhouette geometry in `mesh.ts` (vertices carry pseudo-normal + edge for rim light).
- `src/audio/audio.ts` — all sounds synthesized (WebAudio), bells in D minor pentatonic.
- `src/ui/ui.ts` + `src/style.css` — DOM HUD, hints (shown once, stored in `roj.hints.v1`), menu/pause/end screens. Player-facing text is Polish; code and comments English.

## Balance

All pace/difficulty numbers live in `src/game/balance.ts` (`BAL`): biome lengths, fly speed, Shadow, economy (Blask, flash cost, larvae, mercy), and per-hazard knobs. Don't hardcode new numbers in rules — add a knob.

`npm run sim` plays whole runs headless with `src/sim/bot.ts` (a player model; `skill` 0..1 scales reaction time, noticing threats, flash timing) on all CPU cores and prints: win / game-over rate, delivered swarm %, per-biome time, deaths, flies in→out, losses by cause, and a skill-band breakdown.

```bash
npm run sim -- --runs 480                       # mixed skill 0.35–0.85 (the default)
npm run sim -- --runs 96 --biome 2 --skill 0.9  # one biome, fresh swarm
BAL='{"shadowMul":1.1,"frog":{"bites":15}}' npm run sim   # try knobs without editing
```

Targets (first pass, met by the bot mix): 2–3 min per biome (2:07–2:17), ~10% game over (10.8%, falling with skill), 30–45% of the starting swarm delivered (32%), finishing with ≥ the starting swarm rare (3.5%), finishing without losses ~never (0%). Real play is logged to `roj.stats.v1`; `#stats` in the URL shows it in the same shape as the sim, to recalibrate the bot against a human.

What moves what: biome length (`biomeLen`) and fly speed set time; bite caps (`bat/frog/dragonfly/owl/moth.bites`, scaled by `biteScale`), `web.catch`, `rain.pour` set attrition; `carryMin`, `mercy`, `biteScale[0]` decide whether a weakened swarm can still die (game-over rate); `larvae`/`larvaMul` set gains; `threats` fixes how many of each threat a level has. Runs are reproducible per seed (the sim seeds `Math.random`). If the bot gets stuck somewhere, it's usually a level trap or a flow-field bug, not balance — trace one seed before tuning.

## Offline / PWA

`public/manifest.webmanifest` + icons from `node scripts/icons.mjs`. `dist/sw.js` is generated at build time by the plugin in `vite.config.ts` from `src/sw.template.js` (precaches every built file except unused font subsets; cache name = content hash, old caches are dropped). Registered only in production builds.

## Rules that bite

- Colors in shaders are **linear**; the composite tone-maps and applies gamma. Dark scene colors are tiny numbers (0.005–0.03) on purpose.
- GLSL `pow(x, y)` is undefined for `x < 0` and returns NaN on Mali/Adreno (desktop GPUs hide it): square with `q * q`. Any NaN/Inf in an HDR target turns into flickering black blocks once bloom spreads it; `safe()` in `shaders.ts` scrubs light, bloom and composite inputs, and `spr()` drops non-finite sprites.
- Hidden screens must not catch taps: `.screen` uses `visibility: hidden` when not `.show`.
- Performance target: 60 fps on a mid phone. Renderer lowers `quality` automatically; fireflies contribute light at ¼ res and every 2nd fly above 420.
- Browser pane mobile emulation shows black bands at the right/bottom edge in screenshots; it's the pane, not the game.

## Verifying

Typecheck, build, then look at it in the browser at 375×812 and in a wide window. Commit messages are in Polish.
