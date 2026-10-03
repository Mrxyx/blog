import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { load, JSON_SCHEMA } from "js-yaml";
import { format, resolveConfig } from "prettier";
import { parsers } from "prettier/plugins/markdown";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_OBSIDIAN_ROOT =
  "/Users/mrx/Library/CloudStorage/Dropbox/OneDrive/Mrx";
const SOURCE_DIRS = ["Notes", "Daily", "Inbox"];
const MANIFEST = ".obsidian-sync.json";
export const POSTS_DIRECTORY = "src/data/blog";

function parseFrontmatter(text) {
  const unsupported = () => {
    throw new Error("Obsidian 笔记只支持 YAML frontmatter");
  };
  return matter(text, {
    engines: {
      // Keep dates as strings so invalid calendar dates cannot be normalized.
      yaml: source => load(source, { schema: JSON_SCHEMA }),
      json: unsupported,
      javascript: unsupported,
    },
  });
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-\u4e00-\u9fa5]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function key(value) {
  return value.normalize("NFC").toLowerCase();
}

function safeRelative(value) {
  if (
    typeof value !== "string" ||
    !value ||
    path.posix.isAbsolute(value) ||
    value.includes("\\") ||
    value.split("/").some(part => !part || part === "." || part === "..")
  ) {
    throw new Error("无效的相对路径: " + value);
  }
  return value;
}

async function readDirectory(directory, optional = false) {
  let entries;
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory()) throw new Error("不是普通目录: " + directory);
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (optional && error.code === "ENOENT") return [];
    throw new Error("无法读取目录: " + directory, { cause: error });
  }
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) {
      throw new Error("不支持符号链接: " + path.join(directory, entry.name));
    }
    if (entry.isDirectory()) {
      for (const child of await readDirectory(
        path.join(directory, entry.name)
      )) {
        files.push(entry.name + "/" + child);
      }
    } else if (entry.isFile()) {
      files.push(entry.name);
    }
  }
  return files;
}

function validDate(value, file) {
  if (!(value instanceof Date) && typeof value !== "string") {
    throw new Error("[" + file + "] 日期必须是有效的 ISO 日期");
  }
  const date = new Date(value);
  const calendar =
    typeof value === "string"
      ? value.match(/^\d{4}-\d{2}-\d{2}(?=[Tt ]|$)/)?.[0]
      : undefined;
  if (
    Number.isNaN(date.getTime()) ||
    (calendar && new Date(calendar).toISOString().slice(0, 10) !== calendar)
  ) {
    throw new Error("[" + file + "] 无效日期: " + value);
  }
  return date;
}

