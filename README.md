# Mr.X's Blog

个人博客：[www.mrxyx.cn](https://www.mrxyx.cn/)。
使用 [AstroPaper](https://github.com/satnaing/astro-paper) 6.1.0 主题，基于 Astro 6，
从 Obsidian 同步公开笔记，提交到 GitHub 后由 Cloudflare Pages 自动部署。

## 日常发布

使用 Node 24 LTS（.nvmrc 已指定版本，CI 与 Cloudflare 使用同一主版本），再安装依赖：

```bash
nvm install
nvm use
npm ci
```

在 Obsidian 笔记的 YAML 属性中设置：

```yaml
---
title: 我的文章
date: 2026-10-03
isPublished: true
tags:
  - 随笔
description: 文章简介
# 可选；设置后可以在修改标题时保持文章地址稳定
slug: my-post
---
```

预览同步清单，然后同步并构建：

```bash
npm run obsidian -- --dry-run
npm run blog:prepare
```

检查文章、图片和删除记录，再提交并发布：

```bash
git status --short
git diff
git add src/content/posts src/assets/images
git commit -m "docs: 更新博客文章"
git push origin main
```

Cloudflare Pages 的生产分支是 main，构建命令为 npm run build，产物目录为 dist。
推送后，在 Cloudflare 的 blog 项目 Deployments 页面检查对应提交的构建和部署结果。

blog:prepare 只做本地同步与构建；commit 和 push 由你执行。
第一次修改脚本、配置或文档时，也需要把相应文件加入提交。

## Obsidian 同步规则

默认笔记根目录在 scripts/sync.js 中，当前为：

```
/Users/mrx/Library/CloudStorage/Dropbox/OneDrive/Mrx
```

可以通过环境变量临时覆盖，无需修改脚本：

```bash
OBSIDIAN_ROOT="/path/to/vault" npm run obsidian -- --dry-run
```

- 递归扫描 Notes、Daily、Inbox 的 Markdown 文件，附件来自 Assets。
- 只有布尔值 isPublished: true 才会发布；带引号的 "true"、"false" 均不发布。
- 首次发布必须提供有效的 date 或 pubDatetime；已有文章缺省时保留原发布日期。
- slug 优先使用笔记的自定义值，再保留已有文章的值，首次发布默认按标题生成。
- 文章统一写入 src/content/posts，保持原文件名；不同目录的同名公开笔记、重复 slug 会报错。
- src/content/posts 的 Markdown 文件是同步产物，手动写入的文章也会在下次同步时被删除。
- 图片嵌入 ![[图片.png]] 会复制附件并转换路径，支持附件子目录和空格文件名；接受 Obsidian 尺寸语法，但尺寸参数不会带入博客。
- 双链 [[笔记名|显示文本]] 按目标的实际 slug 转换；同名目标可用 [[Notes/子目录/笔记名]] 指定。
- 不存在或未发布的双链、缺图、无效元数据均会中止同步，不会留下半套文章。
- 代码块、行内代码和转义的双链示例保持原样。
- 当前不支持笔记嵌入、标题／块双链引用及符号链接，遇到时会明确报错。
- 普通 Markdown 链接和图片路径不会自动搬运，Obsidian 附件请使用图片嵌入语法。
- 取消 isPublished 或删除源笔记后，下次同步会删除对应的博客文章。
- src/content/posts/.obsidian-sync.json 记录本脚本管理的图片，应随文章提交。后续同步会删除这些图片中不再被引用的文件，保留主题资源与未登记图片。首次运行前的遗留图片不会自动清理。

同步先完整读取和校验输入，再在临时目录准备结果，最后替换文章与图片目录。
替换失败会尝试回滚；回滚也失败时，错误信息会指出保存旧文件的临时目录。
同一仓库同时只能有一个同步进程。若进程被强制结束留下 .obsidian-sync.lock，
确认没有同步进程后再删除锁文件；若存在 .obsidian-sync-\* 临时目录，先检查和恢复其中的备份。

## 常用命令

| 命令                          | 用途                                       |
| ----------------------------- | ------------------------------------------ |
| npm run obsidian -- --dry-run | 只预览同步清单，不写入文件                 |
| npm run obsidian              | 同步 Obsidian 文章和图片                   |
| npm run blog:prepare          | 同步成功后再构建                           |
| npm run dev                   | 本地开发预览                               |
| npm run build                 | 类型检查、构建网站和搜索索引               |
| npm run preview               | 预览构建后的站点                           |
| npm test                      | 验证同步、主题与分享图字体，不依赖真实笔记 |
| npm run lint                  | 检查代码                                   |
| npm run format:check          | 检查格式                                   |
| npm run sync                  | Astro 类型同步，与 Obsidian 同步无关       |

GitHub Actions 的 PR 检查使用 npm ci、同步测试、lint、格式检查和构建。
线上部署只运行 build，不依赖本地 Obsidian 路径。
Cloudflare 支持按根目录 .nvmrc 选择 Node 版本；若后台单独设置了 NODE_VERSION，须与本仓库保持一致。
构建产物 dist、public/pagefind 已被 Git 忽略，无需提交。

## 主题来源与更新

主题上游是 [satnaing/astro-paper](https://github.com/satnaing/astro-paper)。
本仓库由 Astro 模板初始化，是独立仓库，没有保留上游的 Git 历史或 GitHub fork 关系。

登记上游后可查看它的版本：

```bash
git remote get-url upstream
# 尚未登记 upstream 时才执行：
# git remote add upstream https://github.com/satnaing/astro-paper.git
git fetch upstream --tags
```

依赖更新与主题源码更新分开处理，npm update 不会更新主题组件。
小范围修复在分支中按需移植；跨大版本按
[官方升级说明](https://github.com/satnaing/astro-paper/wiki/Upgrading)迁移，
保留本站配置、文章、同步脚本、首页和亮色主题改动。

当前已迁移到官方 v6.1.0：

- 本站设置集中在根目录 astro-paper.config.ts；src/config.ts 只负责补默认值。
- 文章集合为 posts，文章在 src/content/posts；About 在 src/content/pages/about.md。
- 同步脚本已跟随新目录迁移；目录层级相同，图片相对路径仍为 ../../assets/images。
- 保留首页文章列表、个人 favicon、GitHub／邮箱／RSS 链接和强制亮色主题。
- 保留文章独立作者元数据，RSS 自动发现使用无尾斜杠的 /rss.xml 路径。
- 支持主题提供的 MDX、Obsidian callout 与文章图片灯箱；同步源仍为 Markdown。
- 动态分享图按实际文字加载 Noto Sans SC 子集，避免中文标题显示方框；字体只在构建时下载。
- Astro 字体 API 将网页字体存入构建产物，访问网站时不需要连接 Google Fonts。

后续升级仍在独立分支中迁移、构建与预览，通过后再合并到 main。
由于没有共同历史，不建议直接把上游 main 强行合并到当前仓库。
