# AI-KANOJO v1.7 苹果交通灯与等尺度 8-bit Design QA

## v1.7 验收结果

- 右侧窗口控制已从三点菜单改为两个常驻交通灯：关闭为 `rgb(255, 95, 87)`，缩小为 `rgb(40, 200, 64)`。
- 两个圆点竖向排列，红色在上、绿色在下；视觉直径为 13px，各自拥有 44×42px 点击区域。按钮使用 pointer 光标、明确的非拖动命中区，并在悬停时显示功能提示。
- Electron 实测两个按钮的计算光标均为 `pointer`，`data-tooltip` 与原生 `title` 均分别为“关闭程序”和“缩小悬浮窗”；命中区已进入透明窗口的交互区域。
- Apple 审美审查：控件满足清晰、克制、渐进提示和系统字体原则。红/绿语义及竖排方式是用户指定的产品变体，与标准 macOS 红/黄/绿横排存在刻意差异，不作为缺陷。
- 初始休眠角色实测长边为 160px；Listening 角色长边为 160px；唤醒后再次休眠的角色长边为 159.99px，视觉尺度误差小于 0.01px。
- Listening 角色为 80.61×160px，继续位于三个功能图标和 Codex 之间；与 Codex 几何相交为 `false`。
- Electron 截图证据：`design-qa/electron-awake.png`、`design-qa/electron-menu.png`；结构数据：`design-qa/electron-smoke.json`。
- `npm run verify` 通过：13 项组件/服务/资产测试、Electron 拖动与重启恢复、4 项 Sites 测试均无失败。
- 当前无未解决 P0、P1 或 P2 问题。

---

## v1.6 历史验收

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
