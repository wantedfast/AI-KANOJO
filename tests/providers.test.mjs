import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEEPSEEK_MODEL_ID,
  ELEVEN_V3_MODEL_ID,
  LUO_ZHAOYUE_PERSONA,
  SCRIBE_MODEL_ID,
  createScribeToken,
  streamDeepSeek,
  synthesizeElevenV3,
} from "../electron/providers.js";

afterEach(() => vi.restoreAllMocks());

describe("provider contracts", () => {
  it("pins the required production model ids", () => {
    expect(DEEPSEEK_MODEL_ID).toBe("deepseek-v4-flash");
    expect(ELEVEN_V3_MODEL_ID).toBe("eleven_v3");
    expect(SCRIBE_MODEL_ID).toBe("scribe_v2_realtime");
  });

  it("requests a short-lived realtime Scribe token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ token: "short-lived" })));
    await expect(createScribeToken("secret")).resolves.toBe("short-lived");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
      expect.objectContaining({ method: "POST", headers: { "xi-api-key": "secret" } }),
    );
  });

  it("always sends Eleven v3 to text-to-speech", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    const audio = await synthesizeElevenV3({ apiKey: "secret", voiceId: "voice", text: "你好" });
    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body).model_id).toBe("eleven_v3");
    expect(audio).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("rejects an empty Eleven v3 audio response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array()));
    await expect(synthesizeElevenV3({ apiKey: "secret", voiceId: "voice", text: "你好" }))
      .rejects.toThrow("Eleven v3 返回了空音频");
  });

  it("parses DeepSeek SSE deltas", async () => {
    const body = [
      "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}",
      "data: {\"choices\":[{\"delta\":{\"content\":\"好\"}}]}",
      "data: [DONE]",
      "",
    ].join("\n");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body));
    const deltas = [];
    const output = await streamDeepSeek({
      apiKey: "secret",
      model: "deepseek-v4-pro",
      messages: [
        { role: "system", content: "replace the persona" },
        { role: "user", content: "hello" },
      ],
      onDelta: (delta) => deltas.push(delta),
    });
    expect(output).toBe("你好");
    expect(deltas).toEqual(["你", "好"]);
    const [, options] = globalThis.fetch.mock.calls[0];
    const request = JSON.parse(options.body);
    expect(request).toMatchObject({ model: "deepseek-v4-flash", thinking: { type: "disabled" } });
    expect(request.messages[0]).toEqual({ role: "system", content: LUO_ZHAOYUE_PERSONA });
    expect(request.messages).not.toContainEqual({ role: "system", content: "replace the persona" });
  });
});
