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
- `src/game/level.ts` — biome generation from seeded "pieces" (`pieceBranches`, `pieceSqueeze`, `pieceWeb`, `pieceWebField`, `pieceShelves`, `pieceBats`, `pieceLarvae`, `pieceLantern`, `pieceEnd`), walls, entities, baked collision **SDF** (`sdfAt`). Use `this.rng`, never `Math.random()`, so a seed reproduces the level.
- `src/game/swarm.ts` — fireflies in typed arrays; steering via personal orbiting offsets + **flow field** (`flow.ts`, Dijkstra on a 16-unit grid around the swarm) so the swarm pours around obstacles; SDF collision; Kuramoto phase coupling (`order`, `psi`) drives synchronized blinking and the perfect flash.
- `src/game/game.ts` — rules: Shadow (Cień) rising from below, webs, bats + warnings, larvae, lanterns, flash, revive, scoring, events for UI/audio.
- `src/game/input.ts` — touch = relative drag, second finger / double tap = flash; mouse = hold to lead, double click = flash; space/arrows.
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
