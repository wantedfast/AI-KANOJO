# AI-KANOJO v1.6 扁平胶囊 Design QA

## 验收基准

- 产品视觉基准：`assets/ui-concepts/07-spectrum-capsule.png` 与审计前实现 `design-qa/compact-spectrum-browser-idle.png`。
- 本轮明确约束：保留 2D 立绘与完整 8-bit 状态逻辑；胶囊改为扁平比例；工作态 8-bit 位于三个图标与 Codex 之间；右侧三点菜单只保留缩小和退出。
- 浏览器视口：1280×720 CSS px，1:1 像素密度。
- Electron 透明窗口：1040×620 CSS px，Windows 实际窗口。
- 同画布对照：`design-qa/v17/compare-idle.png`、`design-qa/v17/compare-listening.png`。

## 排版与视觉

- 胶囊实测为 520×88px、28px 圆角；相比审计前 520×108px 更扁平，仍保留深蓝玻璃、紫青光谱边缘和内部高光。
- 三个主功能图标、62px 运行角色席位、190×48px Codex 状态块、36×36px 三点按钮处于同一行，无分隔线、无裁切。
- 休眠图继续横卧于胶囊上沿。Listening/Thinking 等工作态渲染于独立席位上方，人物与功能图标、Codex 均不重叠。
- 2D Modern JK 立绘在会话唤醒后继续显示，状态资产仍使用原始透明 PNG 和 pixelated 渲染。
- 右侧三点菜单向上展开，只有缩小与退出两个图标；菜单高度约 87px，不遮挡主功能区。

## 功能与平台验证

- 组件测试覆盖：三个主功能入口、两项菜单、Escape/外部关闭、唱歌与换装反馈、缩小恢复、运行角色 DOM 顺序、Listening→Thinking 状态及 Codex Working。
- 浏览器控制台无 error/warn；Thinking 状态加载 `thinking.png` 并显示真实的 `Codex Working`。
- Electron 实测运行角色席位存在且顺序正确；角色与 Codex 几何相交为 `false`。
- Electron 向上拖动 64px 后最终位置保存为 `(184, -8)`，同一用户目录重启后恢复为 `(184, -8)`，误差 0px、无回弹。
- 缩小态为 112×44px，恢复后宽度为 520px；菜单位于鼠标命中区域，可正常点击。
- 退出按钮通过受限 preload API 发送固定 `app:quit` IPC，不暴露任意窗口控制能力。

## 对照发现与修复记录

1. [P1 fixed] 审计后控制项偏多。本轮将三点菜单收敛为“缩小、退出”两项。
2. [P1 fixed] 工作态 8-bit 曾压在 Codex 边缘。本轮增加 62px 独立席位，几何验证无重叠。
3. [P1 fixed] 520×108px 仍显厚重。本轮压缩为 520×88px 与 28px 圆角，层级更扁平。
4. [P2 fixed] 控件与角色耦合定位容易在状态切换时漂移。本轮由稳定 DOM 顺序和独立席位统一定位。
5. 当前无未解决 P0、P1 或 P2 问题。

final result: passed
