import {
  ELEVENAGENTS_ERROR_CODES as CODES,
  ELEVENAGENTS_EXPECTED_CONFIG as EXPECTED,
  ELEVENAGENTS_BASE_PROMPT,
  ELEVENAGENTS_LANGUAGE_DETECTION_TOOL,
  ElevenAgentsBackendError,
  isValidAgentId,
  isValidVoiceId,
  normalizeAgentId,
  normalizeVoiceId,
} from "../shared/elevenagents-contracts.js";

const API_BASE = "https://api.elevenlabs.io";

const providerError = (status, operation) => {
  if (status === 401) return new ElevenAgentsBackendError(CODES.ELEVENLABS_AUTH_FAILED, "ElevenLabs API Key 无效或已失效。");
  if (status === 403) return new ElevenAgentsBackendError(CODES.AGENT_ACCESS_DENIED, "当前 ElevenLabs Key 无权访问该 Agent。");
  if (status === 404 && operation === "agent") return new ElevenAgentsBackendError(CODES.AGENT_NOT_FOUND, "未找到指定的 ElevenAgent。");
  if (status === 404 && operation === "voice") return new ElevenAgentsBackendError(CODES.VOICE_NOT_FOUND, "未找到该 ElevenLabs 音色，或当前账号无权使用。");
  if (status === 429) return new ElevenAgentsBackendError(CODES.PROVIDER_RATE_LIMITED, "ElevenLabs 请求过于频繁，请稍后重试。");
  if (status >= 500) return new ElevenAgentsBackendError(CODES.PROVIDER_UNAVAILABLE, "ElevenLabs 服务暂时不可用，请稍后重试。");
  const code = operation === "token" ? CODES.SESSION_TOKEN_FAILED : CODES.PROVIDER_UNAVAILABLE;
  if (operation === "update-agent") return new ElevenAgentsBackendError(CODES.PROVIDER_UNAVAILABLE, "无法更新 ElevenAgent 配置。");
  return new ElevenAgentsBackendError(code, operation === "token" ? "无法创建 ElevenAgents 会话凭证。" : "无法读取 ElevenAgent 配置。");
};

const requestJson = async ({ url, apiKey, signal, fetchImpl, operation }) => {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { "xi-api-key": apiKey, Accept: "application/json" },
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new ElevenAgentsBackendError(CODES.REQUEST_CANCELLED, "请求已取消。");
    throw new ElevenAgentsBackendError(CODES.PROVIDER_UNAVAILABLE, "ElevenLabs 服务暂时不可用，请稍后重试。");
  }
  if (!response.ok) throw providerError(response.status, operation);
  try {
    return await response.json();
  } catch {
    throw new ElevenAgentsBackendError(operation === "token" ? CODES.SESSION_TOKEN_FAILED : CODES.PROVIDER_UNAVAILABLE, "ElevenLabs 返回了无法解析的响应。");
  }
};

export const getElevenAgent = async ({ apiKey, agentId, branchId = "", signal, fetchImpl = fetch }) => {
  const normalized = normalizeAgentId(agentId);
  if (!isValidAgentId(normalized)) throw new ElevenAgentsBackendError(CODES.AGENT_ID_INVALID, "ElevenAgent ID 格式无效。");
  const url = new URL(`${API_BASE}/v1/convai/agents/${encodeURIComponent(normalized)}`);
  if (branchId) url.searchParams.set("branch_id", String(branchId));
  return requestJson({
    url: url.toString(),
    apiKey,
    signal,
    fetchImpl,
    operation: "agent",
  });
};

export const getElevenVoice = async ({ apiKey, voiceId, signal, fetchImpl = fetch }) => {
  const normalized = normalizeVoiceId(voiceId);
  if (!isValidVoiceId(normalized)) throw new ElevenAgentsBackendError(CODES.VOICE_ID_INVALID, "ElevenLabs Voice ID 格式无效。");
  return requestJson({
    url: `${API_BASE}/v1/voices/${encodeURIComponent(normalized)}`,
    apiKey,
    signal,
    fetchImpl,
    operation: "voice",
  });
};

