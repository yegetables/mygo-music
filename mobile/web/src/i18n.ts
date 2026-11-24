const zh: Record<string, string> = {
  Home: "首页",
  Search: "搜索",
  Library: "音乐库",
  Settings: "设置",
  Plugins: "插件",
  "Liked Songs": "我喜欢的音乐",
  "Saved Albums": "收藏的专辑",
  Recent: "最近播放",
  Stations: "电台",
  Shows: "播客",
  Playlists: "歌单",
  "New Playlist": "新建歌单",
  "Install Plugin": "安装插件",
  "Sign In": "登录",
  "Sign Out": "退出登录",
  "Not signed in": "未登录",
  "Play All": "播放全部",
  "Add to Queue": "加入队列",
  "Add to Playlist": "添加到歌单",
  Lyrics: "歌词",
  Queue: "播放队列",
  Comments: "评论",
  "No lyrics": "暂无歌词",
  "No comments yet": "暂无评论",
  "Write a comment...": "写下你的评论...",
  Send: "发送",
  "Search songs, albums, artists...": "搜索歌曲、专辑、歌手...",
  Tracks: "单曲",
  Albums: "专辑",
  Artists: "歌手",
  "Audio Quality": "音质",
  Standard: "标准",
  High: "高音质",
  Lossless: "无损",
  Language: "语言",
  Theme: "外观",
  System: "跟随系统",
  Dark: "深色",
  Light: "浅色",
  Storage: "存储与缓存",
  "Cache Limit": "缓存上限",
  "Clear Cache": "清理缓存",
  "Local Music": "本地音乐",
  "Import Audio Files": "导入本地音频文件",
  "Rescan": "重新扫描",
  "From Local ZIP": "本地 ZIP 包",
  "From GitHub": "GitHub 仓库",
  "From URL": "局域网 / HTTP 链接",
  "Choose .zip plugin archive": "选择 .zip 插件包",
  "Install": "确认安装",
  "Cancel": "取消",
  "Update": "更新",
  "Check Update": "检查更新",
  "Reload": "重载",
  "Remove": "移除",
  "Save QR Code": "保存二维码",
  "Needs Sign In": "请先登录",
  "Needs Setup": "需要配置插件",
  "Go to Settings": "前往设置",
  "Load More": "加载更多",
  "Nothing playing": "未在播放",
  "Saved": "已收藏",
  "Save": "收藏",
  "Following": "已关注",
  "Follow": "关注",
  "Subscribed": "已订阅",
  "Subscribe": "订阅",
  "Back": "返回",
  "Retry": "重试",
  "Process permission warning": "该插件请求启动桌面外部进程权限；移动端受沙箱限制不支持外部进程，仅纯 JS 与网络功能可用。",
};

export function resolveLang(setting: string): "zh-CN" | "en" {
  if (setting === "zh-CN" || setting === "en") return setting;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function createT(setting: string) {
  const lang = resolveLang(setting);
  return (key: string): string => {
    if (lang === "zh-CN") return zh[key] || key;
    return key;
  };
}

export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
