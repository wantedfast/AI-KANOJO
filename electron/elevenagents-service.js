import {
  ELEVENAGENTS_ERROR_CODES as CODES,
  ELEVENAGENTS_EXPECTED_CONFIG as EXPECTED,
  ElevenAgentsBackendError,
  isValidAgentId,
  isValidRequestId,
  normalizeAgentId,
  normalizeRequestId,
} from "../shared/elevenagents-contracts.js";
import {
  configureElevenAgent,
  createElevenAgentsConversationToken,
  validateElevenAgent,
} from "./elevenagents-provider.js";

const MAX_USED_REQUEST_IDS = 256;
const CREDENTIAL_RATE_LIMIT = 3;
const CREDENTIAL_RATE_WINDOW_MS = 10_000;

export class ElevenAgentsService {
  constructor({ store, getApiKey, provider = {}, now = Date.now }) {
    this.store = store;
    this.getApiKey = getApiKey;
    this.validateProvider = provider.validateElevenAgent || validateElevenAgent;
    this.configureProvider = provider.configureElevenAgent || configureElevenAgent;
    this.createTokenProvider = provider.createConversationToken || createElevenAgentsConversationToken;
    this.active = new Map();
    this.usedRequestIds = new Set();
    this.credentialRequestTimes = [];
    this.now = now;
  }

  getStatus() {
    const data = this.store.get();
    const agentId = normalizeAgentId(data.elevenAgents?.agentId);
    const elevenlabsKeyConfigured = Boolean(data.secrets?.elevenlabs);
    const agentIdConfigured = isValidAgentId(agentId);
    const agentConfigVerified = agentIdConfigured
      && data.elevenAgents?.verifiedAgentId === agentId
      && Number(data.elevenAgents?.verifiedAt) > 0
      && data.elevenAgents?.configVersion === EXPECTED.configVersion;
    const issues = [];
    if (!elevenlabsKeyConfigured) issues.push({ code: CODES.ELEVENLABS_KEY_MISSING, message: "尚未配置 ElevenLabs API Key。" });
    if (!agentId) issues.push({ code: CODES.AGENT_ID_MISSING, message: "尚未配置 ElevenAgent ID。" });
    else if (!agentIdConfigured) issues.push({ code: CODES.AGENT_ID_INVALID, message: "ElevenAgent ID 格式无效。" });
    else if (!agentConfigVerified) issues.push({ code: CODES.AGENT_CONFIG_MISMATCH, message: "ElevenAgent 配置尚未通过校验。" });
    return {
      configured: elevenlabsKeyConfigured && agentIdConfigured && agentConfigVerified,
      elevenlabsKeyConfigured,
      agentIdConfigured,
      agentConfigVerified,
      expectedModels: EXPECTED,
      issues,
    };
  }

  requireApiKey() {
    const apiKey = String(this.getApiKey() || "").trim();
    if (!apiKey) throw new ElevenAgentsBackendError(CODES.ELEVENLABS_KEY_MISSING, "尚未配置 ElevenLabs API Key。");
    return apiKey;
  }

  getSavedAgentId() {
    const agentId = normalizeAgentId(this.store.get().elevenAgents?.agentId);
    if (!agentId) throw new ElevenAgentsBackendError(CODES.AGENT_ID_MISSING, "尚未配置 ElevenAgent ID。");
    if (!isValidAgentId(agentId)) throw new ElevenAgentsBackendError(CODES.AGENT_ID_INVALID, "ElevenAgent ID 格式无效。");
    return agentId;
  }

  async validate({ agentId, signal } = {}) {
    const normalized = normalizeAgentId(agentId || this.getSavedAgentId());
    if (!isValidAgentId(normalized)) throw new ElevenAgentsBackendError(CODES.AGENT_ID_INVALID, "ElevenAgent ID 格式无效。");
    const savedAgentId = normalizeAgentId(this.store.get().elevenAgents?.agentId);
    const updatesSavedAgent = normalized === savedAgentId;
    try {
      const result = await this.validateProvider({ apiKey: this.requireApiKey(), agentId: normalized, signal });
      const verifiedAt = result.ok ? this.now() : 0;
      if (updatesSavedAgent) {
        await this.store.patch({
          elevenAgents: {
            ...this.store.get().elevenAgents,
            verifiedAgentId: result.ok ? normalized : "",
            verifiedAt,
            configVersion: result.ok ? EXPECTED.configVersion : "",
          },
        });
      }
      return { ...result, agentId: normalized, verifiedAt };
    } catch (error) {
      // A transport failure or cancellation does not prove configuration drift;
      // retain the last known-good verification state in those cases.
      throw error;
    }
  }

