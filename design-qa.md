# AI-KANOJO 紧凑流光胶囊 Design QA

## v1.5 紧凑光谱胶囊与三点菜单结论

### Evidence and normalization

- Source truth: 用户问题截图 `C:/Users/wangf/AppData/Local/Temp/codex-clipboard-c2413e4e-d5d2-4910-9ecc-08d76732b03f.png`、旧按钮特写 `C:/Users/wangf/AppData/Local/Temp/codex-clipboard-02a08036-fde6-4456-b6ff-c2349b8c0f7c.png`，以及确认的 520×108 改版方案。
- Same-size reference: `design-qa/browser-compact-flow-idle.png`；implementation: `design-qa/compact-spectrum-browser-idle.png`。
- Browser viewport and density: 1280×720 CSS px，截图均为 1280×720 像素，1:1 density；state 为休眠/菜单关闭。
- Full-view comparison: `design-qa/compact-spectrum-v15-comparison.png`，左右均使用相同画布和状态。
- Focused evidence: `design-qa/compact-spectrum-browser-menu.png` 验证四项竖排菜单；`design-qa/electron-menu.png` 验证实际透明窗口菜单无裁切；`design-qa/compact-spectrum-electron-white.png` 将 Electron 透明截图合成到白底，检查外缘阴影。

### Required fidelity surfaces

- Typography: 保持系统/SF 字体栈；Codex 缩至 15px 主标签与 11px 状态文字，未出现截断。
- Spacing/layout: 实测 rail 520×108、sleep avatar 160×64.7、Codex 200×52；三主图标、Codex 与单一 `⋮` 在一行内无挤压。
- Colors/tokens: 外缘仅包含紫色 `-5px` 和青色 `+5px` 光晕及内部高光；计算样式不存在黑色或灰色外投影。白底合成中旧版整条灰色暗影已消失。
- Image quality: 继续使用原始透明 8-bit PNG，pixelated 渲染，无拉伸、裁切或替代素材。
- Copy/content: 常驻界面没有新增文字；菜单为纯图标，通过 aria-label 和悬停提示提供字幕、暂停、结束、缩小含义。

### Interaction and platform verification

- Browser：点击 `⋮` 后得到四个 menuitem；休眠时前三项禁用、缩小可用；缩小实测 112×44 并可恢复至 520×108；控制台无 error/warn。
- Component tests：覆盖菜单默认关闭、四项结构、Escape、点击外部、字幕、暂停/继续、结束、缩小与恢复。
- Electron：菜单实际尺寸约 48×167，主进程命中区域包含菜单中心；向上移动 64px 后最终坐标精确保存，同一用户目录重启后误差 0px。
- Electron 缩小态为 112×44，恢复宽度为 520px；菜单和人物均未超出 1040×620 透明窗口。

### Comparison history and findings

1. [P1 fixed] 840×146 在 Windows 缩放下显得接近 1260px。恢复为 520×108，人物同步恢复约 160px。
2. [P1 fixed] 黑色外投影在白色应用窗口上形成整条灰色暗边。移除中性外投影，仅保留紫青侧缘光和内部高光。
3. [P1 fixed] CC、暂停、结束和缩小四枚按钮持续占据右侧空间。改为单一竖向三点触发器和向上展开的四图标菜单。
4. [P2 fixed] 透明窗口可能穿透弹出菜单。preload 命中选择器加入 `.utility-menu`，Electron smoke 已验证 `hitTracked: true`。
5. 当前无未解决 P0、P1 或 P2。P3：禁用图标保持可见以解释菜单结构，后续可根据用户反馈进一步降低透明度。

## v1.4 光谱长胶囊复刻结论

- 当前唯一基准：`assets/ui-concepts/07-spectrum-capsule.png`（1584×1024）。
- 同画布实现：`design-qa/spectrum-browser-pass2.png`；并排对照：`design-qa/spectrum-capsule-comparison.png`。
- 实际 Electron 透明窗：`design-qa/electron-idle.png`、`design-qa/electron-awake.png`、`design-qa/electron-working.png`。
- 几何测量：参考/实现胶囊均为约 1280×223，实施坐标 `x=152, y=442`；睡姿人物为约 350×142，底边贴合 `y=442`；Codex 为 395×84。
- 结构匹配：单层深蓝玻璃、紫色左缘、青色右缘、顶部居中睡姿、紫/青/粉三图标、Codex 状态块、`CC / 暂停 / 结束 / 缩小` 顺序均已对齐。
- 内容差异是产品约束而非视觉缺陷：无真实 Codex 任务时诚实显示 `Ready`，不会为了匹配静态概念图伪造 `Generating`。
- Electron 按同一比例缩放为 840×146；透明窗口截图中人物、胶囊和所有按钮均无裁切。
- 拖动回归通过：实际窗口完成 `x +64px / y -64px` 移动，松手保存为 `(240, -128)`，同一用户目录重启后精确恢复；向上拖动不会回弹。
- 缩小回归通过：展开态 840px，缩小态 112×44，并能恢复展开。
- P0/P1/P2：无未解决项。

