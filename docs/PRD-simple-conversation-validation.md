# AI-KANOJO ElevenAgents 后端对话验证 PRD

> 版本：0.3
> 日期：2026-08-01
> 状态：待评审，不进入实施
> 范围：仅后端；不修改或约束当前前端设计
> 目标：为中、英、日三语自然对话提供可验证、安全、稳定的 ElevenAgents 后端能力

## Problem Statement

AI-KANOJO 需要使用 ElevenAgents 获得自然语音对话所需的实时转写、轮次判断、流式发声和用户打断能力，并继续使用 DeepSeek 负责回答内容。

当前项目虽然已经可以分别调用 Scribe、DeepSeek 和普通 Eleven v3 TTS，但这些独立调用不等同于 ElevenAgents 实时会话。现有后端也缺少以下基础能力：

- ElevenAgent ID 的安全配置与有效性检查。
- 固定模型和 Agent 配置的运行前校验。
- 为桌面客户端签发短期 conversation token 或 signed URL。
- 不向渲染进程暴露 ElevenLabs 长期 API Key。
- 明确、稳定、可测试的前后端会话契约。
- 对鉴权、模型配置、Agent 配置和会话创建失败进行安全归一化。

前端正在独立重做，因此本 PRD 不定义界面、按钮、布局、动画或交互细节。后端只提供新前端建立 ElevenAgents 会话所必需的能力。

## Solution

在 Electron 主进程建立 ElevenAgents 后端服务层。该服务层负责读取安全配置、验证 ElevenAgent、签发短期会话凭证，并通过受限 IPC 向未来前端提供最小能力。

ElevenAgent 在 ElevenLabs 平台中配置以下链路：

```text
客户端音频或文字
→ ElevenAgents
   ├─ Scribe v2 Realtime
   ├─ Turn-taking / Interruption
   ├─ Custom LLM → DeepSeek V4 Flash
   └─ Eleven v3 Conversational
→ 客户端事件与音频
```

本阶段不加入罗照月人格、女友身份、关系记忆或角色背景，只保留语言跟随和简短口语等基础通信规则。

### 固定后端配置

- Agent 平台：ElevenAgents
- LLM 类型：Custom LLM
- DeepSeek 模型：`deepseek-v4-flash`
- DeepSeek 模式：非 thinking
- 语音识别：Scribe v2 Realtime
- TTS：`eleven_v3_conversational`
- Turn eagerness：Normal
- Interruption：Enabled
- 支持语言：中文、英文、日语
- LLM fallback：Disabled
- TTS fallback：Disabled

任何固定模型或关键 Agent 配置不一致时，后端必须报告“配置不匹配”，不能静默使用其他模型。

### 当前最小路由护栏

当前验证阶段不向 DeepSeek 注入 system prompt，DeepSeek 只接收用户与助手历史。ElevenAgent 只保留三项协议护栏：中英日同语回复、语言变化时静默调用 `language_detection`、不输出工具名/参数/语言代码/内部推理或路由说明。不得包含人格、关系、回答长度、格式或口语风格要求。角色性格与设定将在后续独立设计后接入。

### Agent 配置来源

本阶段采用一个预先创建的验证 Agent。其 Agent ID 进入应用安全配置，DeepSeek Key 作为 ElevenLabs Custom LLM Secret 存储在 ElevenLabs 平台。

运行时 Electron 后端需要：

- ElevenLabs API Key，用于读取 Agent 配置和签发短期会话凭证。
- ElevenAgent ID，用于指定验证 Agent。

运行时 Electron 后端不需要把 DeepSeek Key发送给渲染进程。现有本地 DeepSeek Key可以保留供旧链路或诊断使用，但 ElevenAgents 正式验证链路不得从渲染进程读取它。

### 安全存储

