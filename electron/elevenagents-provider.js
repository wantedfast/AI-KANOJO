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

const issue = (code, field, message) => ({ code, field, message });

const normalizeLanguage = (value) => {
  const language = String(value || "").trim().toLowerCase().replace("_", "-");
  if (language === "zh-cn" || language === "zh-hans" || language === "cmn") return "zh";
  if (language === "ja-jp") return "ja";
  if (language === "en-us" || language === "en-gb") return "en";
  return language;
};

const providerError = (status, operation) => {
  if (status === 401) return new ElevenAgentsBackendError(CODES.ELEVENLABS_AUTH_FAILED, "ElevenLabs API key is invalid or expired.");
  if (status === 403) return new ElevenAgentsBackendError(CODES.AGENT_ACCESS_DENIED, "The current ElevenLabs key cannot access this agent.");
  if (status === 404 && operation === "agent") return new ElevenAgentsBackendError(CODES.AGENT_NOT_FOUND, "The requested ElevenAgent was not found.");
  if (status === 404 && operation === "voice") return new ElevenAgentsBackendError(CODES.VOICE_NOT_FOUND, "The requested ElevenLabs voice was not found.");
  if (status === 429) return new ElevenAgentsBackendError(CODES.PROVIDER_RATE_LIMITED, "ElevenLabs requests are being rate limited.");
  if (status >= 500) return new ElevenAgentsBackendError(CODES.PROVIDER_UNAVAILABLE, "ElevenLabs is temporarily unavailable.");
  const code = operation === "token" ? CODES.SESSION_TOKEN_FAILED : CODES.PROVIDER_UNAVAILABLE;
  if (operation === "update-agent") return new ElevenAgentsBackendError(CODES.PROVIDER_UNAVAILABLE, "Unable to update the ElevenAgent configuration.");
  return new ElevenAgentsBackendError(code, operation === "token" ? "Unable to create an ElevenAgents conversation credential." : "Unable to read the ElevenAgent configuration.");
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
    if (error?.name === "AbortError") throw new ElevenAgentsBackendError(CODES.REQUEST_CANCELLED, "Request cancelled.");
    throw new ElevenAgentsBackendError(CODES.PROVIDER_UNAVAILABLE, "ElevenLabs is temporarily unavailable.");
  }
  if (!response.ok) throw providerError(response.status, operation);
  try {
    return await response.json();
  } catch {
    throw new ElevenAgentsBackendError(operation === "token" ? CODES.SESSION_TOKEN_FAILED : CODES.PROVIDER_UNAVAILABLE, "ElevenLabs returned invalid JSON.");
  }
};

export const getElevenAgent = async ({ apiKey, agentId, branchId = "", signal, fetchImpl = fetch }) => {
  const normalized = normalizeAgentId(agentId);
  if (!isValidAgentId(normalized)) throw new ElevenAgentsBackendError(CODES.AGENT_ID_INVALID, "ElevenAgent ID is invalid.");
  const url = new URL(`${API_BASE}/v1/convai/agents/${encodeURIComponent(normalized)}`);
  if (branchId) url.searchParams.set("branch_id", String(branchId));
  return requestJson({ url: url.toString(), apiKey, signal, fetchImpl, operation: "agent" });
};

export const getElevenVoice = async ({ apiKey, voiceId, signal, fetchImpl = fetch }) => {
  const normalized = normalizeVoiceId(voiceId);
  if (!isValidVoiceId(normalized)) throw new ElevenAgentsBackendError(CODES.VOICE_ID_INVALID, "ElevenLabs voice ID is invalid.");
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
      throw new ElevenAgentsBackendError(CODES.PROVIDER_UNAVAILABLE, "ElevenLabs returned invalid voice pagination data.");
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

  const configuredAgent = {
    ...(config.agent || {}),
    language: EXPECTED.defaultLanguage,
    disable_first_message_interruptions: false,
    prompt,
  };
  delete configuredAgent.llm;
  config.agent = configuredAgent;

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
  config.vad = { ...(config.vad || {}), background_voice_detection: false };

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
    turn_timeout: EXPECTED.turnTimeoutSeconds,
    silence_end_call_timeout: EXPECTED.silenceEndCallTimeoutSeconds,
    turn_model: EXPECTED.turnMode,
    mode: "turn",
    interruption_ignore_terms: [],
    interruption_ignore_term_languages: [],
    speculative_turn: false,
    retranscribe_on_turn_timeout: false,
    transcribe_on_disabled_interruptions: false,
    soft_timeout_config: {
      timeout_seconds: EXPECTED.softTimeoutSeconds,
      message: "…",
    },
  };

  config.conversation = {
    ...(config.conversation || {}),
    client_events: [...new Set([
      ...(config.conversation?.client_events || []),
      "interruption",
      "user_transcript",
      "agent_response_correction",
    ])],
  };

  return config;
};

