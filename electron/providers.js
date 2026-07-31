const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const ELEVEN_URL = "https://api.elevenlabs.io/v1";
export const ELEVEN_V3_MODEL_ID = "eleven_v3";
export const SCRIBE_MODEL_ID = "scribe_v2_realtime";

async function checked(response, label) {
  if (response.ok) return response;
  const detail = await response.text();
  throw new Error(`${label} 请求失败（${response.status}）：${detail.slice(0, 180)}`);
}

export async function streamDeepSeek({ apiKey, model, messages, signal, onDelta }) {
  if (!apiKey) throw new Error("尚未配置 DeepSeek API Key");
  const response = await checked(await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "deepseek-v4-flash",
      messages: messages.slice(-24),
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

export async function synthesizeElevenV3({ apiKey, voiceId, text, signal }) {
  if (!apiKey) throw new Error("尚未配置 ElevenLabs API Key");
  if (!voiceId) throw new Error("尚未配置 ElevenLabs Voice ID");
  const response = await checked(await fetch(`${ELEVEN_URL}/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: ELEVEN_V3_MODEL_ID,
      voice_settings: { stability: 0.48, similarity_boost: 0.78, style: 0.18 },
    }),
    signal,
  }), "Eleven v3");
  return response.arrayBuffer();
}
