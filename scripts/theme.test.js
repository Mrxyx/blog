import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

async function themeHarness(enabled) {
  const attributes = new Map();
  const classes = new Set();
  const events = new Map();
  const mediaEvents = new Map();
  const buttonEvents = new Map();
  const storage = new Map([["theme", "dark"]]);
  let reads = 0;
  const root = {
    setAttribute: (name, value) => attributes.set(name, value),
    classList: {
      toggle: (name, value) =>
        value ? classes.add(name) : classes.delete(name),
    },
  };
  const media = {
    matches: true,
    addEventListener: (name, handler) => mediaEvents.set(name, handler),
  };
  const context = vm.createContext({
    lightAndDarkMode: enabled,
    localStorage: {
      getItem: name => {
        reads++;
        return storage.get(name);
      },
      setItem: (name, value) => storage.set(name, value),
    },
    window: {
      matchMedia: () => media,
      getComputedStyle: () => ({ backgroundColor: "rgb(253, 253, 253)" }),
    },
    document: {
      firstElementChild: root,
      body: {},
      querySelector: selector =>
        selector === "#theme-btn"
          ? enabled
            ? {
                setAttribute: () => {},
                addEventListener: (name, handler) =>
                  buttonEvents.set(name, handler),
              }
            : null
          : {
              setAttribute: () => {},
              getAttribute: () => null,
            },
      addEventListener: (name, handler) => events.set(name, handler),
    },
  });
  const layout = await fs.readFile(
    new URL("../src/layouts/Layout.astro", import.meta.url),
    "utf8"
  );
  const inline = layout.match(
    /<script\b[^>]*define:vars[^>]*>([\s\S]*?)<\/script>/
  )?.[1];
  assert.ok(inline, "The theme must be set before the browser paints");
  vm.runInContext(inline, context);
  const source = await fs.readFile(
    new URL("../src/scripts/theme.ts", import.meta.url),
    "utf8"
  );
  const runtime = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInContext(runtime, context);
  return {
    attributes,
    classes,
    events,
    mediaEvents,
    buttonEvents,
    storage,
    reads: () => reads,
  };
}

test("disabled theme toggle stays light with stored dark theme and dark OS", async () => {
  const h = await themeHarness(false);
  assert.equal(h.attributes.get("data-theme"), "light");
  assert.equal(h.classes.has("dark"), false);
  assert.equal(h.reads(), 0);
  assert.equal(h.mediaEvents.size, 0);
  h.attributes.set("data-theme", "dark");
  h.classes.add("dark");
  h.events.get("astro:after-swap")();
  assert.equal(h.attributes.get("data-theme"), "light");
  assert.equal(h.classes.has("dark"), false);
  assert.equal(h.storage.get("theme"), "dark");
});

test("enabled theme toggle still supports clicks and OS changes", async () => {
  const h = await themeHarness(true);
  assert.equal(h.attributes.get("data-theme"), "dark");
  h.buttonEvents.get("click")();
  assert.equal(h.attributes.get("data-theme"), "light");
  assert.equal(h.storage.get("theme"), "light");
  h.mediaEvents.get("change")({ matches: true });
  assert.equal(h.attributes.get("data-theme"), "dark");
  assert.equal(h.storage.get("theme"), "dark");
});
