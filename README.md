# AI-KANOJO

从零实现的 Windows 8-bit 桌面女友。

## 当前能力

- Electron 透明、无边框、置顶桌面窗口与系统托盘。
- 可拖动胶囊、位置锁定、窗口位置恢复和透明区域鼠标穿透策略。
- 正式会话使用 `listening → thinking → speaking → completed → listening` 连续状态流；暂停或结束后回到休眠。
- 无需 Key 的完整演示对话模式。
- DeepSeek V4 Flash 流式聊天接口与固定的罗照月人格。
- ElevenLabs Scribe v2 Realtime 单次令牌与实时 PCM 语音链路。
- ElevenLabs Eleven v3 语音合成；正式请求固定使用 `model_id: "eleven_v3"`。
- DeepSeek V4 Flash、Scribe v2 Realtime 与 Eleven v3 均为强制模型，不提供切换或静默降级。
- Electron `safeStorage` 保护凭据；渲染进程不接触明文 Key。
- 最近聊天、普通设置与窗口位置本地持久化。
- 详情、设置和服务诊断界面。

## 运行

要求 Node.js 20 或更高版本。

```powershell
npm install
npm run dev
```

浏览器预览默认开启演示模式。启动桌面应用：

```powershell
npm run desktop
```

`desktop` 会先生成生产构建，再启动 Electron。

## 配置真实服务

1. 首次启动会从桌面 `DS and ElevenLabs.txt` 按 `<密钥> <DS|ElevenLabs>` 格式一次性导入两项 Key；也可在设置中手动填写。
2. 在自动打开的设置页输入 ElevenLabs Voice ID。
3. 保存后点击麦克风开始连续对话。

凭据只在 Electron 中保存。普通浏览器预览不会保存或发送 Key。

正式接口依据：

- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion)
- [ElevenLabs Scribe Realtime](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime)
- [ElevenLabs Single Use Token](https://elevenlabs.io/docs/api-reference/tokens/create)
- [Eleven v3](https://elevenlabs.io/docs/help-center/product/speech-synthesis/text-to-speech/what-is-eleven-v3-alpha)

ElevenLabs 官方说明 Eleven v3 的延迟高于其对话型 Flash/Turbo 模型。本产品按 PRD 坚持使用 Eleven v3，不会静默切换成其他模型。

## 验证

```powershell
npm run verify
```

该命令依次执行语法检查、单元/集成测试、生产构建、真实 Electron 窗口烟测和 Sites 包装测试。Electron 烟测会验证置顶窗口、200 px 以上的位置变化、角色点击进入监听、主进程停止语音、托盘锁定状态同步，以及设置面板可打开。

真实麦克风、真实服务与桌面拖动/穿透仍需在目标 Windows 设备上进行发布前验收；自动化测试和演示模式不能替代这部分。

## 项目资料

- [产品需求](docs/PRD.md)
- [资产清单](assets/ASSET-CATALOG.md)
- [资产 Gallery](assets/gallery.html)
- [设计 QA](design-qa.md)