export const listElevenVoices = async ({ apiKey, signal, fetchImpl = fetch }) => {
  const voices = new Map();
  let nextPageToken = "";
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`${API_BASE}/v2/voices`);
    url.searchParams.set("page_size", "100");
    url.searchParams.set("sort", "name");
    url.searchParams.set("sort_direction", "asc");
    url.searchParams.set("voice_type", "personal");
    url.searchParams.set("include_total_count", "false");
    if (nextPageToken) url.searchParams.set("next_page_token", nextPageToken);
    const payload = await requestJson({ url: url.toString(), apiKey, signal, fetchImpl, operation: "voice-list" });
    for (const voice of Array.isArray(payload?.voices) ? payload.voices : []) {
      const voiceId = normalizeVoiceId(voice?.voice_id);
      if (!isValidVoiceId(voiceId)) continue;
      const previewUrl = String(voice?.preview_url || "").trim();
      voices.set(voiceId, {
        voiceId,
        name: String(voice?.name || voiceId).trim().slice(0, 160),
        category: String(voice?.category || "").trim().slice(0, 40),
        language: String(voice?.labels?.language || "").trim().slice(0, 24),
        accent: String(voice?.labels?.accent || "").trim().slice(0, 80),
        previewUrl: previewUrl.startsWith("https://") ? previewUrl.slice(0, 2048) : "",
      });
    }
    if (!payload?.has_more) break;
    const token = String(payload?.next_page_token || "").trim();
    if (!token || token === nextPageToken) {
      throw new ElevenAgentsBackendError(CODES.PROVIDER_UNAVAILABLE, "ElevenLabs 返回了无效的音色分页数据。");
    }
    nextPageToken = token;
  }
  return [...voices.values()].sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base" }));
};

export const listElevenAgentLlms = async ({ apiKey, signal, fetchImpl = fetch }) => requestJson({
  url: `${API_BASE}/v1/convai/llm/list`,
  apiKey,
  signal,
  fetchImpl,
  operation: "agent",
});

const resolveQwenModelId = (payload) => {
  const candidates = Array.isArray(payload?.llms) ? payload.llms : [];
  const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const expected = normalize(EXPECTED.llmModelName);
  const match = candidates.find((item) => normalize(item?.name) === expected || normalize(item?.llm) === expected);
  if (!match?.llm) {
    throw new ElevenAgentsBackendError(CODES.QWEN_MODEL_MISMATCH, `${EXPECTED.llmModelName} is not available in this ElevenLabs workspace.`);
  }
  return String(match.llm);
};

const buildConfiguredConversationConfig = (agent, modelId, voiceId) => {
  const config = structuredClone(agent?.conversation_config || {});
  const prompt = { ...(config.agent?.prompt || {}) };
  prompt.custom_llm = null;
  Object.assign(prompt, {
    llm: modelId,
    prompt: ELEVENAGENTS_BASE_PROMPT,
    ignore_default_personality: true,
    built_in_tools: {
      ...(prompt.built_in_tools || {}),
      language_detection: structuredClone(ELEVENAGENTS_LANGUAGE_DETECTION_TOOL),
    },
    thinking_budget: 0,
    enable_reasoning_summary: false,
    backup_llm_config: { preference: EXPECTED.llmFallback },
  });
  config.agent = {
    ...(config.agent || {}),
    language: EXPECTED.defaultLanguage,
    disable_first_message_interruptions: false,
    prompt,
  };
  const existingPresets = config.language_presets || {};
  const buildLanguagePreset = (language) => {
    const source = existingPresets[language] || existingPresets.zh || existingPresets.ja || {};
    const preset = structuredClone(source);
    preset.overrides = {
      asr: null,
      turn: null,
      tts: null,
      conversation: null,
      ...(preset.overrides || {}),
      agent: {
        first_message: "",
        language,
        max_conversation_duration_message: null,
        prompt: null,
        ...(preset.overrides?.agent || {}),
      },
    };
    preset.overrides.agent.language = language;
    preset.first_message_translation ??= null;
    preset.soft_timeout_translation ??= null;
    return preset;
  };
  config.language_presets = {
    en: buildLanguagePreset("en"),
    ja: buildLanguagePreset("ja"),
  };
  config.asr = { ...(config.asr || {}), provider: EXPECTED.asrProvider };
  const tts = { ...(config.tts || {}), model_id: EXPECTED.ttsModelId };
  if (voiceId) tts.voice_id = voiceId;
  delete tts.fallback_enabled;
  delete tts.use_fallback;
  delete tts.fallback_model_id;
  delete tts.fallback_model_ids;
  config.tts = tts;
  config.turn = {
    ...(config.turn || {}),
    turn_eagerness: EXPECTED.turnEagerness,
    soft_timeout_config: {
      timeout_seconds: EXPECTED.softTimeoutSeconds,
      message: "",
    },
  };
  config.conversation = {
    ...(config.conversation || {}),
    client_events: [...new Set([...(config.conversation?.client_events || []), "interruption", "user_transcript"])],
  };
  return config;
};

