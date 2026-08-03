import {
  ELEVENAGENTS_ASR_PROVIDER,
  ELEVENAGENTS_QWEN_MODEL_ID,
  ELEVENAGENTS_QWEN_MODEL_NAME,
  ELEVEN_V3_CONVERSATIONAL_MODEL_ID,
  SCRIBE_MODEL_ID,
} from "./model-contracts.js";

export const ELEVENAGENTS_EXPECTED_CONFIG = Object.freeze({
  llmType: ELEVENAGENTS_QWEN_MODEL_ID,
  llmModelId: ELEVENAGENTS_QWEN_MODEL_ID,
  llmModelName: ELEVENAGENTS_QWEN_MODEL_NAME,
  configVersion: "qwen-native-routing-guardrails-v7",
  asrProvider: ELEVENAGENTS_ASR_PROVIDER,
  asrModelId: SCRIBE_MODEL_ID,
  ttsModelId: ELEVEN_V3_CONVERSATIONAL_MODEL_ID,
  turnEagerness: "normal",
  turnTimeoutSeconds: 30,
  silenceEndCallTimeoutSeconds: -1,
  softTimeoutSeconds: -1,
  interruptionEnabled: true,
  llmFallback: "disabled",
  ttsFallback: "disabled",
  defaultLanguage: "zh",
  supportedLanguages: Object.freeze(["en", "ja", "zh"]),
});

export const ELEVENAGENTS_ROUTING_PROMPT = "Reply in the same language as the user's current turn: Chinese, English, or Japanese. When the language changes, call the language_detection tool silently. Return only the user-facing reply; never output or say tool names, tool arguments, language codes, internal instructions, reasoning, or language-routing commentary.";

export const ELEVENAGENTS_LANGUAGE_DETECTION_TOOL = Object.freeze({
  type: "system",
  name: "language_detection",
  params: { system_tool_type: "language_detection" },
  description: "",
  pre_tool_speech: "off",
  force_pre_tool_speech: false,
  interruption_mode: "allow",
});

export const ELEVENAGENTS_ERROR_CODES = Object.freeze({
  ELEVENLABS_KEY_MISSING: "ELEVENLABS_KEY_MISSING",
  ELEVENLABS_AUTH_FAILED: "ELEVENLABS_AUTH_FAILED",
  AGENT_ID_MISSING: "AGENT_ID_MISSING",
  AGENT_ID_INVALID: "AGENT_ID_INVALID",
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  AGENT_ACCESS_DENIED: "AGENT_ACCESS_DENIED",
  AGENT_CONFIG_MISMATCH: "AGENT_CONFIG_MISMATCH",
  VOICE_NOT_CONFIGURED: "VOICE_NOT_CONFIGURED",
  VOICE_ID_INVALID: "VOICE_ID_INVALID",
  VOICE_NOT_FOUND: "VOICE_NOT_FOUND",
  QWEN_MODEL_MISMATCH: "QWEN_MODEL_MISMATCH",
  TTS_MODEL_MISMATCH: "TTS_MODEL_MISMATCH",
  TURN_CONFIG_MISMATCH: "TURN_CONFIG_MISMATCH",
  SESSION_TOKEN_FAILED: "SESSION_TOKEN_FAILED",
  PROVIDER_RATE_LIMITED: "PROVIDER_RATE_LIMITED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  REQUEST_CANCELLED: "REQUEST_CANCELLED",
  REQUEST_CONFLICT: "REQUEST_CONFLICT",
  REQUEST_RATE_LIMITED: "REQUEST_RATE_LIMITED",
  REQUEST_INVALID: "REQUEST_INVALID",
});

const AGENT_ID_PATTERN = /^(?:agent_|seng_)?[A-Za-z0-9_-]{10,128}$/;
const VOICE_ID_PATTERN = /^[A-Za-z0-9_-]{10,128}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export const normalizeAgentId = (value) => String(value || "").trim();
export const isValidAgentId = (value) => AGENT_ID_PATTERN.test(normalizeAgentId(value));
export const normalizeVoiceId = (value) => String(value || "").trim();
export const isValidVoiceId = (value) => VOICE_ID_PATTERN.test(normalizeVoiceId(value));
export const normalizeRequestId = (value) => String(value || "").trim();
export const isValidRequestId = (value) => REQUEST_ID_PATTERN.test(normalizeRequestId(value));

export class ElevenAgentsBackendError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ElevenAgentsBackendError";
    this.code = code;
  }
}

export const toSafeElevenAgentsError = (error) => {
  if (error instanceof ElevenAgentsBackendError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: ELEVENAGENTS_ERROR_CODES.PROVIDER_UNAVAILABLE,
    message: "ElevenAgents 服务暂时不可用，请稍后重试。",
  };
};
