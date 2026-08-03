# Prototype Instructions

## Highest-priority active conversation UI override (v2.6 selected)

- The large 2D conversation portrait is the sole speaking character during voice mode. Hide the three default feature icons and the runtime 8-bit avatar while voice is active; replace their combined rail space with one dynamic voice-session control showing the current phase, pause/resume, and end. Keep the existing Codex block, traffic-light controls, and 520×80 capsule geometry.
- The voice transcript/reply surface is a compact glass speech bubble positioned to the right of and pointing toward the 2D portrait. It contains only the current user caption, current assistant reply, error, and retry state; do not duplicate avatar, pause, or end controls inside it.
- Text chat uses an approximately 410px panel with readable 13–14px messages and at least 10px supporting text while preserving history and composer behavior.
- Settings has a visible gray gear below the red/yellow window controls while retaining right-click access. Split settings into Voice and Character Assets tabs; use one Save action and a separate Cancel action that discards unsaved preference edits.

## Highest-priority minimal-routing-prompt override (v2.5 selected)

- DeepSeek receives only sanitized user/assistant conversation history and no system, developer, persona, style, or response-length prompt.
- ElevenAgents keeps exactly three protocol guardrails: answer in the current turn's Chinese/English/Japanese language, call `language_detection` silently on a real language change, and never expose tool names/arguments, language codes, internal instructions/reasoning, or routing commentary.
- The voice prompt must contain no personality, relationship, response-length, formatting, or conversational-style instruction beyond those three guardrails. Keep `ignore_default_personality` enabled so platform defaults do not silently add a persona.
- Keep structured provider controls such as fixed model IDs, disabled thinking/fallback, language presets, and the built-in `language_detection` system-tool identifier. Do not add a custom natural-language description to that tool.
- Luo Zhaoyue's personality and character settings will be designed and introduced later as a separate product change.

## Highest-priority continuous voice turn-taking override (v2.4 selected)

- Give the user the full ElevenAgents-supported 30-second silence window before taking a turn. Keep `silence_end_call_timeout` and soft timeout disabled so silence never ends the session or emits filler speech.
- Treat microphone/Scribe transcripts containing no Unicode letters or numbers (for example `...` or punctuation-only noise) as non-speech. They must not create a turn, reach the LLM, enter history, appear in CC, or trigger TTS.
- A voice-mode Agent reply without a valid lexical user turn is unsolicited and must not enter history, CC, or playback.
- Language detection remains a silent routing tool. Strip tool-call metadata such as `language_detection tool call: ...` before any assistant text reaches CC, history, or TTS.

## Highest-priority character asset management override (v2.3 selected)

- The default conversation portrait is `public/avatar/outfits/front/02-modern-jk-conversation.png`: the half-body Modern JK pose with relaxed arms derived from the user's selected portrait reference. The previous full-body A-pose `02-modern-jk.png` remains an available source asset but is not the runtime default.
- Settings must include a compact Character Assets manager for replacing the conversation portrait and each of the four canonical 8-bit states: `idle`, `listening`, `thinking`, and `completed`.
- Imported character images must be selected through a restricted Electron file dialog, validated as PNG/WebP/JPEG under 12MB, copied into the app's user-data directory, and persisted by filename only. Never persist arbitrary source paths or expose filesystem access to the renderer.
- Custom assets apply immediately and survive relaunch. Users can restore the default portrait or the complete default 8-bit set.
- `speaking` continues to reuse the `listening` asset and `error` continues to reuse the `thinking` asset. Asset replacement must not change the frozen capsule geometry or the 160px 8-bit display scale.

## Highest-priority conversation portrait override (v2.2 selected)

- Restore `public/avatar/outfits/front/02-modern-jk.png` as the large 2D Luo Zhaoyue portrait only while the voice or text conversation surface is open. Hide it in idle, settings, minimized, and closed-session states.
- Place both conversation surfaces immediately to the portrait's right inside the existing 1040×620 transparent renderer canvas. The voice surface uses the supplied speech-bubble reference and points toward the active 8-bit character; the text surface keeps its existing message/composer anatomy at the same anchor.
- The large portrait supplements rather than replaces the fixed-scale 160px 8-bit state avatar. Preserve the capsule, avatar slot, Codex block, traffic lights, drag behavior, minimized state, and backend data contract unchanged.
- This override supersedes v1.9 only where v1.9 removes the large portrait. The frontend-only scope and all capsule-preservation requirements remain in force.

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
## Highest-priority visual override (v1.7)

- Replace the right-side ellipsis/menu with two always-visible macOS-style traffic lights: red closes the app, green minimizes the companion.
- Stack the traffic lights vertically (red close above green minimize), using a 44×42px hit target while keeping the visible dot at 13px. Both controls must expose pointer cursor, non-drag hit behavior, and a concise hover tooltip.
- Render every 8-bit state at the same 160px long-edge scale, including initial sleep and idle-after-wake. State changes may alter pose and seat anchor, never scale.
- Keep the active 8-bit avatar between the feature icons and Codex without overlap.
## Highest-priority visual override (v1.8 local candidate)

