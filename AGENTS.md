# Prototype Instructions

## Current flat capsule override (v1.6)

- Keep the visible capsule at `520×88px` with a 28px radius. The rail must read as a flat glass bar, not a stadium pill.
- Preserve the three primary icon-only features and the compact Codex block.
- The active 8-bit state avatar has a dedicated 62px slot between the three feature icons and Codex. It must never overlap Codex; idle sleep art remains centered on the upper edge.
- The ellipsis menu contains exactly two actions: minimize the companion and quit the application. Captions, pause/resume, and end-session are not menu items.
- Keep the existing 8-bit state mapping and animations, 2D Modern JK portrait, dragging, position persistence, minimized mode, provider interfaces, singing entry, and wardrobe entry.
- `docs/PRD.md` v1.6 is authoritative.

## Current compact spectrum override (v1.5)

- The persistent spectrum capsule is `520×108px`; this supersedes the 840×146 Electron size in v1.4 while retaining the same single-layer navy, violet-left/cyan-right visual language.
- The sleeping avatar is roughly 160px wide and rests on the capsule edge.
- Remove neutral black/gray exterior rail shadows in desktop runtime. Only restrained colored side glows and inner highlights remain.
- The right utility area exposes one vertical-ellipsis trigger. Its upward icon-only menu contains captions, pause/resume, end session, and minimize in that order.
- The menu closes on toggle, outside pointer, Escape, or action; it must be included in Electron hit regions. Idle disables the first three actions while minimize remains available.
- Preserve manual dragging, upward movement, exact position persistence/relaunch restore, and the 112×44 minimized state.
- `docs/PRD.md` v1.5 is authoritative.

## Current spectrum capsule override (v1.4)

- `assets/ui-concepts/07-spectrum-capsule.png` is the single source of truth for the persistent companion visual. It supersedes Gallery 02 and every 520px/two-tier rule below.
- Reproduce the reference as one 1280×223 spectrum-glass capsule on a 1584×1024 QA canvas, scaled proportionally to 840×146 in the Electron window.
- Keep the sleeping pixel character centered on the capsule edge at roughly 350px wide in the native QA canvas. Do not wake her merely because the app is open.
- The control order is: violet microphone, cyan music, pink wardrobe; centered Codex pill; CC, pause/resume, end, minimize.
- Use a purple left edge, cyan right edge, deep navy glass, restrained edge sweep, and soft floor reflection. There is no top status strip, no internal separators, and no persistent text around the three primary icons.
- Preserve real state switching, drag/persistence, upward movement, transparent hit testing, and the 112×44 minimized state.
- `docs/PRD.md` v1.4 is authoritative. Older prototype directions remain only as history.

## Current compact capsule override (v1.3)

- The persistent control is a compact 520px two-tier desktop glass capsule derived from `assets/ui-concepts/02-desktop-pet.png`, with a low profile, 18px corners, horizontal menu-bar density, and the 8-bit avatar resting on its upper edge. This supersedes earlier ultra-wide width guidance.
- The capsule uses a restrained React Bits Star Border-inspired dual-edge sweep: soft blue/violet radial light travels slowly along the top and bottom borders. Do not use a noisy Electric Border canvas, large neon bloom, or fast motion; respect reduced-motion preferences.
- Electron must hold a single-instance lock. A second launch focuses the existing transparent window instead of creating another overlapping companion.
- Window movement uses restricted renderer pointer start/end events plus main-process polling of the global cursor. The whole capsule except real controls is a `no-drag` hit surface. This avoids Windows' inconsistent native dragging for tall transparent frameless windows.
- Vertical bounds are based on the visible capsule rather than the full 620px transparent portrait canvas. The transparent top may extend off-screen while the capsule stays visible, so upward movement from `y=0` remains possible.
- During native window movement, suspend transparent click-through changes until 320ms after the final move event; then persist the final bounds once. This prevents Windows drag cancellation and snap-back.
- The right utility group includes a minimize control. It collapses the visual companion to a 112×44px draggable glass rail with the 8-bit avatar, state light, and an explicit expand button.
- `docs/PRD.md` version 1.3 is the visual and product source of truth.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Locked AI-KANOJO prototype direction

- The product is a voice-first desktop girlfriend; Codex is only a secondary Working indicator.
- The persistent control must reproduce `assets/ui-concepts/02-desktop-pet.png`: an ultra-wide, low-profile, two-tier desktop glass bar with 14–18px corner radii, thin borders, horizontal menu-bar density, restrained highlights, and the 8-bit avatar resting on its upper edge. The previous short, thick, large-radius capsule is retired.
- The lower rail uses three icon-only controls for girlfriend state, singing, and wardrobe, followed by a wider Gallery 02-style Codex status pill. Do not restore text-heavy feature tiles or separators between icons.
- The 8-bit avatar changes with idle, listening, thinking, speaking, completed, or error. Horizontal sleep art rests on the upper edge; seated state art uses per-state seat anchors so the hips and support hand touch the edge while the legs overlap the rail.
- Active view keeps one static Modern JK half-body PNG on the left with a slight rail overlap. No Live2D or expression set in the first version.
- The rail keeps CC, pause/resume listening, and end-session as compact utility controls on its right. Captions are off by default and show only the current line.
- Codex appears after the three icon controls and exposes Ready or blue Generating. Match the reference anatomy: green status dot, Codex label, short state text, and five compact blue level bars. No task details or logs.
- Sing and wardrobe are clickable future-feature placeholders that show short coming-soon feedback and do not call backend APIs.
- Use Gallery 02 cold blue-gray/graphite glass with system typography and minimal shadow. The three functional icons use restrained violet, cyan, and pink neon color; Codex Working remains cool blue.
- Window dragging uses the generous upper hit surface plus the restricted preload drag IPC. While dragging, pause transparent click-through switching; persist the exact final bounds on drag end and restore them on relaunch. The fixed transparent window must leave real movement room on the desktop.
- Transparent-area click-through must be controlled from the Electron main process using globally tracked cursor position and renderer-published hit regions; do not depend on renderer `mousemove` to recover after `setIgnoreMouseEvents(true)`.
- The companion, portrait, capsule, pixel mascot, and Codex pill move as one unit. Smart-collapse the UI in fullscreen contexts.
- `docs/PRD.md` version 1.1 is the visual and product source of truth for the next implementation pass.
