import type {
  Account,
  Album,
  ApiErrorData,
  Artist,
  BrowsePage,
  CacheStats,
  Comment,
  CommentPage,
  CoverPalette,
  MobileSettings,
  ParsedLyrics,
  PendingPlugin,
  Playlist,
  SearchResult,
  SessionState,
  Show,
  ShowPage,
  SourceSummary,
  Station,
  StreamInfo,
  Track,
  UpdateRelease,
  UpdateStatus,
  WebSignInPayload,
} from "./types";

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        mygo?: {
          postMessage: (msg: unknown) => void;
        };
      };
    };
    MyGoNative?: {
      postMessage: (json: string) => void;
    };
    __mygoNativeEvent?: (name: string, payload: unknown) => void;
  }
}

export class ApiError extends Error {
  code: string;
  reason: string;
  status: number;
  constructor(status: number, data: ApiErrorData) {
    super(data.reason || data.error || `HTTP ${status}`);
    this.code = data.code || "error";
    this.reason = data.reason || "";
    this.status = status;
  }
}

function initSessionParams() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || sessionStorage.getItem("mygo_token") || "";
  const platform = params.get("platform") || sessionStorage.getItem("mygo_platform") || "web";
  if (token) sessionStorage.setItem("mygo_token", token);
  if (platform) sessionStorage.setItem("mygo_platform", platform);
  if (params.has("token")) {
    params.delete("token");
    const clean = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (clean ? `?${clean}` : ""));
  }
  return { token, platform };
}

const sessionInfo = initSessionParams();
export const AUTH_TOKEN = sessionInfo.token;
export const PLATFORM = sessionInfo.platform; // "ios" | "android" | "web"
export const IS_NATIVE = PLATFORM === "ios" || PLATFORM === "android";

export function postNative(action: string, payload: Record<string, unknown> = {}): boolean {
  const msg = { action, payload };
  if (window.webkit?.messageHandlers?.mygo) {
    window.webkit.messageHandlers.mygo.postMessage(msg);
    return true;
  }
  if (window.MyGoNative?.postMessage) {
    window.MyGoNative.postMessage(JSON.stringify(msg));
    return true;
  }
  return false;
}

export function imageProxyUrl(rawUrl?: string, size = 300): string {
  if (!rawUrl) return "";
  const q = new URLSearchParams({
    url: rawUrl,
    size: String(size),
    token: AUTH_TOKEN,
  });
  return `${window.location.origin}/api/image?${q.toString()}`;
}

export function qrImageUrl(text: string): string {
  const q = new URLSearchParams({ text, token: AUTH_TOKEN });
  return `${window.location.origin}/api/qr?${q.toString()}`;
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (AUTH_TOKEN) headers.set("X-MyGo-Token", AUTH_TOKEN);
  if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, data as ApiErrorData);
  }
  return data as T;
}

