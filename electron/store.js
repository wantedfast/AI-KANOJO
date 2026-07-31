import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export class JsonStore {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, "state.json");
    this.data = {
      settings: { demoMode: true, deepseekModel: "deepseek-v4-flash", voiceId: "", microphoneId: "" },
      chat: [],
      window: null,
      locked: false,
      secrets: {},
    };
  }

  async load() {
    await mkdir(this.directory, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8"));
      this.data = {
        ...this.data,
        ...parsed,
        settings: { ...this.data.settings, ...parsed.settings },
        secrets: { ...this.data.secrets, ...parsed.secrets },
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