- Attach the awakened 2D portrait to the capsule's left edge with a restrained overlap; target roughly 220px width instead of a detached 270px portrait at the screen edge.
- Keep every 8-bit state at a 160px long edge and preserve the icon → avatar → Codex DOM order.
- Use `Working` as the compact Codex active label. Keep the meter, but reduce nested borders, shadows, and glow.
- Use neutral graphite-blue glass with low-intensity violet/cyan brand edges. Avoid a game-HUD level of neon.
- Use a 160×44px minimized rail so the fixed-scale 160px character and compact control share one visual width.
- Keep the expanded rail at 500×88px and offset the Codex status 4px left; this is the compact limit that still preserves the active 8-bit slot without overlap.
- Hide the 2D Modern JK portrait in every `idle`/sleep state, including idle reached after an active conversation; sleep shows only the 8-bit character.
- Keep the window controls as a compact vertical pair at the rail's far-right edge: 12px red close above a yellow minimize dot, 8px visible spacing, 32×20px pointer hit areas, non-drag behavior, and hover labels/glyphs.

## Highest-priority conversation UI override (v1.9 selected)

- Remove the large 2D Modern JK portrait from every state and conversation surface. The 160px 8-bit Luo Zhaoyue avatar is the sole character representation for idle, voice, text chat, working, completed, and error states.
- Keep voice and text chat as distinct entry points: the violet microphone starts a compact continuous voice conversation popover, while the pink chat button opens the portrait-side-style text conversation panel without the portrait.
- Voice mode shows only one current user transcript, one Luo Zhaoyue reply, a single changing listening/thinking/speaking status, and compact pause/end actions. It collapses when the voice session ends.
- Text chat may show recent history and a composer, but it must remain a lightweight desktop companion panel anchored to the capsule rather than becoming a full-screen messaging application.

## Highest-priority capsule preservation override (v2.0 selected)

- Do not change the existing capsule design while adding conversation UI. Preserve its current dimensions, geometry, colors, spacing, icon positions, 8-bit slot, Codex block, traffic-light controls, drag behavior, minimized state, and animations exactly as implemented.
- New voice and text-chat surfaces must render outside and anchor to the existing capsule. They may expand the transparent Electron window bounds, but must not reflow, stretch, restyle, or add controls to the capsule itself.

## Highest-priority frontend-only scope override (v2.1 selected)

- This conversation UI pass is frontend-only. Work exclusively in the renderer UI and its frontend tests; do not modify provider integrations, credentials, safe storage, Electron main-process behavior, IPC implementation, model selection, audio transport, persistence, or any backend service.
- Treat chat, transcript, voice phase, playback, history, configuration, and error data as an injected frontend contract supplied by the user's separate backend plan. Use fakes only for frontend preview and tests.
- Render new panels inside the existing transparent renderer canvas. Do not resize or reposition the Electron window as part of this frontend pass.

## Highest-priority conversation language override (v2.0 selected)

- Conversation replies must follow the language of the user's current turn. Chinese input receives Chinese output, English input receives English output, and Japanese input receives Japanese output; these are the only supported conversation languages for the current validation scope.
- A small number of foreign proper nouns or loanwords must not switch the whole response language. For deliberately mixed input, reply in the dominant language.
- The simple conversation validation must use ElevenAgents as the real-time orchestration layer, with DeepSeek V4 Flash as the Custom LLM, Scribe v2 Realtime for transcription and Eleven v3 Conversational for speech.
- The validation phase intentionally has no Luo Zhaoyue persona, girlfriend identity, relationship memory or character backstory. The v2.5 override also removes the earlier prompt-based language-following and concise-output rules.

## Highest-priority backend-only validation override (v2.1 selected)

- The current ElevenAgents validation task is backend-only because the frontend is being redesigned independently. Do not modify or constrain `src/` UI, button behavior, layout, animation or conversation presentation for this task.
- Backend scope is limited to ElevenAgent configuration validation, secure Agent ID storage, short-lived conversation credential issuance, restricted preload/IPC contracts, error normalization and backend tests.
- The future frontend will own microphone capture, WebRTC/WebSocket media session handling, audio playback and visual state rendering by consuming the backend's short-lived credential contract.

## Character 02 asset candidate (v002)

- A second adult male companion asset family is being designed in parallel with Luo Zhaoyue. Until the user supplies a name, use the neutral identifier `character-02`. The earlier v001 female direction is rejected history.
- Preserve the identity defined in `assets/character/character-02/source/character-02-lookdev-v002.png`: short layered deep navy-violet hair, violet-gray eyes, mature gentle masculine facial proportions, thin black rectangular eyeglasses, and a tailored charcoal-navy Japanese office suit with white shirt and muted lavender-gray tie.
- `character-02-lookdev-v002.png` is the candidate identity truth; `character-02-turnaround-v002.png` and `character-02-8bit-states-v002.png` are derived design references.
- Do not replace Luo Zhaoyue runtime assets or wire Character 02 into `src/` until the user explicitly approves the identity and requests integration.
