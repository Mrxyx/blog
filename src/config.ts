export const SITE = {
  website: "https://www.mrxyx.cn/",
  author: "Mrx",
  profile: "https://github.com/Mrxyx",
  desc: "记录我的学习、思考、生活",
  title: "Mr.X's Blog",
  ogImage: "astropaper-og.jpg",
  lightAndDarkMode: false,
  postPerIndex: 4,
  postPerPage: 4,
  scheduledPostMargin: 15 * 60 * 1000, // 15 minutes
  showArchives: true,
  showBackButton: true, // show back button in post detail
  editPost: {
    enabled: false,
    text: "Edit page",
    url: "",
  },
  dynamicOgImage: true,
  dir: "ltr", // "rtl" | "auto"
  lang: "zh-CN",
  timezone: "Asia/Shanghai",
} as const;
