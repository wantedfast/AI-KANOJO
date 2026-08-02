import { app, safeStorage } from "electron";
import path from "node:path";
import { JsonStore } from "../electron/store.js";
import { ElevenAgentsService } from "../electron/elevenagents-service.js";
import { createElevenAgentsSignedUrl, getElevenAgent, listElevenAgentLlms } from "../electron/elevenagents-provider.js";
import { streamDeepSeek } from "../electron/providers.js";
import { toSafeElevenAgentsError } from "../shared/elevenagents-contracts.js";
import WebSocket from "ws";
import { Conversation } from "@elevenlabs/client";

globalThis.WebSocket = WebSocket;

const safeDiagnostic = (error) => String(error?.message || error || "Unknown failure")
  .replace(/(?:https?|wss):\/\/\S+/gi, "[redacted-url]")
  .replace(/(?:sk|xi|token)[-_][A-Za-z0-9_-]{12,}/gi, "[redacted-secret]")
  .slice(0, 320);

const verifySdkTextTurn = async ({ signedUrl, timeoutMs = 20_000 }) => {
  let session;
  let conversationId = "";
  let resolveReply;
  let rejectReply;
  const reply = new Promise((resolve, reject) => {
    resolveReply = resolve;
    rejectReply = reject;
  });
  const timeout = setTimeout(() => rejectReply(new Error("ElevenAgents SDK text turn timed out.")), timeoutMs);
  try {
    session = await Conversation.startSession({
      signedUrl,
      connectionType: "websocket",
      textOnly: true,
      onConnect: (event) => { conversationId = event?.conversationId || ""; },
      onMessage: ({ message, role, source }) => {
        if (role === "agent" || source === "ai") resolveReply(String(message || ""));
      },
      onError: (message) => rejectReply(new Error(String(message || "ElevenAgents SDK error"))),
      onDisconnect: (details) => {
        if (details?.reason === "error") rejectReply(new Error(details.message || "ElevenAgents SDK disconnected"));
      },
    });
    session.sendUserMessage("Reply with exactly OK.");
    const response = await reply;
    return { connected: true, conversationId, turnReplyReceived: Boolean(response.trim()) };
  } catch (error) {
    error.conversationId ||= conversationId;
    throw error;
  } finally {
    clearTimeout(timeout);
    await session?.endSession?.().catch(() => {});
  }
};

app.setName("ai-kanojo");

const finish = (value, code = 0) => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  app.exit(code);
};

app.whenReady().then(async () => {
  let service;
  let configDiagnostic = null;
  let elevenlabsApiKey = "";
  let stage = "load-local-state";
  try {
    const store = new JsonStore(path.join(app.getPath("appData"), "ai-kanojo"));
    await store.load();
    const decryptStored = (name) => {
      const encrypted = store.get().secrets?.[name];
      if (!encrypted || !safeStorage.isEncryptionAvailable()) return "";
      return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    };
    const getApiKey = () => decryptStored("elevenlabs");
    elevenlabsApiKey = getApiKey();
    service = new ElevenAgentsService({ store, getApiKey });
    stage = "read-agent";
    const beforeAgent = await getElevenAgent({ apiKey: getApiKey(), agentId: store.get().elevenAgents?.agentId });
    stage = "list-llms";
    const llmList = await listElevenAgentLlms({ apiKey: getApiKey() });
    configDiagnostic = {
      currentModelId: String(beforeAgent?.conversation_config?.agent?.prompt?.llm || ""),
      qwenModels: (llmList?.llms || []).map((item) => String(item?.llm || "")).filter((id) => /qwen/i.test(id)),
    };
    stage = "configure-agent";
    const configuration = await service.configureAgent();
    stage = "validate-agent";
    const status = service.getStatus();
    const validation = await service.validate();
    if (!validation.ok) return finish({ ok: false, status, validation: { ok: false, issues: validation.issues } }, 1);
    const rawAgent = await getElevenAgent({ apiKey: getApiKey(), agentId: validation.agentId });
    const prompt = rawAgent?.conversation_config?.agent?.prompt || {};
    configDiagnostic = {
      modelId: String(prompt.llm || ""),
      customLlmPresent: prompt.custom_llm != null,
      asrProvider: String(rawAgent?.conversation_config?.asr?.provider || ""),
      ttsModelId: String(rawAgent?.conversation_config?.tts?.model_id || ""),
      voiceConfigured: Boolean(rawAgent?.conversation_config?.tts?.voice_id),
      configVersion: configuration.configVersion,
    };
    const credential = await service.createCredential({ requestId: `live-${Date.now()}` });
    const textCredential = await createElevenAgentsSignedUrl({ apiKey: getApiKey(), agentId: validation.agentId });
    const handshake = await verifySdkTextTurn({ signedUrl: textCredential.signedUrl, timeoutMs: 20_000 });
    stage = "direct-deepseek";
    const directTextReply = await streamDeepSeek({
      apiKey: decryptStored("deepseek"),
      messages: [{ role: "user", content: "Reply with exactly OK." }],
      signal: AbortSignal.timeout(20_000),
    });
    finish({
      ok: true,
      status,
      validation: { ok: true, agentId: validation.agentId, verifiedAt: validation.verifiedAt },
      configuration,
      credential: {
        connectionType: credential.connectionType,
        conversationId: credential.conversationId,
        conversationTokenIssued: Boolean(credential.conversationToken),
      },
      textCredential: {
        connectionType: textCredential.connectionType,
        signedUrlIssued: Boolean(textCredential.signedUrl),
      },
      handshake,
      directText: { replyReceived: Boolean(String(directTextReply || "").trim()) },
    });
  } catch (error) {
    let conversationDiagnostic = null;
    if (error?.conversationId) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(error.conversationId)}`, {
          headers: { "xi-api-key": elevenlabsApiKey, Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        const details = response.ok ? await response.json() : {};
        conversationDiagnostic = {
          requestOk: response.ok,
          status: String(details.status || ""),
          terminationReason: String(details.metadata?.termination_reason || ""),
          errorCode: String(details.metadata?.error?.code || ""),
          errorReason: String(details.metadata?.error?.reason || "").slice(0, 200),
          warnings: Array.isArray(details.metadata?.warnings)
            ? details.metadata.warnings.map((item) => String(item).slice(0, 120)).slice(0, 5)
            : [],
          transcriptRoles: Array.isArray(details.transcript)
            ? details.transcript.map((item) => item?.role).filter(Boolean)
            : [],
        };
      } catch (detailsError) {
        conversationDiagnostic = { requestOk: false, message: safeDiagnostic(detailsError) };
      }
    }
    finish({
      ok: false,
      error: toSafeElevenAgentsError(error),
      diagnostic: {
        stage,
        message: safeDiagnostic(error),
        providerStatus: Number(error?.providerStatus) || null,
        validation: Array.isArray(error?.diagnostic) ? error.diagnostic : null,
        providerMessage: safeDiagnostic(error?.providerMessage || ""),
      },
      configDiagnostic,
      conversationDiagnostic,
    }, 1);
  } finally {
    service?.abortAll();
  }
});