- ElevenLabs API Key 继续使用 Electron `safeStorage` 加密保存。
- Agent ID 可以进入应用设置，但不能作为用户消息或模型提示词的一部分。
- DeepSeek Key 存放在 ElevenLabs Secret 中，不写入仓库、日志或 Agent prompt。
- 首次配置必须先验证 ElevenLabs Key 和 Agent ID 的组合有效，再原子保存新配置。
- 更新 Agent ID失败时保留最后一份可用配置。

### Agent 配置校验

后端提供显式配置校验能力，验证：

- Agent 存在且当前 Key有访问权限。
- LLM 类型为 Custom LLM。
- Model ID 为 `deepseek-v4-flash`。
- TTS 为 `eleven_v3_conversational`。
- 语音识别和轮次设置符合本 PRD。
- 用户打断已启用。
- 未启用模型自动降级。
- Voice 已配置且可供该 Agent 使用。

校验结果只返回布尔状态、稳定错误代码和安全说明，不返回 ElevenLabs 原始配置中的 Secret、header 或敏感字段。

### 后端服务契约

#### 读取就绪状态

输入：无。

输出：

```text
configured
elevenlabsKeyConfigured
agentIdConfigured
agentConfigVerified
expectedModels
issues[]
```

`expectedModels` 只返回固定公开模型 ID；`issues` 使用安全错误代码与可读说明。

#### 校验 Agent

输入：可选 Agent ID；为空时校验当前保存配置。

行为：

- 使用主进程中的 ElevenLabs Key查询 Agent。
- 校验固定模型、Voice、轮次和 interruption 配置。
- 不创建会话。
- 不修改云端 Agent。

输出：校验是否通过，以及不匹配项。

#### 保存 Agent ID

输入：Agent ID。

行为：

- 严格校验格式。
- 调用 Agent 校验。
- 只有校验完全成功时才原子保存。
- 不接受渲染进程传入模型 ID、Server URL、API Key或 fallback 设置。

#### 创建实时会话凭证

输入：

```text
requestId
```

行为：

- 确认 Key、Agent ID 和固定配置可用。
- 进行并发控制和短时限流。
- 向 ElevenLabs 请求 conversation token 或 signed URL。
- 返回供 ElevenAgents 客户端 SDK 建立单次会话的短期凭证。

输出：

```text
requestId
connectionType
conversationToken 或 signedUrl
```

不得同时返回两种凭证。长期 ElevenLabs API Key永远不出主进程。

#### 取消待处理请求

输入：`requestId`。

行为：取消仍在进行的配置校验或凭证请求，并忽略迟到响应。

### IPC 安全边界

预加载层只暴露白名单方法，不提供通用网络请求、任意 IPC channel 或 Secret 读取能力。

渲染进程允许获得：

- 非敏感就绪状态。
- Agent 配置校验结果。
- 单次短期 conversation token 或 signed URL。
- 稳定错误代码和安全错误说明。

渲染进程禁止获得：

- ElevenLabs API Key。
- DeepSeek API Key。
- ElevenLabs Secret。
- Authorization header。
- `safeStorage` 密文。
- 未过滤的供应商响应体或堆栈。

### 并发与生命周期

- 同一时间只允许一个有效的会话凭证创建请求。
- 相同 `requestId` 必须幂等或明确拒绝重复请求。
- 旧请求取消后，其迟到响应不得覆盖当前状态。
- 应用退出时取消未完成的凭证请求。
- 短期凭证只能用于建立一次会话，不写入持久化设置或日志。
- 后端不持有麦克风、扬声器或 WebRTC 媒体轨道；这些资源由未来前端的 ElevenAgents SDK 会话管理。

### 错误模型

后端至少提供以下稳定错误类型：

- `ELEVENLABS_KEY_MISSING`
- `ELEVENLABS_AUTH_FAILED`
- `AGENT_ID_MISSING`
- `AGENT_ID_INVALID`
- `AGENT_NOT_FOUND`
- `AGENT_ACCESS_DENIED`
- `AGENT_CONFIG_MISMATCH`
- `VOICE_NOT_CONFIGURED`
- `DEEPSEEK_MODEL_MISMATCH`
- `TTS_MODEL_MISMATCH`
- `TURN_CONFIG_MISMATCH`
- `SESSION_TOKEN_FAILED`
- `PROVIDER_RATE_LIMITED`
- `PROVIDER_UNAVAILABLE`
- `REQUEST_CANCELLED`
- `REQUEST_CONFLICT`

