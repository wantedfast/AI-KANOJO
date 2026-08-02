import { app, safeStorage } from "electron";
import path from "node:path";
import { JsonStore } from "../electron/store.js";
import { ElevenAgentsService } from "../electron/elevenagents-service.js";
import { createElevenAgentsSignedUrl, getElevenAgent, listElevenAgentLlms } from "../electron/elevenagents-provider.js";
import { streamDeepSeek, synthesizeElevenV3 } from "../electron/providers.js";
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
  let resolveReply = null;
  let rejectReply = null;
  try {
    session = await Conversation.startSession({
      signedUrl,
      connectionType: "websocket",
      textOnly: true,
      onConnect: (event) => { conversationId = event?.conversationId || ""; },
      onMessage: ({ message, role, source }) => {
        if (role === "agent" || source === "ai") resolveReply?.(String(message || ""));
      },
      onError: (message) => rejectReply?.(new Error(String(message || "ElevenAgents SDK error"))),
      onDisconnect: (details) => {
        if (details?.reason === "error") rejectReply?.(new Error(details.message || "ElevenAgents SDK disconnected"));
      },
    });
    const replies = [];
    for (const message of [
      "Reply with exactly OK.",
      "请只回复：好的。",
      "『はい。』だけで答えてください。",
    ]) {
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("ElevenAgents SDK text turn timed out.")), timeoutMs);
        resolveReply = (value) => { clearTimeout(timeout); resolve(value); };
        rejectReply = (error) => { clearTimeout(timeout); reject(error); };
        session.sendUserMessage(message);
      });
      replies.push(response.trim());
      resolveReply = null;
      rejectReply = null;
    }
    const routingMetadata = /^\s*\[(?:language_detection|reason|language)\]/im;
    if (replies.some((reply) => routingMetadata.test(reply))) {
      throw new Error("ElevenAgents exposed language-routing metadata in an agent reply.");
    }
    return {
      connected: true,
      conversationId,
      completedTurns: replies.length,
      allRepliesReceived: replies.every(Boolean),
      routingMetadataLeaked: false,
    };
  } catch (error) {
    error.conversationId ||= conversationId;
    throw error;
  } finally {
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
      currentVersionId: String(beforeAgent?.version_id || ""),
      currentBranchId: String(beforeAgent?.branch_id || ""),
      mainBranchId: String(beforeAgent?.main_branch_id || ""),
      workflowPresent: Boolean(beforeAgent?.workflow),
      workflowKeys: Object.keys(beforeAgent?.workflow || {}).slice(0, 20),
      workflowNodeTypes: Object.values(beforeAgent?.workflow?.nodes || {}).map((node) => String(node?.type || "")).slice(0, 20),
      currentLanguageTool: beforeAgent?.conversation_config?.agent?.prompt?.built_in_tools?.language_detection || null,
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
      languagePreToolSpeech: String(prompt.built_in_tools?.language_detection?.pre_tool_speech || ""),
      languageToolCallSound: String(prompt.built_in_tools?.language_detection?.tool_call_sound || ""),
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
    stage = "standard-v3-tts";
    const standardV3Audio = await synthesizeElevenV3({
      apiKey: getApiKey(),
      voiceId: rawAgent?.conversation_config?.tts?.voice_id,
      text: "测试。",
      modelId: "eleven_v3",
      signal: AbortSignal.timeout(30_000),
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
      standardV3: { audioBytesReceived: standardV3Audio.byteLength > 0 },
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
