const zh: Record<string, string> = {
  Home: "首页",
  Search: "搜索",
  Library: "音乐库",
  Settings: "设置",
  Plugins: "插件",
  General: "通用",
  Playback: "播放",
  Experiments: "实验性功能",
  Cache: "缓存",
  Updates: "更新",
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
  Stage: "律动",
  "Stage Style": "律动效果",
  Flow: "流光",
  Steps: "云阶",
  Tilt: "倾诉",
  Sparks: "火花",
  Queue: "播放队列",
  QueueShort: "队列",
  Comments: "评论",
  "Top Comment": "热评",
  "View Comments": "查看评论",
  "No lyrics": "暂无歌词",
  "No lyrics. Enjoy the music.": "纯音乐，请欣赏",
  "No comments yet": "暂无评论",
  "Write a comment...": "写下你的评论...",
  Send: "发送",
  "Search songs, albums, artists...": "搜索歌曲、专辑、歌手...",
  Tracks: "单曲",
  Albums: "专辑",
  Artists: "歌手",
  "Audio Quality": "音质",
  Quality: "音质",
  Standard: "标准",
  High: "高音质",
  Lossless: "无损",
  Language: "语言",
  Theme: "外观",
  Appearance: "外观",
  System: "跟随系统",
  "Follow System": "跟随系统",
  Dark: "深色",
  Light: "浅色",
  "Now Playing Style": "播放页样式",
  "Now Playing Style Help": "播放页中歌曲的样子：封面，或随播放转动的黑胶唱片、磁带",
  Cover: "封面",
  Vinyl: "黑胶唱片",
  Cassette: "磁带",
  "Top Comments in Quiet Parts": "间奏时显示热评",
  "Top Comments Help": "前奏、间奏与尾奏时，歌词处换成这首歌的热门评论",
  "Even Out Loudness": "音量均衡",
  "Even Out Loudness Help": "按插件测得的响度调整每首歌的音量，让歌曲听起来一样响",
  "Smoke on the Progress Bar": "进度条烟雾特效",
  "Smoke Help": "播放时进度条化作拖着烟雾的光点，随音乐起伏；会多用一些电量",
  "Fog Backdrop": "烟雾背景",
  "Fog Help": "播放页的背景化作封面色调的烟雾，缓缓升起，随低音起伏；仍在打磨，会多用一些电量",
  "Grow From the Cover": "从封面展开",
  "Grow From Cover Help": "播放页从播放条的封面展开，关闭时缩回封面，而不是从底部滑上来",
  Storage: "缓存",
  "Song Cache": "歌曲缓存",
  "Cache Limit": "歌曲缓存",
  Off: "关闭",
  "Clear Cache": "清除缓存",
  "Local Music": "本地音乐",
  "Import Audio Files": "导入本地音频文件",
  Rescan: "重新扫描",
  "Update Channel": "更新渠道",
  "Update Channel Help": "选择自动更新拉取的仓库；不支持当前平台的渠道不可选",
  "My Fork": "我的 Fork",
  "Official Upstream": "官方上游",
  "Check for Updates Automatically": "自动检查更新",
  "Check for Updates": "检查更新",
  "Checking...": "检查中...",
  "Current Version": "当前版本",
  "Up to date": "已是最新版本",
  "New Version Available": "发现新版本",
  "Download and Install": "下载并安装",
  "Download IPA": "下载 IPA 安装包",
  "Open Release Page": "打开发布页",
  "Skip This Version": "跳过此版本",
  "Remind Later": "稍后提醒",
  "Downloading...": "正在下载...",
  "Unsupported on this platform": "当前平台不支持",
  "Official upstream does not publish iPadOS / iOS builds": "官方上游暂不提供 iPadOS / iOS 安装包",
  "Official upstream does not publish Android builds": "官方上游暂不提供 Android 安装包",
  "Official upstream only publishes desktop builds": "官方上游仅提供桌面端安装包",
  "From Local ZIP": "本地 ZIP 包",
  "From GitHub": "GitHub 仓库",
  "From URL": "局域网 / HTTP 链接",
  "Choose .zip plugin archive": "选择 .zip 插件包",
  Install: "确认安装",
  Cancel: "取消",
  Update: "更新",
  "Check Update": "检查更新",
  Reload: "重载",
  Remove: "移除",
  Enabled: "已启用",
  Disabled: "已停用",
  "Save QR Code": "保存二维码",
  "Needs Sign In": "请先登录",
  "Needs Setup": "需要配置插件",
  "Go to Settings": "前往设置",
  "Load More": "加载更多",
  "Nothing playing": "未在播放",
  Saved: "已收藏",
  Save: "收藏",
  Following: "已关注",
  Follow: "关注",
  Subscribed: "已订阅",
  Subscribe: "订阅",
  Back: "返回",
  Retry: "重试",
  "Process permission warning":
    "该插件请求启动桌面外部进程权限；移动端受沙箱限制不支持外部进程，仅纯 JS 与网络功能可用。",
};

const enFallback: Record<string, string> = {
  QueueShort: "Queue",
  "Now Playing Style Help": "How the song appears in Now Playing: cover, or a spinning vinyl record or cassette",
  "Top Comments Help": "Show a song's top comments in place of lyrics during the intro, interludes, and outro",
  "Even Out Loudness Help": "Adjust each track's volume by what the source measured, so songs sound equally loud",
  "Smoke Help": "Turn the progress bar into a glowing comet trailing smoke to the music; uses more battery",
  "Fog Help": "Fill Now Playing's backdrop with cover-tinted fog rising to the bass; experimental, uses more battery",
  "Grow From Cover Help": "Expand Now Playing out of the player bar's cover and shrink back into it instead of sliding up",
  "Update Channel Help": "Choose which repository auto-updates check; channels without builds for this platform are disabled",
};

export function resolveLang(setting: string): "zh-CN" | "en" {
  if (setting === "zh-CN" || setting === "en") return setting;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function createT(setting: string) {
  const lang = resolveLang(setting);
  return (key: string): string => {
    if (lang === "zh-CN") return zh[key] || key;
    return enFallback[key] || key;
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
