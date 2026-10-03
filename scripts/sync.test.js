import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import fs from "fs-extra";
import matter from "gray-matter";
import sharp from "sharp";
import { applyPlan, planSync, POSTS_DIRECTORY } from "./sync.js";

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "blog-sync-test-"));
  t.after(() => fs.remove(directory));
  const projectRoot = path.join(directory, "blog");
  const obsidianRoot = path.join(directory, "vault");
  for (const folder of ["Notes", "Daily", "Inbox", "Assets"]) {
    await fs.ensureDir(path.join(obsidianRoot, folder));
  }
  await fs.ensureDir(path.join(projectRoot, POSTS_DIRECTORY));
  await fs.ensureDir(path.join(projectRoot, "src/assets/images"));
  return {
    directory,
    projectRoot,
    obsidianRoot,
    plan: () => planSync({ projectRoot, obsidianRoot }),
    note: (file, content = "正文", data = {}) =>
      fs.outputFile(
        path.join(obsidianRoot, file),
        matter.stringify(
          content,
          Object.fromEntries(
            Object.entries({
              isPublished: true,
              date: "2026-10-03",
              ...data,
            }).filter(([, value]) => value !== undefined)
          )
        )
      ),
  };
}

async function snapshot(directory) {
  const result = {};
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    result[entry.name] = entry.isDirectory()
      ? await snapshot(file)
      : (await fs.readFile(file)).toString("base64");
  }
  return result;
}

test("dry-run plans recursive notes without changing destination files", async t => {
  const f = await fixture(t);
  await f.note("Notes/folder/note.md");
  const before = await snapshot(f.projectRoot);
  const plan = await f.plan();
  assert.deepEqual(plan.postChanges.added, ["note.md"]);
  assert.deepEqual(await snapshot(f.projectRoot), before);
});

test("only boolean true publishes; strings and private notes stay out", async t => {
  const f = await fixture(t);
  for (const [name, isPublished] of [
    ["true", true],
    ["false", false],
    ["string-false", "false"],
    ["string-true", "true"],
  ]) {
    await f.note("Notes/" + name + ".md", "正文", { isPublished });
  }
  const plan = await f.plan();
  assert.deepEqual([...plan.posts.keys()], ["true.md"]);
  assert.equal(plan.skipped, 3);
});

test("wiki links use actual slugs, aliases and qualified paths", async t => {
  const f = await fixture(t);
  await f.note("Daily/2025-12-31.md", "目标");
  await f.note("Notes/different-name.md", "目标", {
    title: "不同的标题",
    slug: "stable-url",
  });
  await f.note(
    "Inbox/link.md",
    "[[2025-12-31|日记]] [[Notes/different-name.md|文章]]"
  );
  const plan = await f.plan();
  const output = matter(plan.posts.get("link.md").toString()).content;
  assert.ok(
    output.includes(
      "[日记](/posts/" + encodeURIComponent("2025年12月31日") + ")"
    )
  );
  assert.ok(output.includes("[文章](/posts/stable-url)"));
});

test("preserves existing date and URL when a published title changes", async t => {
  const f = await fixture(t);
  await f.note("Notes/note.md", "初稿", { slug: "old-url" });
  await applyPlan(await f.plan());
  await f.note("Notes/note.md", "修改", { date: undefined, title: "新标题" });
  const plan = await f.plan();
  const data = matter(plan.posts.get("note.md").toString()).data;
  assert.equal(data.slug, "old-url");
  assert.equal(data.pubDatetime.toISOString(), "2026-10-03T00:00:00.000Z");
  assert.equal(data.title, "新标题");
});

test("second sync is identical; unpublish removes managed images only", async t => {
  const f = await fixture(t);
  const image = Buffer.from("fixture image");
  const imagesDir = path.join(f.projectRoot, "src/assets/images");
  await fs.outputFile(
    path.join(f.obsidianRoot, "Assets/folder/my image.png"),
    image
  );
  await fs.outputFile(path.join(imagesDir, "theme.png"), "theme asset");
  await f.note("Notes/note.md", "![[my image.png|300]]");
  await applyPlan(await f.plan());
  assert.deepEqual(
    await fs.readFile(path.join(imagesDir, "folder/my image.png")),
    image
  );
  const second = await f.plan();
  for (const differences of [second.postChanges, second.imageChanges]) {
    assert.deepEqual(differences, { added: [], changed: [], deleted: [] });
  }
  const content = matter(second.posts.get("note.md").toString()).content;
  assert.ok(content.includes("../../assets/images/folder/my%20image.png"));
  await f.note("Notes/note.md", "", { isPublished: false });
  const unpublish = await f.plan();
  assert.deepEqual(unpublish.postChanges.deleted, ["note.md"]);
  assert.deepEqual(unpublish.imageChanges.deleted, ["folder/my image.png"]);
  await applyPlan(unpublish);
  assert.equal(
    await fs.pathExists(path.join(imagesDir, "folder/my image.png")),
    false
  );
  assert.equal(
    await fs.readFile(path.join(imagesDir, "theme.png"), "utf8"),
    "theme asset"
  );
});

