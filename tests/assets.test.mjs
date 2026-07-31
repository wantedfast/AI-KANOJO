import { readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("runtime avatar manifest", () => {
  it("maps six states to the four approved runtime PNGs", async () => {
    const manifest = JSON.parse(await readFile("public/avatar/8bit/manifest.json", "utf8"));
    expect(Object.keys(manifest.states)).toEqual(["idle", "listening", "thinking", "speaking", "completed", "error"]);
    expect(manifest.states.speaking.reuses).toBe("listening");
    expect(manifest.states.error.reuses).toBe("thinking");
    const files = new Set(Object.values(manifest.states).map((state) => state.src));
    expect(files.size).toBe(4);
    for (const source of files) {
      const file = await stat(`public/${source.replace(/^\.?\//, "")}`);
      expect(file.size).toBeGreaterThan(1000);
    }
  });
});