  async configureAgent({ agentId, signal } = {}) {
    const normalized = normalizeAgentId(agentId || this.getSavedAgentId());
    if (!isValidAgentId(normalized)) throw new ElevenAgentsBackendError(CODES.AGENT_ID_INVALID, "ElevenAgent ID 格式无效。");
    const result = await this.configureProvider({ apiKey: this.requireApiKey(), agentId: normalized, signal });
    if (!result?.ok) throw new ElevenAgentsBackendError(CODES.AGENT_CONFIG_MISMATCH, result?.issues?.[0]?.message || "ElevenAgent 配置更新失败。");
    const verifiedAt = this.now();
    await this.store.patch({
      elevenAgents: {
        ...this.store.get().elevenAgents,
        agentId: normalized,
        verifiedAgentId: normalized,
        verifiedAt,
        configVersion: EXPECTED.configVersion,
      },
    });
    return {
      agentId: normalized,
      modelId: result.modelId || EXPECTED.llmModelId,
      configVersion: EXPECTED.configVersion,
      verifiedAt,
    };
  }

  async saveAgentId(input = {}) {
    const agentId = normalizeAgentId(input.agentId);
    if (!agentId) throw new ElevenAgentsBackendError(CODES.AGENT_ID_MISSING, "ElevenAgent ID不能为空。");
    if (!isValidAgentId(agentId)) throw new ElevenAgentsBackendError(CODES.AGENT_ID_INVALID, "ElevenAgent ID 格式无效。");
    return this.configureAgent({ agentId });
  }

  rememberRequestId(requestId) {
    this.usedRequestIds.add(requestId);
    while (this.usedRequestIds.size > MAX_USED_REQUEST_IDS) {
      this.usedRequestIds.delete(this.usedRequestIds.values().next().value);
    }
  }

  enforceCredentialRateLimit() {
    const now = this.now();
    this.credentialRequestTimes = this.credentialRequestTimes.filter((time) => now - time < CREDENTIAL_RATE_WINDOW_MS);
    if (this.credentialRequestTimes.length >= CREDENTIAL_RATE_LIMIT) {
      throw new ElevenAgentsBackendError(CODES.REQUEST_RATE_LIMITED, "Conversation credential requests are temporarily rate limited.");
    }
    this.credentialRequestTimes.push(now);
  }

  async createCredential(input = {}) {
    const requestId = normalizeRequestId(input.requestId);
    if (!isValidRequestId(requestId)) throw new ElevenAgentsBackendError(CODES.REQUEST_INVALID, "requestId 格式无效。");
    if (input.connectionType != null) {
      throw new ElevenAgentsBackendError(CODES.REQUEST_INVALID, "connectionType is fixed to WebRTC and must not be supplied.");
    }
    if (this.usedRequestIds.has(requestId) || this.active.has(requestId) || this.active.size > 0) {
      throw new ElevenAgentsBackendError(CODES.REQUEST_CONFLICT, "已有会话凭证请求正在处理，或 requestId 已使用。" );
    }
    this.enforceCredentialRateLimit();
    this.rememberRequestId(requestId);
    const controller = new AbortController();
    this.active.set(requestId, controller);
    try {
      const agentId = this.getSavedAgentId();
      const validation = await this.validate({ agentId, signal: controller.signal });
      if (!validation.ok) throw new ElevenAgentsBackendError(CODES.AGENT_CONFIG_MISMATCH, validation.issues[0]?.message || "ElevenAgent 配置不符合固定要求。");
      if (controller.signal.aborted) throw new ElevenAgentsBackendError(CODES.REQUEST_CANCELLED, "请求已取消。");
      const credential = await this.createTokenProvider({ apiKey: this.requireApiKey(), agentId, signal: controller.signal });
      if (controller.signal.aborted) throw new ElevenAgentsBackendError(CODES.REQUEST_CANCELLED, "请求已取消。");
      return { requestId, connectionType: "webrtc", ...credential };
    } finally {
      this.active.delete(requestId);
    }
  }

  cancel(input = {}) {
    const requestId = normalizeRequestId(input.requestId);
    if (!isValidRequestId(requestId)) throw new ElevenAgentsBackendError(CODES.REQUEST_INVALID, "requestId 格式无效。");
    const controller = this.active.get(requestId);
    controller?.abort();
    return { ok: true, requestId, cancelled: Boolean(controller) };
  }

  abortAll() {
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
  }
}