function metadata(note, existing) {
  const { data, file } = note;
  let title = data.title ?? path.posix.basename(file, ".md");
  if (title instanceof Date) title = title.toISOString().slice(0, 10);
  if (typeof title !== "string" || !title.trim()) {
    throw new Error("[" + file + "] title 必须是非空字符串");
  }
  title = title.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1年$2月$3日");
  const slug = data.slug ?? existing?.slug ?? slugify(title);
  if (typeof slug !== "string" || !slug || /[\s/\\?#%]/.test(slug)) {
    throw new Error("[" + file + "] slug 必须是非空的单段 URL");
  }
  const date = data.date ?? data.pubDatetime ?? existing?.pubDatetime;
  if (date == null) {
    throw new Error(
      "[" + file + "] 首次发布请设置 date，已有文章会保留发布日期"
    );
  }
  const author = data.author ?? "Mr.X";
  const tags = data.tags ?? [];
  const featured = data.featured ?? false;
  if (
    typeof author !== "string" ||
    !Array.isArray(tags) ||
    tags.some(tag => typeof tag !== "string") ||
    typeof featured !== "boolean" ||
    (data.description != null && typeof data.description !== "string")
  ) {
    throw new Error(
      "[" + file + "] 请检查 author、tags、featured、description 类型"
    );
  }
  return {
    title,
    author,
    pubDatetime: validDate(date, file),
    description: data.description,
    tags,
    featured,
    draft: false,
    slug,
  };
}

// Parse code positions so nested fences and indented examples are protected too.
async function outsideCode(content, transform) {
  const tree = await parsers.markdown.parse(content);
  const ranges = [];
  function visit(node) {
    if (["code", "inlineCode", "html"].includes(node.type)) {
      ranges.push([node.position.start.offset, node.position.end.offset]);
      return;
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(tree);
  ranges.sort((a, b) => a[0] - b[0]);
  let result = "";
  let offset = 0;
  for (const [start, end] of ranges) {
    result +=
      transform(content.slice(offset, start)) + content.slice(start, end);
    offset = end;
  }
  return result + transform(content.slice(offset));
}

function addAlias(index, alias, value) {
  const normalized = key(alias);
  const values = index.get(normalized) ?? new Set();
  values.add(value);
  index.set(normalized, values);
}

function resolveAlias(index, target, file, type) {
  const matches = index.get(key(target));
  if (!matches?.size)
    throw new Error("[" + file + "] " + type + "不存在: " + target);
  if (matches.size !== 1)
    throw new Error("[" + file + "] " + type + "名称重复: " + target);
  return [...matches][0];
}

function changes(existing, next, managed = [...existing.keys()]) {
  const added = [];
  const changed = [];
  const deleted = managed.filter(file => existing.has(file) && !next.has(file));
  for (const [file, content] of next) {
    if (!existing.has(file)) added.push(file);
    else if (!existing.get(file).equals(content)) changed.push(file);
  }
  return { added, changed, deleted };
}

export async function planSync({
  projectRoot = PROJECT_ROOT,
  obsidianRoot = process.env.OBSIDIAN_ROOT || DEFAULT_OBSIDIAN_ROOT,
} = {}) {
  const postsDir = path.join(projectRoot, POSTS_DIRECTORY);
  const imagesDir = path.join(projectRoot, "src/assets/images");
  const assetsDir = path.join(obsidianRoot, "Assets");
  const currentPosts = new Map();
  const currentImages = new Map();
  for (const [directory, files] of [
    [postsDir, currentPosts],
    [imagesDir, currentImages],
  ]) {
    for (const file of await readDirectory(directory, true)) {
      files.set(file, await fs.readFile(path.join(directory, file)));
    }
  }
  const manifestContent = currentPosts.get(MANIFEST);
  const manifest = manifestContent
    ? JSON.parse(manifestContent.toString())
    : { version: 1, images: [] };
  if (manifest.version !== 1 || !Array.isArray(manifest.images)) {
    throw new Error("无效的 Obsidian 同步清单");
  }
  manifest.images.forEach(safeRelative);

  const notes = [];
  const noteIndex = new Map();
  const assetIndex = new Map();
  for (const directory of SOURCE_DIRS) {
    for (const file of await readDirectory(
      path.join(obsidianRoot, directory)
    )) {
      if (
        !file.endsWith(".md") ||
        file.split("/").some(p => p.startsWith("."))
      ) {
        continue;
      }
      const text = await fs.readFile(
        path.join(obsidianRoot, directory, file),
        "utf8"
      );
      const { data, content } = parseFrontmatter(text);
      const note = { file, directory, data, content };
      notes.push(note);
      for (const alias of [
        path.posix.basename(file, ".md"),
        file.slice(0, -3),
        directory + "/" + file.slice(0, -3),
      ]) {
        addAlias(noteIndex, alias, note);
      }
    }
  }
  for (const file of await readDirectory(assetsDir)) {
    addAlias(assetIndex, file, file);
    addAlias(assetIndex, path.posix.basename(file), file);
  }

  const published = notes.filter(note => note.data.isPublished === true);
  const filenames = new Set();
  const slugs = new Set();
  for (const note of published) {
    note.destination = path.posix.basename(note.file);
    if (note.destination.startsWith("_")) {
      throw new Error("[" + note.file + "] Astro 不收录以 _ 开头的文章文件");
    }
    if (filenames.has(key(note.destination))) {
      throw new Error("已发布笔记文件名重复: " + note.destination);
    }
    filenames.add(key(note.destination));
    const previous = currentPosts.get(note.destination);
    note.metadata = metadata(
      note,
      previous ? parseFrontmatter(previous.toString()).data : undefined
    );
    if (slugs.has(key(note.metadata.slug))) {
      throw new Error("已发布文章 slug 重复: " + note.metadata.slug);
    }
    slugs.add(key(note.metadata.slug));
  }

  const posts = new Map();
  const images = new Map();
  const formatOptions = await resolveConfig(path.join(postsDir, "post.md"));
  for (const note of published) {
    const content = await outsideCode(note.content, text =>
      text.replace(/(?<!\\)(!?)\[\[([^\]\n]+)\]\]/g, (_, embed, value) => {
        const [target, alias] = value.split("|");
        if (embed) {
          const file = resolveAlias(assetIndex, target, note.file, "附件");
          safeRelative(file);
          if (!/\.(avif|gif|jpe?g|png|svg|tiff?|webp)$/i.test(file)) {
            throw new Error("[" + note.file + "] 暂只支持图片嵌入: " + target);
          }
          images.set(file, null);
          const url = file.split("/").map(encodeURIComponent).join("/");
          const label = path.posix.basename(file).replace(/[\[\]]/g, "");
          return "![" + label + "](../../assets/images/" + url + ")";
        }
        if (target.includes("#")) {
          throw new Error(
            "[" + note.file + "] 暂不支持标题或块引用: " + target
          );
        }
        const linked = resolveAlias(
          noteIndex,
          target.replace(/\.md$/, ""),
          note.file,
          "笔记"
        );
        if (!linked.metadata) {
          throw new Error("[" + note.file + "] 双链目标未发布: " + target);
        }
        const label = (alias || target).replace(/[\[\]]/g, "");
        return (
          "[" +
          label +
          "](/posts/" +
          encodeURIComponent(linked.metadata.slug) +
          ")"
        );
      })
    );
    const data = {
      ...note.metadata,
      description:
        note.metadata.description ||
        content.slice(0, 100).replace(/[#*\x60\[\]]/g, "") + "...",
    };
    const output = await format(matter.stringify(content, data), {
      ...formatOptions,
      parser: "markdown",
    });
    posts.set(note.destination, Buffer.from(output));
  }
  for (const file of images.keys()) {
    images.set(file, await fs.readFile(path.join(assetsDir, file)));
  }
  const nextManifest = Buffer.from(
    JSON.stringify({ version: 1, images: [...images.keys()].sort() }, null, 2) +
      "\n"
  );
  const existingArticles = new Map(
    [...currentPosts].filter(([file]) => file.endsWith(".md"))
  );
  return {
    projectRoot,
    postsDir,
    imagesDir,
    currentPosts,
    currentImages,
    posts,
    images,
    nextManifest,
    postChanges: changes(existingArticles, posts),
    imageChanges: changes(currentImages, images, manifest.images),
    skipped: notes.length - published.length,
  };
}

async function assertCurrentDirectories(plan) {
  for (const [directory, expected] of [
    [plan.postsDir, plan.currentPosts],
    [plan.imagesDir, plan.currentImages],
  ]) {
    const files = await readDirectory(directory, true);
    if (files.length !== expected.size)
      throw new Error("目录已变化，请重新同步: " + directory);
    for (const file of files) {
      if (
        !expected
          .get(file)
          ?.equals(await fs.readFile(path.join(directory, file)))
      ) {
        throw new Error("文件已变化，请重新同步: " + file);
      }
    }
  }
}

export async function applyPlan(plan) {
  const lockPath = path.join(plan.projectRoot, ".obsidian-sync.lock");
  const lock = await fs.open(lockPath, "wx").catch(error => {
    throw new Error("无法取得同步锁，请检查是否有同步正在运行", {
      cause: error,
    });
  });
  let staging;
  let cleanup = true;
  const replacements = [];
  try {
    await assertCurrentDirectories(plan);
    const unchanged = [plan.postChanges, plan.imageChanges].every(differences =>
      Object.values(differences).every(files => files.length === 0)
    );
    if (
      unchanged &&
      plan.currentPosts.get(MANIFEST)?.equals(plan.nextManifest)
    ) {
      return;
    }
    staging = await fs.mkdtemp(path.join(plan.projectRoot, ".obsidian-sync-"));
    for (const [name, destination, files, deleted] of [
      ["posts", plan.postsDir, plan.posts, plan.postChanges.deleted],
      ["images", plan.imagesDir, plan.images, plan.imageChanges.deleted],
    ]) {
      const staged = path.join(staging, name);
      await fs.ensureDir(staged);
      if (await fs.pathExists(destination)) await fs.copy(destination, staged);
      for (const file of deleted) await fs.remove(path.join(staged, file));
      for (const [file, content] of files)
        await fs.outputFile(path.join(staged, file), content);
      if (name === "posts")
        await fs.outputFile(path.join(staged, MANIFEST), plan.nextManifest);
      replacements.push({
        destination,
        staged,
        backup: path.join(staging, "old-" + name),
        backedUp: false,
        installed: false,
      });
    }
    // Check again after staging so edits made during the copy are not lost.
    await assertCurrentDirectories(plan);
    try {
      for (const replacement of replacements) {
        await fs.ensureDir(path.dirname(replacement.destination));
        if (await fs.pathExists(replacement.destination)) {
          await fs.rename(replacement.destination, replacement.backup);
          replacement.backedUp = true;
        }
        await fs.rename(replacement.staged, replacement.destination);
        replacement.installed = true;
      }
    } catch (error) {
      try {
        for (const replacement of [...replacements].reverse()) {
          if (replacement.installed) await fs.remove(replacement.destination);
          if (replacement.backedUp)
            await fs.rename(replacement.backup, replacement.destination);
        }
      } catch (rollbackError) {
        cleanup = false;
        throw new Error("回滚失败，旧文件保存在 " + staging, {
          cause: new AggregateError([error, rollbackError]),
        });
      }
      throw error;
    }
  } finally {
    try {
      if (staging && cleanup) await fs.remove(staging);
    } finally {
      await fs.close(lock);
      await fs.remove(lockPath);
    }
  }
}

function report(plan, dryRun) {
  process.stdout.write(
    (dryRun ? "预览（未写入文件）" : "本地同步完成") +
      ": " +
      plan.posts.size +
      " 篇，跳过 " +
      plan.skipped +
      " 篇\n"
  );
  for (const [label, differences] of [
    ["文章", plan.postChanges],
    ["图片", plan.imageChanges],
  ]) {
    for (const [action, files] of Object.entries(differences)) {
      for (const file of files)
        process.stdout.write("  " + label + " " + action + ": " + file + "\n");
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    process.stdout.write(
      "用法: npm run obsidian -- [--dry-run]\n可用 OBSIDIAN_ROOT 环境变量覆盖笔记根路径。\n"
    );
    return;
  }
  if (args.some(arg => arg !== "--dry-run"))
    throw new Error("未知参数，请使用 --help 查看用法");
  const dryRun = args.includes("--dry-run");
  const plan = await planSync();
  if (!dryRun) await applyPlan(plan);
  report(plan, dryRun);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(error => {
    process.stderr.write("同步失败: " + error.message + "\n");
    if (error.cause)
      process.stderr.write("原因: " + error.cause.message + "\n");
    process.exitCode = 1;
  });
}
