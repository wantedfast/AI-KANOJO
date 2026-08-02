import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export class JsonStore {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, "state.json");
    this.data = {
      settings: { voiceId: "", microphoneId: "" },
      chat: [],
      window: null,
      locked: false,
      secrets: {},
      elevenAgents: { agentId: "", verifiedAgentId: "", verifiedAt: 0, configVersion: "" },
    };
  }

  async load() {
    await mkdir(this.directory, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8"));
      this.data = {
        ...this.data,
        ...parsed,
        settings: {
          voiceId: String(parsed.settings?.voiceId || "").trim().slice(0, 160),
          microphoneId: String(parsed.settings?.microphoneId || "").trim().slice(0, 512),
        },
        secrets: { ...this.data.secrets, ...parsed.secrets },
        elevenAgents: {
          agentId: String(parsed.elevenAgents?.agentId || "").trim().slice(0, 160),
          verifiedAgentId: String(parsed.elevenAgents?.verifiedAgentId || "").trim().slice(0, 160),
          verifiedAt: Math.max(0, Number(parsed.elevenAgents?.verifiedAt) || 0),
          configVersion: String(parsed.elevenAgents?.configVersion || "").trim().slice(0, 80),
        },
      };
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    return this.data;
  }

  get() {
    return structuredClone(this.data);
  }

  async patch(patch) {
    this.data = { ...this.data, ...patch };
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    await rename(temporary, this.file);
    return this.get();
  }
}