## Evidence

- User problem capture: `C:/Users/wangf/AppData/Local/Temp/codex-clipboard-0f3b1fbb-1e95-472b-8143-bf00700eb8e2.png`.
- Layout source: `assets/ui-concepts/02-desktop-pet.png`.
- Motion reference: React Bits Star Border, implemented as two opposing radial-gradient edge sweeps rather than a Canvas electric-noise effect.
- Browser idle/working: `design-qa/browser-compact-flow-idle.png`, `design-qa/browser-compact-flow-working.png` at 1280 × 720 CSS pixels.
- Electron idle/active/working: `design-qa/electron-idle.png`, `design-qa/electron-awake.png`, `design-qa/electron-working.png` at 1040 × 620 on Windows.
- Same-canvas before/after comparison: `design-qa/compact-flow-comparison.png`.

## Findings

- No remaining P0, P1, or P2 findings.
- [P3] Speaking and Error continue to reuse the closest supplied seated runtime assets until dedicated art is delivered.
- [P3] The decorative sweep is intentionally subtle; screenshots capture only one phase of the continuous motion.

## Required fidelity surfaces

- Typography: system/SF-style stack, compact Codex label/state text, no visible labels under the three primary icons.
- Spacing and layout: 520px maximum rail width, 108px total height, 36/72px two-tier split, 18px radius, three 40px icon targets, a compact 180px Codex pill, and no separators.
- Colors and tokens: graphite-blue glass, fine cool border, violet/cyan/pink feature icons, green Codex presence, and blue working bars.
- Image quality: supplied transparent PNGs retain pixel rendering. One 8-bit state image is rendered at a time; sleeping and seated assets use separate edge anchors.
- Material and motion: layered translucent blue glass, fine inner highlights, controlled shadow, and slow low-opacity blue/violet light traveling along both edges. Reduced-motion disables the sweep.
- Copy/content: Codex honestly shows `Ready` or `Generating…`; singing and wardrobe still report “功能准备中” without fake playback or backend work.

## Interaction and platform verification

- Browser: idle and Working states render without clipping at 1280 × 720; the active state exposes the portrait, seated mascot, utilities, and animated Codex meter.
- Component tests assert three icon-only features, exactly one runtime avatar image, two flow layers, five Codex meter bars, placeholder feedback, and the wake/working transition.
- Electron acquires a single-instance lock. A duplicate launch exits and focuses the existing window instead of creating a second transparent companion.
- Electron smoke verifies the restricted manual-drag API, a 64px real window move, exact final-position persistence, and exact relaunch restoration.
- Post-regression native Windows input verification moved the actual visible window by 64px from the capsule surface, then restored the saved x/y coordinates exactly after a full restart. The complete capsule background is now native-drag, while all real buttons remain no-drag and clickable.
- `npm run verify` passed: 4 Vitest files/11 tests, production and Sites build, duplicate-instance/manual-drag/relaunch Electron smoke, and 4 Sites worker tests.

## Comparison history

1. [P0] Two transparent Electron processes produced overlapping 8-bit states. Added a main-process single-instance lock and a duplicate-launch smoke assertion. Post-fix: one companion window.
2. [P1] The previous rail was approximately twice the desired length. Reduced the visible rail to `min(520px, calc(100vw - 28px))` and compressed icons, Codex, and utility controls without removing functionality.
3. [P2] The flat surface lacked material hierarchy. Added restrained layered glass, inner edge highlights, and a React Bits Star Border-inspired bidirectional edge sweep.
4. [P2] A full Electric Border-style Canvas treatment was evaluated and rejected because continuous noisy electric distortion is too active for an always-on desktop companion. The CSS gradient solution is calmer and cheaper to render.

final result: passed