export const configureElevenAgent = async ({ apiKey, agentId, voiceId, signal, fetchImpl = fetch }) => {
  const normalized = normalizeAgentId(agentId);
  if (!isValidAgentId(normalized)) throw new ElevenAgentsBackendError(CODES.AGENT_ID_INVALID, "ElevenAgent ID is invalid.");
  const normalizedVoiceId = voiceId == null ? "" : normalizeVoiceId(voiceId);
  if (voiceId != null && !isValidVoiceId(normalizedVoiceId)) {
    throw new ElevenAgentsBackendError(CODES.VOICE_ID_INVALID, "ElevenLabs voice ID is invalid.");
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
      // Ignore provider bodies that are not structured validation errors.
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

  return {
    ...validation,
    agentId: normalized,
    modelId,
    voiceId: validation.voiceId,
    configVersion: EXPECTED.configVersion,
  };
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
    issues.push(issue(CODES.QWEN_MODEL_MISMATCH, "conversation_config.agent.prompt.llm", `Voice LLM must be ${EXPECTED.llmModelName}.`));
  }
  if (prompt.custom_llm != null || config.agent?.llm?.custom_llm != null) {
    issues.push(issue(CODES.AGENT_CONFIG_MISMATCH, "conversation_config.agent.prompt.custom_llm", "Native Qwen voice must not use a Custom LLM gateway."));
  }
  if (String(prompt.prompt || "").trim() !== ELEVENAGENTS_BASE_PROMPT) {
    issues.push(issue(CODES.AGENT_CONFIG_MISMATCH, "conversation_config.agent.prompt.prompt", "Agent must use the fixed language-following base prompt."));
  }
  if (prompt.ignore_default_personality !== true) {
    issues.push(issue(CODES.AGENT_CONFIG_MISMATCH, "conversation_config.agent.prompt.ignore_default_personality", "ElevenAgents default personality must be disabled."));
  }
  const languageTool = prompt.built_in_tools?.language_detection;
  if (!languageTool) {
    issues.push(issue(CODES.AGENT_CONFIG_MISMATCH, "conversation_config.agent.prompt.built_in_tools.language_detection", "The language detection tool must be enabled."));
  } else if (languageTool.params?.system_tool_type !== "language_detection") {
    issues.push(issue(CODES.AGENT_CONFIG_MISMATCH, "conversation_config.agent.prompt.built_in_tools.language_detection", "The language detection tool must remain a silent system language detector."));
  }
  if (EXPECTED.supportedLanguages.some((language) => !languages.has(language)) || [...languages].some((language) => !EXPECTED.supportedLanguages.includes(language))) {
    issues.push(issue(CODES.AGENT_CONFIG_MISMATCH, "conversation_config.language_presets", "The agent must support only Chinese, English, and Japanese."));
  }
  if (prompt.thinking_budget != null && Number(prompt.thinking_budget) !== 0) {
    issues.push(issue(CODES.AGENT_CONFIG_MISMATCH, "conversation_config.agent.prompt.thinking_budget", "Voice conversations must disable thinking."));
  }
  if (prompt.enable_reasoning_summary === true) {
    issues.push(issue(CODES.AGENT_CONFIG_MISMATCH, "conversation_config.agent.prompt.enable_reasoning_summary", "Reasoning summaries must be disabled."));
  }
  if (prompt.backup_llm_config?.preference !== EXPECTED.llmFallback) {
    issues.push(issue(CODES.AGENT_CONFIG_MISMATCH, "conversation_config.agent.prompt.backup_llm_config.preference", "LLM fallback must be disabled."));
  }
  if (asr.provider !== EXPECTED.asrProvider) {
    issues.push(issue(CODES.AGENT_CONFIG_MISMATCH, "conversation_config.asr.provider", "ASR must use Scribe v2 Realtime."));
  }
  if (tts.model_id !== EXPECTED.ttsModelId) {
    issues.push(issue(CODES.TTS_MODEL_MISMATCH, "conversation_config.tts.model_id", `TTS must use ${EXPECTED.ttsModelId}.`));
  }
  const ttsFallbackConfigured = Boolean(
    tts.fallback_enabled
    || tts.use_fallback
    || String(tts.fallback_model_id || "").trim()
    || (Array.isArray(tts.fallback_model_ids) && tts.fallback_model_ids.length > 0)
  );
  if (ttsFallbackConfigured) {
    issues.push(issue(CODES.TTS_MODEL_MISMATCH, "conversation_config.tts.fallback", "TTS fallback must be disabled."));
  }
  if (!String(tts.voice_id || "").trim()) {
    issues.push(issue(CODES.VOICE_NOT_CONFIGURED, "conversation_config.tts.voice_id", "A voice must be configured on the ElevenAgent."));
  }
  if (String(turn.turn_model || "").trim() !== EXPECTED.turnMode) {
    issues.push(issue(CODES.TURN_CONFIG_MISMATCH, "conversation_config.turn.turn_model", `Turn model must be ${EXPECTED.turnMode}.`));
  }
  if (turn.turn_eagerness !== EXPECTED.turnEagerness) {
    issues.push(issue(CODES.TURN_CONFIG_MISMATCH, "conversation_config.turn.turn_eagerness", "Turn eagerness must be normal."));
  }
  if (Number(turn.turn_timeout) !== EXPECTED.turnTimeoutSeconds) {
    issues.push(issue(CODES.TURN_CONFIG_MISMATCH, "conversation_config.turn.turn_timeout", `Turn timeout must be ${EXPECTED.turnTimeoutSeconds} seconds.`));
  }
  if (Number(turn.silence_end_call_timeout) !== EXPECTED.silenceEndCallTimeoutSeconds) {
    issues.push(issue(CODES.TURN_CONFIG_MISMATCH, "conversation_config.turn.silence_end_call_timeout", "Silence must never end the session automatically."));
  }
  if (Number(turn.soft_timeout_config?.timeout_seconds) !== EXPECTED.softTimeoutSeconds) {
    issues.push(issue(CODES.TURN_CONFIG_MISMATCH, "conversation_config.turn.soft_timeout_config", "Soft timeout must be disabled."));
  }
  if (!clientEvents.includes("interruption")
    || !clientEvents.includes("user_transcript")
    || !clientEvents.includes("agent_response_correction")
    || config.agent?.disable_first_message_interruptions === true) {
    issues.push(issue(CODES.TURN_CONFIG_MISMATCH, "conversation_config.conversation.client_events", "Interruption, user transcript, and response correction events must stay enabled."));
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
  if (!isValidAgentId(normalized)) throw new ElevenAgentsBackendError(CODES.AGENT_ID_INVALID, "ElevenAgent ID is invalid.");
  const url = new URL(`${API_BASE}/v1/convai/conversation/token`);
  url.searchParams.set("agent_id", normalized);
  url.searchParams.set("environment", "production");
  const data = await requestJson({ url: url.toString(), apiKey, signal, fetchImpl, operation: "token" });
  const token = String(data?.token || "");
  const conversationId = String(data?.conversation_id || "");
  if (!token || !conversationId) throw new ElevenAgentsBackendError(CODES.SESSION_TOKEN_FAILED, "ElevenLabs returned an invalid conversation token response.");
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
