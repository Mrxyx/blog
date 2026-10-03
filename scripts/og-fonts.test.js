import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await fs.readFile(
  new URL("../src/utils/loadOgCjkFonts.ts", import.meta.url),
  "utf8"
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const { loadOgCjkFonts } = await import(
  "data:text/javascript;base64," + Buffer.from(javascript).toString("base64")
);

test("English OG text does not request a Chinese font", async t => {
  const fetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("Unexpected font request");
  });
  assert.deepEqual(await loadOgCjkFonts("Mr.X's Blog"), []);
  assert.equal(fetch.mock.callCount(), 0);
});

test("Chinese OG fonts contain both weights and reuse a character subset", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async url => {
    calls.push(String(url));
    const parsed = new URL(url);
    if (parsed.hostname === "fonts.googleapis.com") {
      assert.equal(parsed.searchParams.get("text"), "年日月");
      const weight = parsed.searchParams.get("family").split("@")[1];
      return new Response(
        "src: url(https://fonts.gstatic.com/fixture-" +
          weight +
          ".ttf) format('truetype');"
      );
    }
    return new Response(new Uint8Array([0, 1, 2, 3]));
  });
  const first = loadOgCjkFonts("年月日年");
  const second = loadOgCjkFonts("日月年");
  assert.strictEqual(first, second);
  const fonts = await first;
  assert.deepEqual(
    fonts.map(font => font.weight),
    [400, 700]
  );
  assert.ok(fonts.every(font => font.name === "Noto Sans SC"));
  assert.equal(calls.length, 4);
});

test("font HTTP failures abort rather than silently generating missing glyphs", async t => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("", { status: 503 })
  );
  await assert.rejects(loadOgCjkFonts("中文测试"), /font CSS: 503/);
});