export const configureElevenAgent = async ({ apiKey, agentId, voiceId, signal, fetchImpl = fetch }) => {
  const normalized = normalizeAgentId(agentId);
  if (!isValidAgentId(normalized)) throw new ElevenAgentsBackendError(CODES.AGENT_ID_INVALID, "ElevenAgent ID is invalid.");
  const normalizedVoiceId = voiceId == null ? "" : normalizeVoiceId(voiceId);
  if (voiceId != null && !isValidVoiceId(normalizedVoiceId)) {
    throw new ElevenAgentsBackendError(CODES.VOICE_ID_INVALID, "ElevenLabs Voice ID 格式无效。");
  }
  const [agent, models] = await Promise.all([
    getElevenAgent({ apiKey, agentId: normalized, signal, fetchImpl }),
    listElevenAgentLlms({ apiKey, signal, fetchImpl }),
    ...(normalizedVoiceId ? [getElevenVoice({ apiKey, voiceId: normalizedVoiceId, signal, fetchImpl })] : []),
  ]);
  const modelId = resolveQwenModelId(models);
  const branchId = String(agent?.main_branch_id || agent?.branch_id || "").trim();
  const updateUrl = new URL(`${API_BASE}/v1/convai/agents/${encodeURIComponent(normalized)}`);
  if (branchId) updateUrl.searchParams.set("branch_id", branchId);
  const conversationConfig = buildConfiguredConversationConfig(agent, modelId, normalizedVoiceId);
  let response;
  try {
    response = await fetchImpl(updateUrl.toString(), {
      method: "PATCH",
      headers: { "xi-api-key": apiKey, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_config: conversationConfig,
        version_description: `AI-KANOJO ${EXPECTED.configVersion}`,
      }),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new ElevenAgentsBackendError(CODES.REQUEST_CANCELLED, "Request cancelled.");
    throw new ElevenAgentsBackendError(CODES.PROVIDER_UNAVAILABLE, "Unable to update the ElevenAgent configuration.");
  }
  if (!response.ok) {
    const error = providerError(response.status, "update-agent");
    error.providerStatus = response.status;
    try {
      const payload = await response.json();
      const details = Array.isArray(payload?.detail) ? payload.detail : [];
      const providerMessage = typeof payload?.detail === "string"
        ? payload.detail
        : payload?.detail?.message || payload?.message || "";
      if (providerMessage) {
        error.providerMessage = String(providerMessage)
          .replace(/(?:sk|xi|token)[-_][A-Za-z0-9_-]{8,}/gi, "[redacted-secret]")
          .replace(/(?:https?|wss):\/\/\S+/gi, "[redacted-url]")
          .slice(0, 300);
      }
      error.diagnostic = details.slice(0, 8).map((item) => ({
        location: Array.isArray(item?.loc) ? item.loc.map(String).slice(0, 8) : [],
        message: String(item?.msg || "").slice(0, 160),
        type: String(item?.type || "").slice(0, 80),
      }));
    } catch {
      // Provider bodies are intentionally not forwarded when they are not structured validation errors.
    }
    throw error;
  }
  let updatePayload;
  try {
    updatePayload = await response.json();
  } catch {
    throw new ElevenAgentsBackendError(CODES.PROVIDER_UNAVAILABLE, "ElevenLabs returned an invalid update response.");
  }
  const updateValidation = inspectElevenAgentConfig(updatePayload);
  if (!updateValidation.ok) {
    throw new ElevenAgentsBackendError(CODES.AGENT_CONFIG_MISMATCH, updateValidation.issues[0]?.message || "The ElevenAgent update was not applied.");
  }
  const updated = await getElevenAgent({ apiKey, agentId: normalized, branchId, signal, fetchImpl });
  const validation = inspectElevenAgentConfig(updated);
  if (!validation.ok) {
    throw new ElevenAgentsBackendError(CODES.AGENT_CONFIG_MISMATCH, validation.issues[0]?.message || "The updated ElevenAgent configuration is invalid.");
  }
  return { ...validation, agentId: normalized, modelId, voiceId: validation.voiceId, configVersion: EXPECTED.configVersion };
};

const issue = (code, field, message) => ({ code, field, message });

const normalizeLanguage = (value) => {
  const language = String(value || "").trim().toLowerCase().replace("_", "-");
  if (language === "zh-cn" || language === "zh-hans" || language === "cmn") return "zh";
  if (language === "ja-jp") return "ja";
  if (language === "en-us" || language === "en-gb") return "en";
  return language;
};

export const inspectElevenAgentConfig = (agent) => {
  const config = agent?.conversation_config || {};
  const prompt = config.agent?.prompt || {};
  const turn = config.turn || {};
  const tts = config.tts || {};
  const asr = config.asr || {};
  const clientEvents = Array.isArray(config.conversation?.client_events) ? config.conversation.client_events : [];
  const languages = new Set([
    normalizeLanguage(config.agent?.language),
    ...Object.keys(config.language_presets || {}).map(normalizeLanguage),
  ].filter(Boolean));
  const issues = [];

  if (normalizeLanguage(config.agent?.language) !== EXPECTED.defaultLanguage) {
    issues.push(issue(CODES.AGENT_CONFIG_MISMATCH, "conversation_config.agent.language", "Agent default language must be Chinese while English and Japanese remain automatic language presets."));
  }

  if (prompt.llm !== EXPECTED.llmType) {
    issues.push(issue(CODES.QWEN_MODEL_MISMATCH, "conversation_config.agent.prompt.llm", `LLM must be ${EXPECTED.llmModelName}.`));
  }
  if (String(prompt.prompt || "").trim() !== ELEVENAGENTS_BASE_PROMPT) {
    issues.push(issue(CODES.AGENT_CONFIG_MISMATCH, "conversation_config.agent.prompt.prompt", "Agent 必须使用固定的无人格三语基础提示词。"));
  }
  if (prompt.ignore_default_personality !== true) {
    issues.push(issue(CODES.AGENT_CONFIG_MISMATCH, "conversation_config.agent.prompt.ignore_default_personality", "必须关闭 ElevenAgents 默认人格。"));
  }
  const languageTool = prompt.built_in_tools?.language_detection;
  if (!languageTool) {
    issues.push(issue(CODES.AGENT_CONFIG_MISMATCH, "conversation_config.agent.prompt.built_in_tools.language_detection", "必须启用语言检测系统工具。"));
  } else if (languageTool.params?.system_tool_type !== "language_detection") {
    issues.push(issue(CODES.AGENT_CONFIG_MISMATCH, "conversation_config.agent.prompt.built_in_tools.language_detection", "语言检测必须静默执行，且不得播报工具或语言路由信息。"));
  }
  if (EXPECTED.supportedLanguages.some((language) => !languages.has(language)) || [...languages].some((language) => !EXPECTED.supportedLanguages.includes(language))) {
    issues.push(issue(CODES.AGENT_CONFIG_MISMATCH, "conversation_config.language_presets", "Agent 只允许并必须支持中文、英文和日语。"));
  }
  if (prompt.custom_llm != null) {
    issues.push(issue(CODES.AGENT_CONFIG_MISMATCH, "conversation_config.agent.prompt.custom_llm", "Native Qwen must not use a Custom LLM configuration."));
  }
  if (prompt.thinking_budget != null && Number(prompt.thinking_budget) !== 0) {
    issues.push(issue(CODES.AGENT_CONFIG_MISMATCH, "conversation_config.agent.prompt.thinking_budget", "Voice conversations must disable thinking."));
  }
  if (prompt.enable_reasoning_summary === true) {
    issues.push(issue(CODES.AGENT_CONFIG_MISMATCH, "conversation_config.agent.prompt.enable_reasoning_summary", "Reasoning summary 必须关闭。"));
  }
  if (prompt.backup_llm_config?.preference !== EXPECTED.llmFallback) {
    issues.push(issue(CODES.AGENT_CONFIG_MISMATCH, "conversation_config.agent.prompt.backup_llm_config.preference", "LLM fallback 必须关闭。"));
  }
  if (asr.provider !== EXPECTED.asrProvider) {
    issues.push(issue(CODES.AGENT_CONFIG_MISMATCH, "conversation_config.asr.provider", "语音识别必须使用 Scribe v2 Realtime。"));
  }
  if (tts.model_id !== EXPECTED.ttsModelId) {
    issues.push(issue(CODES.TTS_MODEL_MISMATCH, "conversation_config.tts.model_id", `TTS 模型必须为 ${EXPECTED.ttsModelId}。`));
  }
  const ttsFallbackConfigured = Boolean(
    tts.fallback_enabled
    || tts.use_fallback
    || String(tts.fallback_model_id || "").trim()
    || (Array.isArray(tts.fallback_model_ids) && tts.fallback_model_ids.length > 0),
  );
  if (ttsFallbackConfigured) {
    issues.push(issue(CODES.TTS_MODEL_MISMATCH, "conversation_config.tts.fallback", "TTS fallback must be disabled."));
  }
  if (!String(tts.voice_id || "").trim()) {
    issues.push(issue(CODES.VOICE_NOT_CONFIGURED, "conversation_config.tts.voice_id", "ElevenAgent 尚未配置 Voice。"));
  }
  if (turn.turn_eagerness !== EXPECTED.turnEagerness) {
    issues.push(issue(CODES.TURN_CONFIG_MISMATCH, "conversation_config.turn.turn_eagerness", "Turn eagerness 必须为 normal。"));
  }
  if (Number(turn.soft_timeout_config?.timeout_seconds) !== EXPECTED.softTimeoutSeconds) {
    issues.push(issue(
      CODES.TURN_CONFIG_MISMATCH,
      "conversation_config.turn.soft_timeout_config",
      "Soft timeout 必须禁用，避免填充语与正式回复重叠。",
    ));
  }
  if (!clientEvents.includes("interruption") || config.agent?.disable_first_message_interruptions === true) {
    issues.push(issue(CODES.TURN_CONFIG_MISMATCH, "conversation_config.conversation.client_events", "ElevenAgent 必须启用用户打断。"));
  }

  return {
    ok: issues.length === 0,
    agentId: normalizeAgentId(agent?.agent_id),
    voiceId: normalizeVoiceId(tts.voice_id),
    expectedModels: EXPECTED,
    issues,
  };
};

export const validateElevenAgent = async (options) => {
  const agent = await getElevenAgent(options);
  return inspectElevenAgentConfig(agent);
};

export const createElevenAgentsConversationToken = async ({ apiKey, agentId, signal, fetchImpl = fetch }) => {
  const normalized = normalizeAgentId(agentId);
  if (!isValidAgentId(normalized)) throw new ElevenAgentsBackendError(CODES.AGENT_ID_INVALID, "ElevenAgent ID 格式无效。");
  const url = new URL(`${API_BASE}/v1/convai/conversation/token`);
  url.searchParams.set("agent_id", normalized);
  url.searchParams.set("environment", "production");
  const data = await requestJson({ url: url.toString(), apiKey, signal, fetchImpl, operation: "token" });
  const token = String(data?.token || "");
  const conversationId = String(data?.conversation_id || "");
  if (!token || !conversationId) throw new ElevenAgentsBackendError(CODES.SESSION_TOKEN_FAILED, "ElevenLabs 返回了无效的会话凭证。");
  return { connectionType: "webrtc", conversationToken: token, conversationId };
};

export const createElevenAgentsSignedUrl = async ({ apiKey, agentId, signal, fetchImpl = fetch }) => {
  const normalized = normalizeAgentId(agentId);
  if (!isValidAgentId(normalized)) throw new ElevenAgentsBackendError(CODES.AGENT_ID_INVALID, "ElevenAgent ID is invalid.");
  const url = new URL(`${API_BASE}/v1/convai/conversation/get-signed-url`);
  url.searchParams.set("agent_id", normalized);
  url.searchParams.set("environment", "production");
  url.searchParams.set("include_conversation_id", "true");
  const data = await requestJson({ url: url.toString(), apiKey, signal, fetchImpl, operation: "token" });
  const signedUrl = String(data?.signed_url || "");
  if (!signedUrl.startsWith("wss://")) {
    throw new ElevenAgentsBackendError(CODES.SESSION_TOKEN_FAILED, "ElevenLabs returned an invalid signed conversation URL.");
  }
  return { signedUrl };
};
