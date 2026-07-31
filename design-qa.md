# AI-KANOJO v1.8 Apple UI 审计整改 Design QA

## 验收结论

- 审计基线：`design-audit/apple-ui-2026-08-01/audit.md` 及其四张状态截图。
- 实现证据：`design-qa/v18/01-idle.png`、`02-awake.png`、`03-working.png`、`04-minimized.png`。
- 同画布对照：`design-qa/v18/compare-awake.png`、`compare-working.png`、`compare-minimized.png`；左右分别为整改前与整改后，视口均为 1280×720 CSS px。
- Electron 实机证据：`design-qa/electron-idle.png`、`electron-awake.png`、`electron-working.png`；结构数据见 `design-qa/electron-smoke.json`。

## 审计问题关闭情况

1. [P1 fixed] 2D Modern JK 由 270px 缩至 220px，并移动到胶囊左缘形成约 15px 的视觉搭接；不再以独立大立绘抢占主焦点。
2. [P1 fixed] Codex 活动态文案改为 `Working`，浏览器与 Electron 均完整显示，无截断。
3. [P1 fixed] 缩小态宽度由 112px 调整为 160px，与所有运行状态 8-bit 角色的固定 160px 长边一致；唤醒、再次休眠和最小化均无尺寸跳变。
4. [P2 fixed] 主胶囊改为低饱和石墨玻璃，削弱嵌套边框、图标光晕、Codex 阴影和流光峰值；窗口控制收敛为最右侧竖向红/黄双点。
5. [P2 fixed] 2D 立绘、8-bit 状态、三个一级功能、Codex 状态以及关闭/缩小功能全部保留。

## 自动验证

- `npm run verify`：13 项组件/服务/资产测试、Electron 拖动与位置恢复、4 项 Sites 测试全部通过。
- Electron 向上拖动 64px 后保存为 `(184, -8)`，同一测试用户目录重启后恢复为 `(184, -8)`，误差 0px。
- Electron 中 8-bit 长边为 160px；工作态角色与 Codex 几何相交为 `false`；缩小态为 160×44px，恢复后为 520px。
- 窗口控制实测为竖向排列：可见圆点 12px、间距 8px、紧靠胶囊右边缘；红色关闭与黄色缩小均保持 pointer 光标、非拖动命中及悬停提示。
- 展开态宽度收紧为 500px，Codex 左移 4px；保留 160px 运行角色槽位，并由 Electron 几何测试确认角色与 Codex 不相交。
- 当前无未解决 P0、P1 或 P2 视觉问题。

final result: passed
