export const DEEPSEEK_MODEL_ID = "deepseek-v4-flash";
export const SCRIBE_MODEL_ID = "scribe_v2_realtime";
export const ELEVEN_V3_MODEL_ID = "eleven_v3";
export const ELEVEN_V3_CONVERSATIONAL_MODEL_ID = "eleven_v3_conversational";
export const ELEVENAGENTS_ASR_PROVIDER = "scribe_realtime";
export const ELEVENAGENTS_CUSTOM_LLM_TYPE = "custom_llm";
export const ELEVENAGENTS_QWEN_MODEL_ID = "qwen36-35b-a3b";
export const ELEVENAGENTS_QWEN_MODEL_NAME = "Qwen3.6-35B-A3B";

export const VOICE_MODE_REALTIME = "realtime";
export const VOICE_MODE_EXPRESSIVE = "expressive";

export const VOICE_MODE_OPTIONS = Object.freeze([
  Object.freeze({
    id: VOICE_MODE_REALTIME,
    label: "实时对话 · 可打断（推荐）",
    capability: "Scribe v2 Realtime → ElevenAgents Qwen → Eleven v3 Conversational",
    ttsModelId: ELEVEN_V3_CONVERSATIONAL_MODEL_ID,
  }),
  Object.freeze({
    id: VOICE_MODE_EXPRESSIVE,
    label: "高表现力 · 轮流对话",
    capability: "Scribe v2 Realtime → ElevenAgents Qwen → Eleven v3",
    ttsModelId: ELEVEN_V3_MODEL_ID,
  }),
]);

export const ELEVEN_TTS_MODEL_OPTIONS = Object.freeze([
  Object.freeze({ id: ELEVEN_V3_CONVERSATIONAL_MODEL_ID, label: "Eleven v3 Conversational", mode: "realtime" }),
  Object.freeze({ id: ELEVEN_V3_MODEL_ID, label: "Eleven v3", mode: "standalone" }),
]);

export const isSupportedElevenTtsModel = (value) => ELEVEN_TTS_MODEL_OPTIONS.some(({ id }) => id === value);
export const isSupportedVoiceMode = (value) => VOICE_MODE_OPTIONS.some(({ id }) => id === value);

export const voiceModeFromLegacyTtsModelId = (value) => {
  if (value === ELEVEN_V3_MODEL_ID) return VOICE_MODE_EXPRESSIVE;
  return VOICE_MODE_REALTIME;
};

export const normalizeVoiceMode = (value, legacyTtsModelId = "") => {
  if (isSupportedVoiceMode(value)) return value;
  return voiceModeFromLegacyTtsModelId(legacyTtsModelId);
};

export const ttsModelIdForVoiceMode = (voiceMode) => VOICE_MODE_OPTIONS.find(({ id }) => id === voiceMode)?.ttsModelId
  || ELEVEN_V3_CONVERSATIONAL_MODEL_ID;
