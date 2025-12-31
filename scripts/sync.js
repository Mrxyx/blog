import fs from 'fs-extra';
import path from 'path';
import matter from 'gray-matter';
import { fileURLToPath } from 'url';

// --- ESM 环境下需要手动定义 __dirname ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ================= ⚠️ 核心配置区 (请核对路径) =================

// 基础路径提取 (根据你提供的 OneDrive 路径)
const OBSIDIAN_ROOT = '/Users/mrx/Library/CloudStorage/OneDrive-llanan/Private/Mrx';

const CONFIG = {
    // 1. 🟢 源目录 (数组)：支持扫描多个文件夹
    obsidianSourceDirs: [
        path.join(OBSIDIAN_ROOT, 'Notes'),  // 你的核心笔记
        path.join(OBSIDIAN_ROOT, 'Daily'),  // 你的日记
        path.join(OBSIDIAN_ROOT, 'Inbox'),  // 你的收集箱
        // 如果还有其他文件夹想发布，可以继续加，比如: path.join(OBSIDIAN_ROOT, 'Maps'),
    ],

    // 2. 🟢 附件目录 (保持你原来的配置)
    obsidianAttachmentsDir: path.join(OBSIDIAN_ROOT, 'Assets'),

    // 3. 🔵 Astro 博客相关 (保持不变)
    astroPostsDir: 'src/data/blog', 
    astroImagesDir: 'src/assets/images',
};

// ===================================================================

const ROOT_DIR = path.resolve(__dirname, '..');
const DEST_POSTS = path.join(ROOT_DIR, CONFIG.astroPostsDir);
const DEST_IMAGES = path.join(ROOT_DIR, CONFIG.astroImagesDir);

// 辅助函数：生成 URL slug (用于处理中文标题的双链跳转)
function slugify(text) {
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-\u4e00-\u9fa5]+/g, '') // 保留中文、英文、数字
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
}

async function sync() {
    console.log(`🚀 开始多目录同步...`);
    console.log(`📂 扫描范围:`, CONFIG.obsidianSourceDirs);

    // 1. 准备目标目录
    await fs.ensureDir(DEST_POSTS);
    await fs.ensureDir(DEST_IMAGES);

    // 2. 清空 Astro 文章目录 (确保删除的文章也会同步消失)
    await fs.emptyDir(DEST_POSTS);

    let processCount = 0;
    let skipCount = 0;

    // 🔄 外层循环：遍历每一个配置的源目录
    for (const sourceDir of CONFIG.obsidianSourceDirs) {
        let files;
        try {
            if (!fs.existsSync(sourceDir)) {
                console.warn(`⚠️  警告: 目录不存在，跳过 -> ${sourceDir}`);
                continue;
            }
            files = await fs.readdir(sourceDir);
        } catch (e) {
            console.error(`❌ 读取目录失败: ${sourceDir}`, e);
            continue;
        }

        const mdFiles = files.filter(f => f.endsWith('.md'));

        for (const file of mdFiles) {
            const srcPath = path.join(sourceDir, file);
            const fileContent = await fs.readFile(srcPath, 'utf-8');
            
            // 解析 Front-matter
            const { data, content } = matter(fileContent);

            // 🛑 核心过滤：没有 isPublished: true 就跳过
            if (!data.isPublished) {
                skipCount++;
                continue;
            }

            let finalContent = content;

            // === 1. 图片搬运: ![[image.png]] -> ![image](../../assets/images/image.png) ===
            const imageRegex = /!\[\[(.*?)(?:\|.*?)?\]\]/g;
            finalContent = finalContent.replace(imageRegex, (match, fileName) => {
                const srcImgPath = path.join(CONFIG.obsidianAttachmentsDir, fileName);
                const destImgPath = path.join(DEST_IMAGES, fileName);

                if (fs.existsSync(srcImgPath)) {
                    fs.copySync(srcImgPath, destImgPath);
                    // 使用相对路径指向 src/assets/images
                    return `![${fileName}](../../assets/images/${fileName})`;
                } else {
                    console.warn(`⚠️  [${file}] 缺图: ${fileName}`);
                    return match; 
                }
            });

            // === 2. 双链转换: [[笔记名]] -> [笔记名](/posts/slug) ===
            const linkRegex = /\[\[(.*?)\]\]/g;
            finalContent = finalContent.replace(linkRegex, (match, linkText) => {
                const parts = linkText.split('|');
                const noteName = parts[0]; // 笔记文件名
                const alias = parts[1] || parts[0]; // 显示文本
                const urlSlug = slugify(noteName); // 转换成 URL
                return `[${alias}](/posts/${urlSlug})`;
            });

            // === 3. Front-matter 重组 ===
            
            // 🛠️ 修复标题类型错误：处理日记文件名 (2025-12-31) 被识别为日期的问题
            let finalTitle = data.title || file.replace('.md', '');
            
            // 如果从 Obsidian 读出来的 title 已经是 Date 对象了，先转回字符串
            if (finalTitle instanceof Date) {
                finalTitle = finalTitle.toISOString().split('T')[0];
            }
            finalTitle = String(finalTitle);

            if (/^\d{4}-\d{2}-\d{2}$/.test(finalTitle)) {
                const [y, m, d] = finalTitle.split('-');
                finalTitle = `${y}年${m}月${d}日`;
            }

            const newData = {
                title: finalTitle,  // <--- 这里使用处理后的标题
                author: data.author || 'Mr.X',
                
                // 修复日期对象问题
                pubDatetime: data.date ? new Date(data.date) : new Date(),
                
                description: data.description || finalContent.slice(0, 100).replace(/[#*`\[\]]/g, '') + '...',
                tags: data.tags || [],
                featured: data.featured || false,
                draft: false // 既然有 isPublished，这里强制设为 false
            };
            
            // 显式处理 slug，这对双链跳转很重要
            if (data.slug) {
                newData.slug = data.slug;
            } else {
                newData.slug = slugify(newData.title);
            }

            // 写入新文件
            const newFileContent = matter.stringify(finalContent, newData);
            await fs.writeFile(path.join(DEST_POSTS, file), newFileContent);
            processCount++;
        }
    }

    console.log(`-----------------------------------`);
    console.log(`✅ 同步完成！`);
    console.log(`📥 已发布: ${processCount} 篇`);
    console.log(`🙈 已忽略: ${skipCount} 篇 (未标记 isPublished)`);
    console.log(`📂 文章位置: ${DEST_POSTS}`);
}

sync().catch(console.error);