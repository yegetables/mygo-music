export interface Artist {
  id: string;
  name: string;
  imageUrl?: string;
  following?: boolean;
}

export interface Album {
  id: string;
  name: string;
  imageUrl?: string;
  artists?: Artist[];
  released?: string;
  saved?: boolean;
}

export interface Track {
  id: string;
  source?: string;
  name: string;
  artists?: Artist[];
  album: Album;
  duration: number;
  url?: string;
  unavailable?: boolean;
  showId?: string;
  description?: string;
  published?: string;
}

export interface Playlist {
  id: string;
  name: string;
  imageUrl?: string;
  description?: string;
  owner?: string;
  trackCount?: number;
  mine?: boolean;
  saved?: boolean;
  fixed?: boolean;
  tracks?: Track[];
}

export interface Show {
  id: string;
  name: string;
  imageUrl?: string;
  description?: string;
  publisher?: string;
  publisherPage?: string;
  episodeCount?: number;
  subscribed?: boolean;
}

export interface ShowPage {
  show: Show;
  episodes?: Track[];
  more?: boolean;
}

export interface Station {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
}

export interface LinkItem {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  page: string;
}

export interface Section {
  title?: string;
  tracks?: Track[];
  albums?: Album[];
  artists?: Artist[];
  playlists?: Playlist[];
  shows?: Show[];
  stations?: Station[];
  links?: LinkItem[];
  morePage?: string;
  empty?: string;
  pageTitle?: string;
  subtitle?: string;
}

export interface BrowsePage {
  title?: string;
  subtitle?: string;
  imageUrl?: string;
  description?: string;
  sections?: Section[];
}

export interface NavItem {
  title: string;
  page?: string;
  builtin?: string;
  icon?: string;
}

export interface SettingOption {
  value: string;
  label: string;
}

export interface PluginSetting {
  key: string;
  label: string;
  help?: string;
  link?: string;
  type?: string;
  options?: SettingOption[];
}

export interface SourceInfo {
  id: string;
  name: string;
  version?: string;
  playback: string;
  settings?: PluginSetting[];
  navigation?: NavItem[];
}

export interface SourceSummary {
  info: SourceInfo;
  builtin: boolean;
  active: boolean;
  capabilities: Record<string, boolean>;
  settings: Record<string, string>;
  origin?: { repo: string; version: string };
  permissions?: { network?: string[]; process?: string[] };
}

export interface Account {
  id: string;
  name: string;
  imageUrl?: string;
  page?: string;
}

export interface PendingPlugin {
  pendingId: string;
  repo?: string;
  version?: string;
  id: string;
  name: string;
  minAppVersion?: string;
  permissions: { network?: string[]; process?: string[] };
  updating: boolean;
  processWarning?: boolean;
}

export interface MobileSettings {
  activeSource: string;
  quality: string;
  language: string;
  theme: string;
  cacheLimitMB: number;
}

export interface SessionState {
  queue: Track[];
  index: number;
  positionMs: number;
  repeatMode: "off" | "all" | "one";
  shuffle: boolean;
  stationId?: string;
  stationSource?: string;
  stationName?: string;
}

export interface LyricWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface LyricLine {
  atMs: number;
  endMs: number;
  text: string;
  translation?: string;
  isCredit?: boolean;
  words?: LyricWord[];
}

export interface ParsedLyrics {
  lang?: string;
  lines: LyricLine[];
}

export interface Comment {
  id: string;
  author: string;
  avatarUrl?: string;
  text: string;
  time?: number;
  likes?: number;
  liked?: boolean;
}

export interface CommentPage {
  comments?: Comment[];
  total?: number;
  more?: boolean;
}

export interface SearchResult {
  tracks?: Track[];
  albums?: Album[];
  artists?: Artist[];
  playlists?: Playlist[];
  shows?: Show[];
  more?: boolean;
}

export interface CacheStats {
  songsBytes: number;
  coversBytes: number;
  totalBytes: number;
  limitMB: number;
}

export interface WebSignInPayload {
  id: string;
  plugin: string;
  name: string;
  url: string;
  cookiesOf: string;
  until: string[];
  userAgent?: string;
}

export interface SignInPromptPayload {
  source: string;
  qr?: string;
  text?: string;
}

export interface SignInResultPayload {
  source: string;
  account?: Account;
  error?: string;
  code?: string;
  reason?: string;
}

export interface ApiErrorData {
  error: string;
  code?: "signIn" | "setup" | "unavailable" | "unsupported" | "error";
  reason?: string;
}