test("preserves inline, fenced and escaped wiki examples", async t => {
  const f = await fixture(t);
  const tick = String.fromCharCode(96);
  const content = [
    tick + "[[Private]]" + tick,
    "",
    "    [[Private]]",
    "",
    "> " + tick.repeat(3) + "md",
    "> [[Private]] ![[missing.png]]",
    "> " + tick.repeat(3),
    "",
    tick.repeat(3) + "md",
    "[[Private]] ![[missing.png]]",
    tick.repeat(3),
    "~~~md",
    "[[Private]]",
    "~~~",
    "\\[[Private]]",
  ].join("\n");
  await f.note("Notes/examples.md", content);
  const plan = await f.plan();
  const output = matter(plan.posts.get("examples.md").toString()).content;
  assert.ok(output.includes(tick + "[[Private]]" + tick));
  assert.ok(output.includes("[[Private]] ![[missing.png]]"));
  assert.ok(output.includes("> [[Private]] ![[missing.png]]"));
  assert.ok(output.includes("\\[[Private]]"));
  assert.ok(!output.includes("/posts/"));
});

test("missing source directories leave previous articles and images intact", async t => {
  const f = await fixture(t);
  await f.note("Notes/note.md");
  await applyPlan(await f.plan());
  const before = await snapshot(f.projectRoot);
  await fs.remove(path.join(f.obsidianRoot, "Daily"));
  await assert.rejects(f.plan(), /无法读取目录/);
  assert.deepEqual(await snapshot(f.projectRoot), before);
});

test("invalid metadata and YAML fail before writes", async t => {
  for (const data of [
    { date: undefined },
    { date: "not-a-date" },
    { date: "2026-02-30" },
    { tags: "tag" },
    { featured: "false" },
    { slug: "../unsafe" },
    { title: "" },
  ]) {
    const f = await fixture(t);
    await f.note("Notes/note.md", "正文", data);
    const before = await snapshot(f.projectRoot);
    await assert.rejects(f.plan());
    assert.deepEqual(await snapshot(f.projectRoot), before);
  }
  const f = await fixture(t);
  await fs.outputFile(
    path.join(f.obsidianRoot, "Notes/broken.md"),
    "---\ntags: [broken\n---\n"
  );
  await assert.rejects(f.plan());
});

test("unquoted YAML dates and timestamps cannot hide invalid calendar days", async t => {
  const f = await fixture(t);
  for (const date of ["2026-02-30", "2026-02-30T08:00:00Z"]) {
    await fs.outputFile(
      path.join(f.obsidianRoot, "Notes/invalid.md"),
      "---\nisPublished: true\ndate: " + date + "\n---\n正文\n"
    );
    const before = await snapshot(f.projectRoot);
    await assert.rejects(f.plan(), /无效日期/);
    assert.deepEqual(await snapshot(f.projectRoot), before);
  }
});

test("non-YAML frontmatter is rejected without evaluating note contents", async t => {
  const f = await fixture(t);
  process.env.BLOG_SYNC_ENGINE_MARKER = "initial";
  t.after(() => delete process.env.BLOG_SYNC_ENGINE_MARKER);
  await fs.outputFile(
    path.join(f.obsidianRoot, "Notes/invalid.md"),
    "---javascript\n(process.env.BLOG_SYNC_ENGINE_MARKER='executed', {isPublished:true})\n---\n正文\n"
  );
  await assert.rejects(f.plan(), /只支持 YAML/);
  assert.equal(process.env.BLOG_SYNC_ENGINE_MARKER, "initial");
});

test("duplicate published filenames and slugs abort", async t => {
  const f = await fixture(t);
  await f.note("Notes/same.md");
  await f.note("Daily/same.md");
  await assert.rejects(f.plan(), /文件名重复/);
  await fs.remove(path.join(f.obsidianRoot, "Daily/same.md"));
  await f.note("Daily/other.md", "正文", { slug: "same" });
  await assert.rejects(f.plan(), /slug 重复/);
});

test("missing, private or ambiguous linked notes abort", async t => {
  const f = await fixture(t);
  await f.note("Notes/link.md", "[[Private]]");
  await assert.rejects(f.plan(), /笔记不存在/);
  await f.note("Daily/Private.md", "私密", { isPublished: false });
  await assert.rejects(f.plan(), /目标未发布/);
  await f.note("Inbox/Private.md", "同名私密", { isPublished: false });
  await assert.rejects(f.plan(), /名称重复/);
});

test("missing images and unsupported note embeds abort without writes", async t => {
  const f = await fixture(t);
  await f.note("Notes/note.md", "![[missing.png]]");
  const before = await snapshot(f.projectRoot);
  await assert.rejects(f.plan(), /附件不存在/);
  assert.deepEqual(await snapshot(f.projectRoot), before);
  await fs.outputFile(
    path.join(f.obsidianRoot, "Assets/private.md"),
    "private"
  );
  await f.note("Notes/note.md", "![[private.md]]");
  await assert.rejects(f.plan(), /暂只支持图片嵌入/);
});

