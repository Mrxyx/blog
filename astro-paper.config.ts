import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://www.mrxyx.cn/",
    title: "Mr.X's Blog",
    description: "记录我的学习、思考、生活",
    author: "Mrx",
    profile: "https://github.com/Mrxyx",
    ogImage: "astropaper-og.jpg",
    lang: "zh-CN",
    timezone: "Asia/Shanghai",
    dir: "ltr",
  },
  posts: {
    perPage: 4,
    perIndex: 4,
    scheduledPostMargin: 15 * 60 * 1000,
  },
  features: {
    lightAndDarkMode: false,
    dynamicOgImage: true,
    showArchives: true,
    showBackButton: true,
    editPost: { enabled: false },
    search: "pagefind",
  },
  socials: [
    {
      name: "github",
      url: "https://github.com/Mrxyx",
      linkTitle: "Mr.X's Blog on GitHub",
    },
    {
      name: "mail",
      url: "mailto:xiayanxinc@gmail.com",
      linkTitle: "Send an email to Mr.X's Blog",
    },
    { name: "rss", url: "/rss.xml", linkTitle: "RSS Feed" },
  ],
  shareLinks: [],
});
