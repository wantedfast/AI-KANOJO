# AI-KANOJO 角色立绘与资产管理 — Design QA

## 目标与证据

- Source visual truth：`C:\Users\wangf\AppData\Local\Temp\codex-clipboard-adc3f988-65d6-4c8e-943c-f86c2cf4b929.png`，233×604px。目标是黑发高髻、细框眼镜、JK 制服、自然垂臂的半身立绘。
- Default production asset：`public/avatar/outfits/front/02-modern-jk-conversation.png`，679×1637px RGBA。
- Browser implementation：`design-qa/conversation-portrait-v23-browser-final.jpg`，1280×720px，浏览器 CSS viewport 1280×720、device scale 1。
- Electron conversation implementation：`design-qa/electron-smoke-user-data/17492-1785660268530/electron-awake.png`，1560×930px；Electron CSS viewport 1040×620、Windows device scale 1.5。
- Electron asset manager implementation：`design-qa/electron-smoke-user-data/17492-1785660268530/electron-smoke.png`，1560×930px；同一 1040×620 CSS viewport。
- Focused portrait comparison：`design-qa/character-portrait-v23-comparison.png`。参考与 Electron 实现均按角色可见区域归一化后并排比较。

## Findings

- 无剩余 P0/P1/P2 问题。
- [P3] 新默认图由低分辨率合成截图重建，面部线条与原参考存在细微差异；发型、眼镜、制服、色彩、姿态和整体身份语言一致。原始透明立绘不可用，资产管理允许用户在获得原图后无损替换，因此不阻塞本轮验收。

## Comparison history

1. P1：运行时默认使用 `02-modern-jk.png` 全身 A-pose，与参考的自然垂臂半身立绘明显不符。
   - Fix：根据参考重建独立高分辨率立绘，改为 `02-modern-jk-conversation.png`，旧 A-pose 文件保留但不再作为默认运行资产。
2. P2：第一版色键透明化在黑发边缘留下绿色溢色。
   - Fix：收紧绿色优势阈值、进行边缘去溢色并清零全透明像素 RGB；深色背景复核无可见绿边。
3. P2：400px 立绘容器裁掉参考中可见的双手。
   - Fix：桌面立绘容器提高到 450px，并将图片底部偏移从 -130px 调整为 -80px；最终 Electron 图中双手在胶囊上方可见。

## Required fidelity surfaces

- Fonts/typography：沿用现有系统字体与设置页层级；`VOICE & CHARACTER`、标题、说明和操作文本权重清晰，未引入新字体漂移。
- Spacing/layout rhythm：会话立绘仍为 220px 宽，贴近胶囊左端；语音框、8-bit、Codex 和交通灯未发生重排。设置资产区使用两栏卡片，1040×620 下内部滚动且胶囊持续可见。
- Colors/tokens：资产管理沿用 graphite-blue 玻璃、低强度紫色和现有金色 eyebrow；没有新增高强度 HUD 光效。
- Image quality：默认立绘为透明 RGBA，无背景矩形、绿边或拉伸；8-bit 预览使用 `image-rendering: pixelated`，运行时仍保持 160px 长边。
- Copy/content：明确区分“会话立绘”和四个 8-bit 状态；显示格式/大小限制、替换、恢复默认及右键胶囊入口。

## Interaction and security checks

- 右键胶囊或托盘“打开设置”可进入资产管理；胶囊没有新增可见控件。
- 立绘、休眠、倾听、思考、完成共 5 个替换入口可用；自定义立绘和整套 8-bit 均可恢复默认。
- Electron 文件对话框仅允许 PNG/WebP/JPEG；单张最大 12MB；文件复制至 `userData/character-assets`；状态只保存受控文件名，渲染进程不获得任意本地路径。
- 自定义资源通过 data URL 注入 renderer，立即生效并随 state.json 重启恢复。
- Browser 语音入口、最终状态和资源加载已验证；console error：0。
- `npm test`：12 个文件、72 项测试通过。
- `npm run build`：通过。
- `npm run test:sites`：4/4 通过。
- `npm run test:electron`：通过；实测立绘 naturalWidth 679、显示宽 220px，8-bit 长边 160px，资产管理可见且 5 个替换入口存在。

## Implementation checklist

- [x] 修正默认半身立绘。
- [x] 增加立绘与四状态 8-bit 管理。
- [x] 安全导入、持久化与恢复默认。
- [x] 右键胶囊入口与托盘入口。
- [x] 浏览器、Electron、测试、构建和 Sites 验证。

final result: passed
