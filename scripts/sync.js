import fs from 'fs-extra';
import path from 'path';
import matter from 'gray-matter';
import { fileURLToPath } from 'url';

// --- ESM 环境下需要手动定义 __dirname ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ================= ⚠️ 核心配置区 (请根据实际情况修改) =================

const CONFIG = {
    obsidianPostsDir: '/Users/mrx/Library/CloudStorage/OneDrive-llanan/Private/Mrx/Blog_Ready',

    obsidianAttachmentsDir: '/Users/mrx/Library/CloudStorage/OneDrive-llanan/Private/Mrx/Attachments',

    astroPostsDir: 'src/data/blog', 

    astroImagesDir: 'src/assets/images',
};

// ===================================================================

const ROOT_DIR = path.resolve(__dirname, '..');
const DEST_POSTS = path.join(ROOT_DIR, CONFIG.astroPostsDir);
const DEST_IMAGES = path.join(ROOT_DIR, CONFIG.astroImagesDir);

async function sync() {
    console.log(`🚀 正在从 [${CONFIG.obsidianPostsDir}] 同步文章...`);

    // 1. 检查目标目录是否存在
    await fs.ensureDir(DEST_POSTS);
    await fs.ensureDir(DEST_IMAGES);

    // 2. 清空 Astro 文章目录
    await fs.emptyDir(DEST_POSTS);

    // 3. 读取 Obsidian 目录
    let files;
    try {
        files = await fs.readdir(CONFIG.obsidianPostsDir);
    } catch (e) {
        console.error(`❌ 错误：找不到 Obsidian 目录 "${CONFIG.obsidianPostsDir}"`);
        return;
    }

    const mdFiles = files.filter(f => f.endsWith('.md'));
    let count = 0;

    for (const file of mdFiles) {
        const srcPath = path.join(CONFIG.obsidianPostsDir, file);
        const fileContent = await fs.readFile(srcPath, 'utf-8');
        
        // 解析 Front-matter
        const { data, content } = matter(fileContent);

        // === 图片搬运逻辑 ===
        // 匹配 ![[image.png]] 或 ![[image.png|100]]
        const imageRegex = /!\[\[(.*?)(?:\|.*?)?\]\]/g;
        
        const newContent = content.replace(imageRegex, (match, fileName) => {
            const srcImgPath = path.join(CONFIG.obsidianAttachmentsDir, fileName);
            const destImgPath = path.join(DEST_IMAGES, fileName);

            // 如果图片存在，复制并替换链接
            if (fs.existsSync(srcImgPath)) {
                fs.copySync(srcImgPath, destImgPath);
                // ⚠️ 注意：引用 src/assets 下的图片，Astro 推荐使用相对路径或别名
                // 这里我们使用相对路径，假设 Markdown 在 src/content/blog，图片在 src/assets/images
                // 需要回退两层找到 assets: ../../assets/images/
                return `![${fileName}](../../assets/images/${fileName})`;
            } else {
                console.warn(`⚠️  [${file}] 缺图: ${fileName}`);
                return match; // 保持原样
            }
        });

// === Front-matter 格式化 ===
const newData = {
    title: data.title || file.replace('.md', ''),
    author: data.author || 'Mr.X',
    
    // 🔴 关键修改：去掉 .toISOString()
    // 让 matter.stringify 直接处理 Date 对象，这样生成的 YAML 不会有引号
    pubDatetime: data.date ? new Date(data.date) : new Date(),
    
    description: data.description || newContent.slice(0, 100).replace(/[#*`]/g, '') + '...',
    tags: data.tags || [],
    featured: data.featured || false,
    draft: data.draft || false
};
        
        // 保留 slug 如果有
        if (data.slug) newData.slug = data.slug;

        // 写入新文件
        const newFileContent = matter.stringify(newContent, newData);
        await fs.writeFile(path.join(DEST_POSTS, file), newFileContent);
        count++;
    }

    console.log(`✅ 同步完成！共处理 ${count} 篇文章。`);
    console.log(`📂 文章位置: ${DEST_POSTS}`);
    console.log(`🖼️ 图片位置: ${DEST_IMAGES}`);
}

sync().catch(console.error);