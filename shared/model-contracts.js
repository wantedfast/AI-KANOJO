export const DEEPSEEK_MODEL_ID = "deepseek-v4-flash";
export const ELEVENAGENTS_QWEN_MODEL_NAME = "Qwen3.6-35B-A3B";
export const ELEVENAGENTS_QWEN_MODEL_ID = "qwen36-35b-a3b";
export const SCRIBE_MODEL_ID = "scribe_v2_realtime";
export const ELEVEN_V3_MODEL_ID = "eleven_v3";
export const ELEVEN_V3_CONVERSATIONAL_MODEL_ID = "eleven_v3_conversational";
export const ELEVENAGENTS_ASR_PROVIDER = "scribe_realtime";

export const ELEVEN_TTS_MODEL_OPTIONS = Object.freeze([
  Object.freeze({ id: ELEVEN_V3_CONVERSATIONAL_MODEL_ID, label: "Eleven v3 Conversational", mode: "realtime" }),
  Object.freeze({ id: ELEVEN_V3_MODEL_ID, label: "Eleven v3", mode: "standalone" }),
]);

export const isSupportedElevenTtsModel = (value) => ELEVEN_TTS_MODEL_OPTIONS.some(({ id }) => id === value);
