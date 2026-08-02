import {
  ELEVENAGENTS_QWEN_MODEL_ID,
  SCRIBE_MODEL_ID,
} from "./model-contracts.js";

export const ELEVEN_AGENT_CONNECTION_TYPE = "webrtc";
export const ELEVEN_AGENT_TTS_MODEL_ID = "eleven_v3_conversational";
export const ELEVEN_AGENT_LLM_PROVIDER = ELEVENAGENTS_QWEN_MODEL_ID;
export const ELEVEN_AGENT_ASR_PROVIDER = "scribe_realtime";
export const ELEVEN_AGENT_TURN_EAGERNESS = "normal";
export const ELEVEN_AGENT_BACKUP_LLM_PREFERENCE = "disabled";

export const ELEVEN_AGENT_ID_PATTERN = /^(agent|seng)_[A-Za-z0-9]{8,128}$/;
export const CONVERSATION_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export const ELEVEN_AGENT_ERROR_CODES = Object.freeze({
  ELEVENLABS_KEY_MISSING: "ELEVENLABS_KEY_MISSING",
  ELEVENLABS_AUTH_FAILED: "ELEVENLABS_AUTH_FAILED",
  AGENT_ID_MISSING: "AGENT_ID_MISSING",
  AGENT_ID_INVALID: "AGENT_ID_INVALID",
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  AGENT_ACCESS_DENIED: "AGENT_ACCESS_DENIED",
  AGENT_CONFIG_MISMATCH: "AGENT_CONFIG_MISMATCH",
  VOICE_NOT_CONFIGURED: "VOICE_NOT_CONFIGURED",
  QWEN_MODEL_MISMATCH: "QWEN_MODEL_MISMATCH",
  TTS_MODEL_MISMATCH: "TTS_MODEL_MISMATCH",
  TURN_CONFIG_MISMATCH: "TURN_CONFIG_MISMATCH",
  SESSION_TOKEN_FAILED: "SESSION_TOKEN_FAILED",
  PROVIDER_RATE_LIMITED: "PROVIDER_RATE_LIMITED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  REQUEST_CANCELLED: "REQUEST_CANCELLED",
  REQUEST_CONFLICT: "REQUEST_CONFLICT",
});

export const ELEVEN_AGENT_EXPECTED_MODELS = Object.freeze({
  connectionType: ELEVEN_AGENT_CONNECTION_TYPE,
  llm: {
    provider: ELEVEN_AGENT_LLM_PROVIDER,
    modelId: ELEVENAGENTS_QWEN_MODEL_ID,
    fallbackPreference: ELEVEN_AGENT_BACKUP_LLM_PREFERENCE,
  },
  asr: {
    provider: ELEVEN_AGENT_ASR_PROVIDER,
    modelId: SCRIBE_MODEL_ID,
  },
  tts: {
    modelId: ELEVEN_AGENT_TTS_MODEL_ID,
  },
  turn: {
    eagerness: ELEVEN_AGENT_TURN_EAGERNESS,
    interruptionsEnabled: true,
  },
});

export function normalizeElevenAgentId(value) {
  const agentId = String(value || "").trim();
  return agentId && ELEVEN_AGENT_ID_PATTERN.test(agentId) ? agentId : "";
}

export function normalizeConversationRequestId(value) {
  const requestId = String(value || "").trim();
  return requestId && CONVERSATION_REQUEST_ID_PATTERN.test(requestId) ? requestId : "";
}