test("rejects unsafe cleanup manifest paths", async t => {
  const f = await fixture(t);
  await fs.outputJson(
    path.join(f.projectRoot, POSTS_DIRECTORY, ".obsidian-sync.json"),
    {
      version: 1,
      images: ["../../../outside.png"],
    }
  );
  const before = await snapshot(f.projectRoot);
  await assert.rejects(f.plan(), /无效的相对路径/);
  assert.deepEqual(await snapshot(f.projectRoot), before);
});

test("stale plans cannot overwrite subsequent edits", async t => {
  const f = await fixture(t);
  await f.note("Notes/note.md");
  const plan = await f.plan();
  await fs.outputFile(
    path.join(f.projectRoot, POSTS_DIRECTORY, "manual.md"),
    "new edit"
  );
  const before = await snapshot(f.projectRoot);
  await assert.rejects(applyPlan(plan), /目录已变化/);
  assert.deepEqual(await snapshot(f.projectRoot), before);
});

test("failed image installation rolls back articles and images", async t => {
  const f = await fixture(t);
  await f.note("Notes/note.md", "old");
  await applyPlan(await f.plan());
  await f.note("Notes/note.md", "new");
  const plan = await f.plan();
  const before = await snapshot(f.projectRoot);
  const rename = fs.rename;
  t.mock.method(fs, "rename", async (from, to) => {
    if (from.endsWith("/images") && from.includes(".obsidian-sync-")) {
      throw new Error("simulated install failure");
    }
    return rename(from, to);
  });
  await assert.rejects(applyPlan(plan), /simulated install failure/);
  assert.deepEqual(await snapshot(f.projectRoot), before);
});

test("an active sync lock prevents writes", async t => {
  const f = await fixture(t);
  await f.note("Notes/note.md");
  const plan = await f.plan();
  await fs.outputFile(path.join(f.projectRoot, ".obsidian-sync.lock"), "");
  const before = await snapshot(f.projectRoot);
  await assert.rejects(applyPlan(plan), /无法取得同步锁/);
  assert.deepEqual(await snapshot(f.projectRoot), before);
});

test("CLI failures return a nonzero exit code; help does not need a vault", () => {
  const script = fileURLToPath(new URL("./sync.js", import.meta.url));
  const env = {
    ...process.env,
    OBSIDIAN_ROOT: "/missing-blog-sync-test-vault",
  };
  for (const args of [["--dry-run"], ["--unknown"]]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      env,
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /同步失败/);
  }
  const help = spawnSync(process.execPath, [script, "--help"], {
    env,
    encoding: "utf8",
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--dry-run/);
});

test("Astro builds synced images and links with real content collections", async t => {
  const f = await fixture(t);
  const png = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  await fs.outputFile(
    path.join(f.obsidianRoot, "Assets/插图 sample (1).png"),
    png
  );
  await f.note(
    "Notes/note.md",
    "![[插图 sample (1).png]]\n\n[[note|文章链接]]",
    { slug: "kept-url" }
  );
  await applyPlan(await f.plan());
  const project = fileURLToPath(new URL("..", import.meta.url));
  await fs.symlink(
    path.join(project, "node_modules"),
    path.join(f.projectRoot, "node_modules"),
    "dir"
  );
  await fs.outputJson(path.join(f.projectRoot, "package.json"), {
    type: "module",
  });
  await fs.outputFile(
    path.join(f.projectRoot, "src/content.config.ts"),
    'import {defineCollection} from "astro:content";\n' +
      'import {glob} from "astro/loaders";\n' +
      'export const collections = {posts: defineCollection({loader: glob({pattern: "**/*.md", base: "./' +
      POSTS_DIRECTORY +
      '"})})};\n'
  );
  await fs.outputFile(
    path.join(f.projectRoot, "src/pages/posts/[slug].astro"),
    '---\nimport {getCollection, render} from "astro:content";\n' +
      'export async function getStaticPaths(){return (await getCollection("posts")).map(post => ({params:{slug:post.id},props:{post}}));}\n' +
      "const {Content}=await render(Astro.props.post);\n---\n<html><body><Content /></body></html>\n"
  );
  const astroPackage = await fs.readJson(
    path.join(project, "node_modules/astro/package.json")
  );
  const result = spawnSync(
    process.execPath,
    [
      path.join(project, "node_modules/astro", astroPackage.bin.astro),
      "build",
      "--root",
      f.projectRoot,
    ],
    {
      cwd: f.projectRoot,
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
    }
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const html = await fs.readFile(
    path.join(f.projectRoot, "dist/posts/kept-url/index.html"),
    "utf8"
  );
  assert.match(html, /<img\b[^>]*src="\/_astro\//);
  assert.ok(html.includes('href="/posts/kept-url"'));
});
