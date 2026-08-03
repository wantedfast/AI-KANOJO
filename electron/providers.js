import {
  DEEPSEEK_MODEL_ID,
  ELEVEN_V3_MODEL_ID,
  SCRIBE_MODEL_ID,
} from "../shared/model-contracts.js";
import {
  ELEVEN_AGENT_CONNECTION_TYPE,
  ELEVEN_AGENT_TTS_MODEL_ID,
} from "../shared/eleven-agent-contracts.js";

export { DEEPSEEK_MODEL_ID, ELEVEN_V3_MODEL_ID, SCRIBE_MODEL_ID };
export { ELEVEN_AGENT_CONNECTION_TYPE, ELEVEN_AGENT_TTS_MODEL_ID };

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const ELEVEN_URL = "https://api.elevenlabs.io/v1";

async function checked(response, label) {
  if (response.ok) return response;
  const detail = await response.text();
  throw new Error(`${label} 请求失败（${response.status}）：${detail.slice(0, 180)}`);
}

export class ProviderHttpError extends Error {
  constructor(message, { status = 0, body = "", payload = null } = {}) {
    super(message);
    this.name = "ProviderHttpError";
    this.status = status;
    this.body = body;
    this.payload = payload;
  }
}

async function parseProviderBody(response) {
  const text = await response.text();
  if (!text) return { text: "", payload: null };
  try {
    return { text, payload: JSON.parse(text) };
  } catch {
    return { text, payload: null };
  }
}

async function requestProviderJson(responsePromise, label) {
  const response = await responsePromise;
  const { text, payload } = await parseProviderBody(response);
  if (!response.ok) {
    throw new ProviderHttpError(`${label} 请求失败`, {
      status: response.status,
      body: text.slice(0, 400),
      payload,
    });
  }
  return payload ?? {};
}

export async function streamDeepSeek({ apiKey, messages, signal, onDelta }) {
  if (!apiKey) throw new Error("尚未配置 DeepSeek API Key");
  const conversation = Array.isArray(messages) ? messages.slice(-24).flatMap((message) => {
    if (!message || !["user", "assistant"].includes(message.role)) return [];
    const content = String(message.content || "").trim().slice(0, 12000);
    return content ? [{ role: message.role, content }] : [];
  }) : [];
  const response = await checked(await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL_ID,
      messages: conversation,
      stream: true,
      thinking: { type: "disabled" },
    }),
    signal,
  }), "DeepSeek");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const delta = JSON.parse(data).choices?.[0]?.delta?.content;
      if (delta) {
        output += delta;
        onDelta?.(delta);
      }
    }
  }
  return output;
}

export async function createScribeToken(apiKey, signal) {
  if (!apiKey) throw new Error("尚未配置 ElevenLabs API Key");
  const response = await checked(await fetch(`${ELEVEN_URL}/single-use-token/realtime_scribe`, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    signal,
  }), "Scribe");
  const data = await response.json();
  if (!data.token) throw new Error("Scribe 未返回单次令牌");
  return data.token;
}

export async function synthesizeElevenV3({ apiKey, voiceId, text, modelId = ELEVEN_V3_MODEL_ID, signal }) {
  if (!apiKey) throw new Error("尚未配置 ElevenLabs API Key");
  if (!voiceId) throw new Error("尚未配置 ElevenLabs Voice ID");
  if (modelId !== ELEVEN_V3_MODEL_ID) throw new Error("独立语音合成仅支持 Eleven v3");
  const response = await checked(await fetch(`${ELEVEN_URL}/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: { stability: 0.48, similarity_boost: 0.78, style: 0.18 },
    }),
    signal,
  }), "Eleven v3");
  const audio = new Uint8Array(await response.arrayBuffer());
  if (!audio.byteLength) throw new Error("Eleven v3 返回了空音频");
  return audio;
}

export async function fetchElevenAgent({ apiKey, agentId, signal }) {
  if (!apiKey) throw new Error("尚未配置 ElevenLabs API Key");
  if (!agentId) throw new Error("尚未配置 ElevenAgent ID");
  return requestProviderJson(fetch(`${ELEVEN_URL}/convai/agents/${encodeURIComponent(agentId)}`, {
    method: "GET",
    headers: { "xi-api-key": apiKey },
    signal,
  }), "ElevenAgent");
}

export async function createConversationToken({ apiKey, agentId, signal }) {
  if (!apiKey) throw new Error("尚未配置 ElevenLabs API Key");
  if (!agentId) throw new Error("尚未配置 ElevenAgent ID");
  const query = new URLSearchParams({ agent_id: agentId });
  const data = await requestProviderJson(fetch(`${ELEVEN_URL}/convai/conversation/token?${query.toString()}`, {
    method: "GET",
    headers: { "xi-api-key": apiKey },
    signal,
  }), "ElevenAgents 会话令牌");
  if (!data.token || !data.conversation_id) {
    throw new ProviderHttpError("会话令牌响应缺少必要字段", { status: 502, payload: data });
  }
  return {
    connectionType: ELEVEN_AGENT_CONNECTION_TYPE,
    conversationToken: String(data.token),
    conversationId: String(data.conversation_id),
  };
}

export async function createConversationSignedUrl({ apiKey, agentId, signal }) {
  if (!apiKey) throw new Error("尚未配置 ElevenLabs API Key");
  if (!agentId) throw new Error("尚未配置 ElevenAgent ID");
  const query = new URLSearchParams({ agent_id: agentId });
  const data = await requestProviderJson(fetch(`${ELEVEN_URL}/convai/conversation/get-signed-url?${query.toString()}`, {
    method: "GET",
    headers: { "xi-api-key": apiKey },
    signal,
  }), "ElevenAgents signed URL");
  if (!data.signed_url) {
    throw new ProviderHttpError("Signed URL 响应缺少必要字段", { status: 502, payload: data });
  }
  return {
    connectionType: "websocket",
    signedUrl: String(data.signed_url),
  };
}
