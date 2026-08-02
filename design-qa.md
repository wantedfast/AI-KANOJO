# AI-KANOJO conversation surfaces — design QA

## Scope

- Frontend-only text chat panel and compact voice conversation popover.
- Existing capsule is a protected surface: its geometry, feature controls, 8-bit slot, Codex block, traffic lights, drag behavior, and minimized state were not redesigned.
- The large 2D portrait is intentionally absent. The existing 160px 8-bit character remains the sole character representation.

## Visual sources

- Text chat target: `C:\Users\wangf\.codex\generated_images\019fbd9d-2a05-7da2-9c82-7c0235152752\exec-4ccd7c2a-6b0c-4bde-a107-e6ef7735e038.png`
- Voice target: `C:\Users\wangf\.codex\generated_images\019fbd9d-2a05-7da2-9c82-7c0235152752\exec-bb471696-a6de-410e-9913-c610c54d8e19.png`
- Implemented text surface: `design-qa/frontend-chat-window.png`
- Implemented voice states: `design-qa/electron-awake.png`, `design-qa/electron-working.png`
- Voice comparison: `design-qa/conversation-voice-comparison.png`
- Focused voice comparison: `design-qa/conversation-voice-focused-comparison.png`

## Environment and states

- Runtime: Electron transparent desktop window, 1040×620 CSS window; smoke captures are 1280×720 at the active Windows display scale.
- Text state: formal desktop runtime without an injected backend adapter, showing the intentional unconfigured message.
- Voice states: listening and speaking, driven by the controllable frontend preview adapter.
- Browser navigation to the local preview was unavailable after the controlled in-app tab entered its browser error page; QA therefore used the product's actual Electron runtime and renderer tests.

## Comparison review

### Pass 1

- P1 layout issue: the first voice popover anchor crossed the active 8-bit character slot.
- Fix: moved the new surface farther left while keeping the capsule DOM and styles untouched.
- P1 viewport issue: the text panel's fixed content row could clip its composer on a scaled Windows viewport.
- Fix: constrained panel height to the available viewport and changed its body to a shrinking grid row, keeping the composer visible without resizing Electron.

### Pass 2

- Typography: compact system typography, restrained weights, and short conversational copy match the selected direction.
- Layout: both surfaces sit outside and above/left of the capsule; the voice popover clears the 8-bit slot and Codex block.
- Color and material: neutral graphite-blue glass, low-intensity violet/pink accents, thin cool borders, and restrained shadow match the target without introducing a game-HUD glow.
- Assets: Phosphor icons are used for all new controls; no fake SVG, emoji, CSS art, or placeholder character asset was introduced.
- Text chat: header, online status, recent history region, empty/error states, composer, Enter send, and Shift+Enter newline are implemented.
- Voice: one live phase, one user transcript, one Luo Zhaoyue reply, continue-listening hint, pause/resume, and end controls are implemented.
- Capsule preservation: Electron smoke evidence reports a 520px rail, a 160px avatar long edge, correct icon → avatar → Codex order, no avatar/Codex overlap, two vertical traffic-light controls, and a 160×44 minimized rail.
- Accepted source difference: generated references include a decorative background, a different rail, and—in the text concept—a large portrait. Those elements are deliberately excluded because the user's frozen capsule and no-portrait decisions are authoritative.

## Interaction and quality checks

- Renderer tests: 36/36 passed, including text/voice mutual exclusion, injected phases, pause/resume/end, late-event handling, keyboard submission, visible errors, Escape close, no 2D portrait, and existing rail behavior.
- Build: `npm run build` passed and produced the Sites-ready output.
- Sites worker: `npm run test:sites` passed (4/4).
- Electron: the complete visual/movement smoke passed before the latest CSS-only viewport constraint; a later rerun was blocked by a concurrently changed main-process single-instance startup path, outside this frontend-only scope. The renderer and production build remain green.
- No renderer console error was observed in the successful Electron smoke/capture pass.

final result: passed