export const api = {
  getSettings: () => req<MobileSettings>("/api/settings"),
  updateSettings: (patch: Partial<MobileSettings>) =>
    req<MobileSettings>(`/api/settings?platform=${encodeURIComponent(PLATFORM)}`, {
      method: "POST",
      body: JSON.stringify({ ...patch, platform: PLATFORM }),
    }),

  getSession: () => req<SessionState>("/api/session"),
  saveSession: (sess: SessionState) =>
    req<{ ok: boolean }>("/api/session", { method: "POST", body: JSON.stringify(sess) }),

  getSources: () => req<{ activeSource: string; sources: SourceSummary[] }>("/api/sources"),

  getAccount: (source: string) =>
    req<{ account: Account | null }>(`/api/sources/${encodeURIComponent(source)}/account`),
  startSignIn: (source: string) =>
    req<{ started: boolean }>(`/api/sources/${encodeURIComponent(source)}/signin`, { method: "POST" }),
  signOut: (source: string) =>
    req<{ ok: boolean }>(`/api/sources/${encodeURIComponent(source)}/signout`, { method: "POST" }),
  setSourceSetting: (source: string, key: string, value: string) =>
    req<{ ok: boolean }>(`/api/sources/${encodeURIComponent(source)}/setting`, {
      method: "POST",
      body: JSON.stringify({ key, value }),
    }),

  home: (source: string) => req<BrowsePage>(`/api/sources/${encodeURIComponent(source)}/home`),
  browse: (source: string, page: string) =>
    req<BrowsePage>(`/api/sources/${encodeURIComponent(source)}/browse?page=${encodeURIComponent(page)}`),
  search: (source: string, q: string, kind: string, offset = 0) =>
    req<SearchResult>(
      `/api/sources/${encodeURIComponent(source)}/search?q=${encodeURIComponent(q)}&kind=${encodeURIComponent(kind)}&offset=${offset}`
    ),
  suggest: (source: string, q: string) =>
    req<{ suggestions: string[] }>(`/api/sources/${encodeURIComponent(source)}/suggest?q=${encodeURIComponent(q)}`),

  playlists: (source: string) =>
    req<{ playlists: Playlist[] }>(`/api/sources/${encodeURIComponent(source)}/playlists`),
  playlist: (source: string, id: string) =>
    req<Playlist>(`/api/sources/${encodeURIComponent(source)}/playlist?id=${encodeURIComponent(id)}`),
  album: (source: string, id: string) =>
    req<{ album: Album; tracks?: Track[] }>(
      `/api/sources/${encodeURIComponent(source)}/album?id=${encodeURIComponent(id)}`
    ),
  artist: (source: string, id: string) =>
    req<{ artist: Artist; tracks?: Track[]; albums?: Album[] }>(
      `/api/sources/${encodeURIComponent(source)}/artist?id=${encodeURIComponent(id)}`
    ),
  liked: (source: string, offset = 0) =>
    req<{ tracks?: Track[]; more?: boolean }>(`/api/sources/${encodeURIComponent(source)}/liked?offset=${offset}`),
  recent: (source: string) =>
    req<{ tracks?: Track[] }>(`/api/sources/${encodeURIComponent(source)}/recent`),
  savedAlbums: (source: string, offset = 0) =>
    req<{ albums?: Album[]; more?: boolean }>(
      `/api/sources/${encodeURIComponent(source)}/saved-albums?offset=${offset}`
    ),
  shows: (source: string) => req<{ shows?: Show[] }>(`/api/sources/${encodeURIComponent(source)}/shows`),
  show: (source: string, id: string, offset = 0) =>
    req<ShowPage>(`/api/sources/${encodeURIComponent(source)}/show?id=${encodeURIComponent(id)}&offset=${offset}`),
  stations: (source: string) =>
    req<{ stations?: Station[] }>(`/api/sources/${encodeURIComponent(source)}/stations`),
  stationNext: (source: string, id: string) =>
    req<{ tracks?: Track[] }>(`/api/sources/${encodeURIComponent(source)}/station-next`, {
      method: "POST",
      body: JSON.stringify({ id }),
    }),

  lyrics: (source: string, id: string, durationMs = 0) =>
    req<ParsedLyrics>(
      `/api/sources/${encodeURIComponent(source)}/lyrics?id=${encodeURIComponent(id)}${
        durationMs > 0 ? `&durationMs=${Math.round(durationMs)}` : ""
      }`
    ),
  comments: (source: string, trackId: string, offset = 0) =>
    req<CommentPage>(
      `/api/sources/${encodeURIComponent(source)}/comments?trackId=${encodeURIComponent(trackId)}&offset=${offset}`
    ),
  postComment: (source: string, trackId: string, text: string) =>
    req<Comment>(`/api/sources/${encodeURIComponent(source)}/comments/post`, {
      method: "POST",
      body: JSON.stringify({ trackId, text }),
    }),
  likeComment: (source: string, trackId: string, commentId: string, on: boolean) =>
    req<{ ok: boolean }>(`/api/sources/${encodeURIComponent(source)}/comments/like`, {
      method: "POST",
      body: JSON.stringify({ trackId, commentId, on }),
    }),

  isLiked: (source: string, ids: string[]) =>
    req<{ liked: Record<string, boolean> }>(`/api/sources/${encodeURIComponent(source)}/is-liked`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  like: (source: string, id: string, on: boolean, isEpisode = false) =>
    req<{ ok: boolean }>(`/api/sources/${encodeURIComponent(source)}/like`, {
      method: "POST",
      body: JSON.stringify({ id, on, isEpisode }),
    }),
  recordPlayed: (source: string, track: Track) =>
    req<{ ok: boolean }>(`/api/sources/${encodeURIComponent(source)}/played`, {
      method: "POST",
      body: JSON.stringify({ track }),
    }),

  createPlaylist: (source: string, name: string) =>
    req<Playlist>(`/api/sources/${encodeURIComponent(source)}/playlist/create`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  deletePlaylist: (source: string, id: string) =>
    req<{ ok: boolean }>(`/api/sources/${encodeURIComponent(source)}/playlist/delete`, {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  addToPlaylist: (source: string, id: string, trackIds: string[]) =>
    req<{ ok: boolean }>(`/api/sources/${encodeURIComponent(source)}/playlist/add`, {
      method: "POST",
      body: JSON.stringify({ id, trackIds }),
    }),
  removeFromPlaylist: (source: string, id: string, trackIds: string[]) =>
    req<{ ok: boolean }>(`/api/sources/${encodeURIComponent(source)}/playlist/remove`, {
      method: "POST",
      body: JSON.stringify({ id, trackIds }),
    }),
  savePlaylist: (source: string, id: string, on: boolean) =>
    req<{ ok: boolean }>(`/api/sources/${encodeURIComponent(source)}/playlist/save`, {
      method: "POST",
      body: JSON.stringify({ id, on }),
    }),
  saveAlbum: (source: string, id: string, on: boolean) =>
    req<{ ok: boolean }>(`/api/sources/${encodeURIComponent(source)}/album/save`, {
      method: "POST",
      body: JSON.stringify({ id, on }),
    }),
  followArtist: (source: string, id: string, on: boolean) =>
    req<{ ok: boolean }>(`/api/sources/${encodeURIComponent(source)}/artist/follow`, {
      method: "POST",
      body: JSON.stringify({ id, on }),
    }),
  subscribeShow: (source: string, id: string, on: boolean) =>
    req<{ ok: boolean }>(`/api/sources/${encodeURIComponent(source)}/show/subscribe`, {
      method: "POST",
      body: JSON.stringify({ id, on }),
    }),

  streamInfo: (source: string, id: string, quality: string) => {
    const q = new URLSearchParams({
      source,
      id,
      quality,
      transcodeOgg: PLATFORM === "ios" ? "1" : "0",
    });
    return req<StreamInfo>(`/api/stream/info?${q.toString()}`);
  },

  imagePalette: (rawUrl: string) =>
    req<CoverPalette>(`/api/image/palette?url=${encodeURIComponent(rawUrl)}`),

  updateStatus: () => req<UpdateStatus>(`/api/update/status?platform=${encodeURIComponent(PLATFORM)}`),
  checkAppUpdate: () =>
    req<UpdateRelease>(`/api/update/check?platform=${encodeURIComponent(PLATFORM)}`, {
      method: "POST",
      body: JSON.stringify({ platform: PLATFORM }),
    }),
  skipAppUpdate: (version: string) =>
    req<MobileSettings>("/api/update/skip", {
      method: "POST",
      body: JSON.stringify({ version }),
    }),

  preparePluginGitHub: (repo: string) =>
    req<PendingPlugin>("/api/plugins/prepare/github", { method: "POST", body: JSON.stringify({ repo }) }),
  preparePluginURL: (url: string) =>
    req<PendingPlugin>("/api/plugins/prepare/url", { method: "POST", body: JSON.stringify({ url }) }),
  preparePluginLocal: (path: string) =>
    req<PendingPlugin>("/api/plugins/prepare/local", { method: "POST", body: JSON.stringify({ path }) }),
  preparePluginUpload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return req<PendingPlugin>("/api/plugins/prepare/upload", { method: "POST", body: form });
  },
  confirmPlugin: (pendingId: string, activate = true) =>
    req<SourceSummary>("/api/plugins/confirm", {
      method: "POST",
      body: JSON.stringify({ pendingId, activate }),
    }),
  discardPlugin: (pendingId: string) =>
    req<{ ok: boolean }>("/api/plugins/discard", { method: "POST", body: JSON.stringify({ pendingId }) }),
  removePlugin: (id: string) =>
    req<{ ok: boolean }>("/api/plugins/remove", { method: "POST", body: JSON.stringify({ id }) }),
  reloadPlugin: (id: string) =>
    req<SourceSummary>("/api/plugins/reload", { method: "POST", body: JSON.stringify({ id }) }),
  checkPluginUpdate: (id: string) =>
    req<{ hasUpdate: boolean; repo?: string; installedVersion?: string; latestVersion?: string }>(
      "/api/plugins/check-update",
      { method: "POST", body: JSON.stringify({ id }) }
    ),

  completeWebSignIn: (id: string, cookie: string, error = "") =>
    req<{ ok: boolean }>("/api/auth/web-signin/complete", {
      method: "POST",
      body: JSON.stringify({ id, cookie, error }),
    }),

  getLocalFolders: () => req<{ folders: string[] }>("/api/local/folders"),
  removeLocalFolder: (path: string) =>
    req<{ folders: string[] }>("/api/local/folders/remove", { method: "POST", body: JSON.stringify({ path }) }),
  rescanLocal: () => req<{ ok: boolean }>("/api/local/rescan", { method: "POST" }),
  importLocalFiles: (files: FileList | File[]) => {
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("file", f));
    return req<{ imported: string[] }>("/api/local/import", { method: "POST", body: form });
  },

  getCacheStats: () => req<CacheStats>("/api/cache/stats"),
  clearCache: () => req<CacheStats>("/api/cache/clear", { method: "POST" }),

  subscribeEvents: (handlers: {
    signInPrompt?: (p: { source: string; qr?: string; text?: string }) => void;
    signInResult?: (p: { source: string; account?: Account; error?: string; code?: string; reason?: string }) => void;
    webSignIn?: (p: WebSignInPayload) => void;
    openURL?: (p: { url: string }) => void;
    sourcesChanged?: () => void;
    localChanged?: () => void;
  }) => {
    const es = new EventSource(`/api/events?token=${encodeURIComponent(AUTH_TOKEN)}`);
    const bind = <T,>(ev: string, fn?: (data: T) => void) => {
      if (!fn) return;
      es.addEventListener(ev, (e) => {
        try {
          fn(JSON.parse((e as MessageEvent).data));
        } catch {
          // ignore malformed payload
        }
      });
    };
    bind("signInPrompt", handlers.signInPrompt);
    bind("signInResult", handlers.signInResult);
    bind("webSignIn", handlers.webSignIn);
    bind("openURL", handlers.openURL);
    bind("sourcesChanged", handlers.sourcesChanged);
    bind("localChanged", handlers.localChanged);
    return () => es.close();
  },
};