供应商原始错误只允许在主进程内部用于诊断。日志不得包含 Key、token、signed URL、Secret 或完整响应体。

## User Stories

1. 作为前端开发者，我希望读取后端就绪状态，以便决定何时允许用户开始对话。
2. 作为前端开发者，我希望获取短期会话凭证，以便安全建立 ElevenAgents 会话。
3. 作为前端开发者，我希望收到稳定错误代码，以便独立设计错误界面。
4. 作为前端开发者，我希望后端契约不绑定当前 UI，以便重做前端时不受旧组件限制。
5. 作为用户，我希望长期 API Key不进入界面进程，以降低密钥泄露风险。
6. 作为用户，我希望固定使用指定的 DeepSeek 和 ElevenLabs 模型，以避免实际效果被降级模型改变。
7. 作为用户，我希望中文输入得到中文回答，以进行自然中文对话。
8. 作为用户，我希望英文输入得到英文回答，以进行自然英文对话。
9. 作为用户，我希望日语输入得到日语回答，以进行自然日语对话。
10. 作为用户，我希望系统能够自然判断轮次和处理打断，以获得实时对话体验。
11. 作为开发者，我希望 Agent 配置不正确时在创建会话前失败，以避免进入行为不可预测的会话。
12. 作为开发者，我希望保存 Agent ID前完成远端校验，以避免持久化无效配置。
13. 作为开发者，我希望取消旧请求后忽略迟到结果，以避免前端收到过期 token。
14. 作为开发者，我希望相同请求不会创建多个短期凭证，以避免并发会话和费用异常。
15. 作为测试人员，我希望可以在不启动当前 UI 的情况下测试配置与凭证服务，以便后端独立验收。
16. 作为测试人员，我希望能够检测模型配置漂移，以避免云端 Agent 被手工修改后静默改变行为。
17. 作为运维人员，我希望日志能定位失败阶段但不包含 Secret，以便安全诊断。
18. 作为产品负责人，我希望先验证不注入自定义提示词的会话后端，以便把实时架构问题与后续角色设定分开。

## Implementation Decisions

- 本 PRD 只允许修改 Electron 主进程、预加载白名单、共享后端契约、配置存储和后端测试；不修改 `src/` 中的前端代码。
- ElevenAgents 是实时会话编排层；DeepSeek 继续作为 Custom LLM负责回答内容。
- 固定模型为 `deepseek-v4-flash`、Scribe v2 Realtime 和 `eleven_v3_conversational`，不允许渲染进程覆盖。
- 本阶段不从应用自动创建或修改云端 Agent；Agent 预先在 ElevenLabs 配置，应用只读校验。
- ElevenLabs 长期 Key只存在于主进程安全存储。
- DeepSeek Key作为 ElevenLabs Secret 管理，不通过本项目 IPC 传递。
- 主进程负责签发短期会话凭证；未来前端负责使用 ElevenAgents SDK 建立 WebRTC 或 WebSocket 会话。
- 优先使用 conversation token 与 WebRTC；如实际账户或 SDK限制需要 WebSocket，则使用 signed URL，但单次请求只能返回一种连接方式。
- 配置校验、凭证签发和错误归一化使用独立 Provider/Service 边界，避免把 ElevenLabs HTTP 细节写入 IPC handler。
- IPC 请求只接受 `requestId` 和必要公开字段，不接受 Key、模型 ID、Server URL 或 prompt。
- 无人格语言规则配置在云端验证 Agent 中，后端读取并校验其版本或标识，不在每次 IPC 请求中接受任意 prompt。
- 旧的 Scribe、DeepSeek 和普通 Eleven v3 Provider可以暂时保留，但 ElevenAgents 验证路径不得自动回退到旧链路。

