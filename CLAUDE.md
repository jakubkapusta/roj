# Rój — notes for agents

Browser game (phone portrait first, laptop too): guide a swarm of fireflies up through a dark forest. Vite + TypeScript, raw WebGL2, no engine, no image/audio assets (everything procedural/synthesized). Design doc: `docs/PLAN.md` (Polish). Deployed to GitHub Pages from `dist/` by `.github/workflows/pages.yml`.

## Commands

```bash
npm run dev          # vite --host
npx tsc --noEmit     # typecheck after every change
npm run build        # typecheck + static build
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
- `src/game/input.ts` — absolute: the target follows the pointer's screen position, re-projected every frame (camera moves); touch aims 46 px above the finger. Second finger / double tap = flash; double click / space = flash.
- `src/render/renderer.ts` — pipeline: occluders (¼ res) → swarm light (¼) → shadowed light + shafts (¼) → scene (bg, 3 parallax layers from `backdrop.ts`, playfield silhouettes, dynamic silhouettes, additive sprites, haze, Shadow) → bloom → composite (shockwave, CA, ACES, grain). Shaders in `shaders.ts`; silhouette geometry in `mesh.ts` (vertices carry pseudo-normal + edge for rim light).
- `src/audio/audio.ts` — all sounds synthesized (WebAudio), bells in D minor pentatonic.
- `src/ui/ui.ts` + `src/style.css` — DOM HUD, hints (shown once, stored in `roj.hints.v1`), menu/pause/end screens. Player-facing text is Polish; code and comments English.

## Rules that bite

- Colors in shaders are **linear**; the composite tone-maps and applies gamma. Dark scene colors are tiny numbers (0.005–0.03) on purpose.
- Hidden screens must not catch taps: `.screen` uses `visibility: hidden` when not `.show`.
- Performance target: 60 fps on a mid phone. Renderer lowers `quality` automatically; fireflies contribute light at ¼ res and every 2nd fly above 420.
- Browser pane mobile emulation shows black bands at the right/bottom edge in screenshots; it's the pane, not the game.

## Verifying

Typecheck, build, then look at it in the browser at 375×812 and in a wide window. Commit messages are in Polish.