## Testing Decisions

测试只覆盖后端可观察行为和安全边界，不依赖当前前端组件。

### 配置存储测试

- Agent ID格式校验。
- 有效 Agent ID验证成功后原子保存。
- 无效 Agent ID不覆盖最后可用配置。
- 旧配置加载时兼容缺少 Agent ID。
- 日志、异常和返回值不包含明文 Key或 token。

### Agent 配置校验测试

- 正确的固定模型、Voice、轮次和打断配置通过。
- Custom LLM类型不正确时失败。
- DeepSeek 模型不是 `deepseek-v4-flash` 时失败。
- TTS 不是 `eleven_v3_conversational` 时失败。
- Voice 缺失、打断关闭或 fallback 开启时失败。
- 供应商响应中的敏感字段被过滤。

### 会话凭证测试

- 配置完整时返回单次短期凭证。
- 长期 ElevenLabs Key不进入返回值。
- 相同请求不会重复创建凭证。
- 并发请求得到明确冲突或安全复用结果。
- 取消后忽略迟到响应。
- 鉴权失败、限流和不可用错误被正确归一化。
- token 和 signed URL不写入持久化存储或日志。

### IPC 合约测试

- 只允许白名单方法和字段。
- 渲染进程传入 Key、模型或 Server URL 时被拒绝或忽略。
- 非法 `requestId`、超长 Agent ID和畸形输入被拒绝。
- 返回错误对象只包含稳定代码、安全说明和必要上下文。

### 后端集成验收

使用真实 ElevenLabs Key和真实验证 Agent完成：

1. 读取并验证 Agent 固定配置。
2. 成功签发一次 conversation token 或 signed URL。
3. 使用短期凭证完成 ElevenAgents 连接握手并收到初始化元数据。
4. 确认长期 ElevenLabs Key和 DeepSeek Key未出现在渲染侧返回值与日志中。
5. 临时使用错误 Agent ID验证错误可定位且不会破坏已保存配置。

完整的麦克风、三语转写、声音播放和打断验收需要未来前端接入 ElevenAgents SDK 后执行，不作为纯后端交付阻塞项。

### 完成标准

- 后端配置、校验、凭证和 IPC 测试全部通过。
- 真实 Agent 配置校验通过。
- 真实短期凭证签发与会话握手成功。
- 固定模型配置漂移时明确失败，不发生降级。
- 长期 Key、DeepSeek Secret 和短期凭证不进入日志或持久化状态。
- 完整 `npm test`、`npm run build`、`npm run test:sites` 和 Electron smoke check 通过，且不要求修改当前前端。

## Out of Scope

- `src/` 中的任何前端实现或修改。
- 聊天面板、按钮行为、布局、动效、字幕和错误视觉设计。
- 麦克风采集、扬声器播放、WebRTC 媒体轨道和前端 SDK 生命周期。
- 罗照月人格、女友身份、角色背景和情绪设定。
- 长期记忆、关系发展、用户画像和向量检索。
- 自动创建、发布或修改 ElevenLabs 云端 Agent。
- 多 Agent、多 Voice 和运行时换声。
- DeepSeek thinking 模式。
- 模型选择器或自动降级。
- 唱歌、换装、Live2D 和嘴型同步。
- Agent 工具调用、知识库和业务工作流。

## Further Notes

- ElevenAgents 负责自然轮次、实时发声和 interruption；DeepSeek 负责回答内容，两者职责不冲突。
- 当前阶段不加入人格，只保留三语静默路由护栏；不通过 prompt 约束回答风格或长度。
- 纯后端可以验收 Agent 配置、Secret 边界、凭证签发和连接握手；真实麦克风对话必须等新前端消费该契约后才能完成端到端验收。
- 本 PRD 不对正在重做的前端提出结构或视觉要求。
- 本 PRD 评审通过后再拆分后端实施任务；在此之前不修改运行代码。
