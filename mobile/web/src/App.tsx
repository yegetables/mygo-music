import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, imageProxyUrl, IS_NATIVE, postNative } from "./api";
import { audioRuntime } from "./audioRuntime";
import { Icon } from "./components/Icons";
import { NowPlaying } from "./components/NowPlaying";
import { PluginInstallModal, SignInModal } from "./components/PluginModal";
import { SmokeScrubber } from "./components/SmokeScrubber";
import { TrackList } from "./components/TrackList";
import { UpdateModal } from "./components/UpdateModal";
import { createT, formatDuration } from "./i18n";
import { SettingsPage } from "./pages/SettingsPage";
import type {
  Account,
  Album,
  Artist,
  BrowsePage,
  CoverPalette,
  MobileSettings,
  NavItem,
  PendingPlugin,
  Playlist,
  SearchResult,
  Section,
  Show,
  ShowPage,
  SignInPromptPayload,
  SourceSummary,
  Station,
  Track,
  UpdateDownloadProgress,
  UpdateRelease,
  UpdateStatus,
  WebSignInPayload,
} from "./types";

const DEFAULT_PALETTE: CoverPalette = {
  tint: { r: 120, g: 120, b: 130 },
  accent: { r: 181, g: 181, b: 186 },
  deep: { r: 70, g: 70, b: 77 },
  fog: { r: 175, g: 175, b: 184 },
};

type Route =
  | { kind: "home" }
  | { kind: "browse"; page: string; title?: string }
  | { kind: "section"; section: Section }
  | { kind: "search" }
  | { kind: "library" }
  | { kind: "liked"; title?: string }
  | { kind: "savedAlbums"; title?: string }
  | { kind: "recent"; title?: string }
  | { kind: "stations"; title?: string }
  | { kind: "shows"; title?: string }
  | { kind: "playlist"; id: string }
  | { kind: "album"; id: string }
  | { kind: "artist"; id: string }
  | { kind: "show"; id: string }
  | { kind: "settings" };

function defaultNav(src: SourceSummary | undefined, t: (k: string) => string): NavItem[] {
  if (!src) return [];
  if (src.info.navigation && src.info.navigation.length > 0) {
    return src.info.navigation.filter((n) => {
      if (n.builtin === "home") return src.capabilities.home;
      if (n.builtin === "liked") return src.capabilities.liked;
      if (n.builtin === "savedAlbums") return src.capabilities.savedAlbums;
      if (n.builtin === "stations") return src.capabilities.stations;
      if (n.builtin === "shows") return src.capabilities.shows;
      return true;
    });
  }
  const items: NavItem[] = [];
  if (src.capabilities.home) items.push({ title: t("Home"), builtin: "home", icon: "home" });
  if (src.capabilities.liked) items.push({ title: t("Liked Songs"), builtin: "liked", icon: "heart" });
  if (src.capabilities.savedAlbums) items.push({ title: t("Saved Albums"), builtin: "savedAlbums", icon: "album" });
  if (src.capabilities.recent) items.push({ title: t("Recent"), builtin: "recent", icon: "clock" });
  if (src.capabilities.stations) items.push({ title: t("Stations"), builtin: "stations", icon: "radio" });
  if (src.capabilities.shows) items.push({ title: t("Shows"), builtin: "shows", icon: "podcast" });
  return items;
}

export const App: React.FC = () => {
  const [settings, setSettings] = useState<MobileSettings>({
    activeSource: "local",
    quality: "high",
    language: "system",
    theme: "system",
    cacheLimitMB: 2048,
    playerStyle: "",
    hotComments: false,
    normalize: true,
    smoke: false,
    fog: false,
    growFromCover: false,
    lyricsStage: false,
    stageStyle: "",
    stageSparks: false,
    updateChannel: "fork",
    autoCheckUpdates: true,
  });
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [routeStack, setRouteStack] = useState<Route[]>([{ kind: "home" }]);
  const route = routeStack[routeStack.length - 1];

  // Page data
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState<{ message: string; code?: string } | null>(null);
  const [browseData, setBrowseData] = useState<BrowsePage | null>(null);
  const [tracksData, setTracksData] = useState<Track[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [albumsData, setAlbumsData] = useState<Album[]>([]);
  const [stationsData, setStationsData] = useState<Station[]>([]);
  const [showsData, setShowsData] = useState<Show[]>([]);
  const [playlistDetail, setPlaylistDetail] = useState<Playlist | null>(null);
  const [albumDetail, setAlbumDetail] = useState<{ album: Album; tracks?: Track[] } | null>(null);
  const [artistDetail, setArtistDetail] = useState<{ artist: Artist; tracks?: Track[]; albums?: Album[] } | null>(null);
  const [showDetail, setShowDetail] = useState<ShowPage | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchKind, setSearchKind] = useState<"tracks" | "albums" | "artists" | "playlists" | "shows">("tracks");
  const [searchRes, setSearchRes] = useState<SearchResult | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Player state
  const [queue, setQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [qualityBadge, setQualityBadge] = useState("");
  const [repeatMode, setRepeatMode] = useState<"off" | "all" | "one">("off");
  const [shuffle, setShuffle] = useState(false);
  const [stationCtx, setStationCtx] = useState<{ id: string; source: string; name: string } | null>(null);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const [trackNormGain, setTrackNormGain] = useState<number>(1.0);
  const [palette, setPalette] = useState<CoverPalette>(DEFAULT_PALETTE);
  const [miniCoverRect, setMiniCoverRect] = useState<DOMRect | null>(null);
  const [hideMiniCover, setHideMiniCover] = useState(false);

  // App updater state
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateModalRelease, setUpdateModalRelease] = useState<UpdateRelease | null>(null);
  const [updateProgress, setUpdateProgress] = useState<UpdateDownloadProgress | null>(null);

  // Modals & toast
  const [installOpen, setInstallOpen] = useState(false);
  const [pendingPlugin, setPendingPlugin] = useState<PendingPlugin | null>(null);
  const [signInPrompt, setSignInPrompt] = useState<SignInPromptPayload | null>(null);
  const [signInStatus, setSignInStatus] = useState("");
  const [toast, setToast] = useState("");

  const miniCoverRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackRef = useRef({ queue, queueIndex, repeatMode, shuffle, stationCtx, playing, positionMs });
  playbackRef.current = { queue, queueIndex, repeatMode, shuffle, stationCtx, playing, positionMs };

  const t = useMemo(() => createT(settings.language), [settings.language]);
  const enabledSources = useMemo(() => sources.filter((s) => !s.disabled), [sources]);
  const activeSource = useMemo(
    () =>
      enabledSources.find((s) => s.info.id === settings.activeSource) ||
      enabledSources[0] ||
      sources[0],
    [enabledSources, sources, settings.activeSource]
  );
  const sourceId = activeSource?.info.id || "local";
  const currentTrack = queueIndex >= 0 && queueIndex < queue.length ? queue[queueIndex] : null;
  const currentSourceObj = useMemo(
    () => sources.find((s) => s.info.id === (currentTrack?.source || sourceId)) || activeSource,
    [sources, currentTrack?.source, sourceId, activeSource]
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? "" : cur)), 2800);
  }, []);

  // Theme application + native system bar sync (status bar icons adapt to light theme vs dark/NowPlaying)
  useEffect(() => {
    const apply = () => {
      let resolved = settings.theme;
      if (resolved === "system") {
        resolved = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
      }
      document.documentElement.setAttribute("data-theme", resolved);
      if (IS_NATIVE) {
        postNative("setSystemBarStyle", { darkContent: resolved === "light" && !nowPlayingOpen });
      }
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings.theme, nowPlayingOpen]);

  // Initial load: settings, sources, saved session
  const refreshSources = useCallback(async () => {
    const res = await api.getSources();
    setSources(res.sources || []);
    setSettings((s) => ({ ...s, activeSource: res.activeSource || s.activeSource }));
  }, []);

  useEffect(() => {
    Promise.all([api.getSettings(), api.getSources(), api.getSession(), api.updateStatus().catch(() => null)])
      .then(([st, srcRes, sess, upd]) => {
        setSettings(st);
        setSources(srcRes.sources || []);
        if (upd) setUpdateStatus(upd);
        if (sess.queue && sess.queue.length > 0) {
          setQueue(sess.queue);
          setQueueIndex(sess.index);
          setPositionMs(sess.positionMs || 0);
          setRepeatMode(sess.repeatMode || "off");
          setShuffle(!!sess.shuffle);
          if (sess.stationId && sess.stationSource) {
            setStationCtx({ id: sess.stationId, source: sess.stationSource, name: sess.stationName || "" });
          }
        }
      })
      .catch((e) => showToast(e instanceof Error ? e.message : String(e)));
  }, [showToast]);

  // Keep imperative audioRuntime synchronized for smooth 60fps animations
  useEffect(() => {
    audioRuntime.syncPlayback(positionMs, durationMs || currentTrack?.duration || 0, playing, buffering);
  }, [positionMs, durationMs, currentTrack?.duration, playing, buffering]);

  // Extract cover dominant palette whenever current track artwork changes
  useEffect(() => {
    const imgUrl = currentTrack?.album?.imageUrl;
    if (!imgUrl) {
      setPalette(DEFAULT_PALETTE);
      return;
    }
    let cancelled = false;
    api
      .imagePalette(imgUrl)
      .then((pal) => {
        if (!cancelled && pal) setPalette(pal);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentTrack?.album?.imageUrl]);

  // Apply loudness normalization gain immediately when toggled or track changes
  useEffect(() => {
    const effectiveGain = settings.normalize ? trackNormGain : 1.0;
    if (IS_NATIVE) {
      postNative("playerSetGain", { gain: effectiveGain });
    } else if (audioRef.current) {
      audioRef.current.volume = Math.max(0, Math.min(1, effectiveGain));
    }
  }, [settings.normalize, trackNormGain]);

  // Toggle lightweight native bass metering only when Smoke or Fog is enabled
  useEffect(() => {
    if (IS_NATIVE) {
      postNative("playerSetMetering", { enabled: !!(settings.smoke || settings.fog) });
    }
  }, [settings.smoke, settings.fog]);

  // Automatic background update check (~10s after launch, at most once every 24h)
  const runAppUpdateCheck = useCallback(
    async (manual: boolean): Promise<UpdateRelease | null> => {
      setCheckingUpdate(true);
      try {
        const res = await api.checkAppUpdate();
        const st = await api.updateStatus().catch(() => null);
        if (st) setUpdateStatus(st);
        setSettings((prev) => ({ ...prev, lastUpdateCheck: res.checkedAt }));
        if (res.hasUpdate) {
          if (manual || !res.skipped) {
            setUpdateProgress(null);
            setUpdateModalRelease(res);
          }
        } else if (manual) {
          showToast(`${t("Up to date")} (v${res.currentVersion})`);
        }
        return res;
      } catch (e) {
        if (manual) showToast(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setCheckingUpdate(false);
      }
    },
    [showToast, t]
  );

  const autoCheckedRef = useRef(false);
  useEffect(() => {
    if (autoCheckedRef.current || !settings.autoCheckUpdates) return;
    const last = settings.lastUpdateCheck ? Date.parse(settings.lastUpdateCheck) : 0;
    if (last && Date.now() - last < 24 * 60 * 60 * 1000) {
      autoCheckedRef.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      autoCheckedRef.current = true;
      runAppUpdateCheck(false);
    }, 10000);
    return () => window.clearTimeout(timer);
  }, [settings.autoCheckUpdates, settings.lastUpdateCheck, runAppUpdateCheck]);

  // Load account & playlists whenever source changes
  const refreshSourceSidebar = useCallback(async () => {
    if (!activeSource) return;
    if (activeSource.capabilities.account) {
      api.getAccount(activeSource.info.id).then((r) => setAccount(r.account)).catch(() => setAccount(null));
    } else {
      setAccount(null);
    }
    if (activeSource.capabilities.playlists) {
      api.playlists(activeSource.info.id).then((r) => setPlaylists(r.playlists || [])).catch(() => setPlaylists([]));
    } else {
      setPlaylists([]);
    }
  }, [activeSource]);

  useEffect(() => {
    refreshSourceSidebar();
  }, [refreshSourceSidebar]);

  // Check liked status for visible tracks
  const checkLiked = useCallback(
    (tracks: Track[]) => {
      if (!activeSource?.capabilities.isLiked || tracks.length === 0) return;
      const ids = tracks.map((tr) => tr.id).slice(0, 100);
      api
        .isLiked(activeSource.info.id, ids)
        .then((r) => setLikedMap((prev) => ({ ...prev, ...r.liked })))
        .catch(() => {});
    },
    [activeSource]
  );

  // Navigation helpers
  const navigate = useCallback((next: Route, replace = false) => {
    setRouteStack((prev) => (replace ? [next] : [...prev.slice(-15), next]));
  }, []);

  const goBack = useCallback(() => {
    setRouteStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  // Load route content
  const loadCurrentRoute = useCallback(async () => {
    if (!activeSource) return;
    if (route.kind === "settings" || route.kind === "search" || route.kind === "library" || route.kind === "section") {
      setPageError(null);
      return;
    }
    setLoading(true);
    setPageError(null);
    try {
      switch (route.kind) {
        case "home":
          if (activeSource.capabilities.home) {
            const b = await api.home(sourceId);
            setBrowseData(b);
            checkLiked((b.sections || []).flatMap((s) => s.tracks || []));
          } else if (activeSource.capabilities.liked) {
            const l = await api.liked(sourceId, 0);
            setTracksData(l.tracks || []);
            setHasMore(!!l.more);
            checkLiked(l.tracks || []);
          } else {
            setBrowseData({ title: activeSource.info.name, sections: [] });
          }
          break;
        case "browse": {
          const b = await api.browse(sourceId, route.page);
          setBrowseData(b);
          checkLiked((b.sections || []).flatMap((s) => s.tracks || []));
          break;
        }
        case "liked": {
          const l = await api.liked(sourceId, 0);
          setTracksData(l.tracks || []);
          setHasMore(!!l.more);
          checkLiked(l.tracks || []);
          break;
        }
        case "recent": {
          const r = await api.recent(sourceId);
          setTracksData(r.tracks || []);
          setHasMore(false);
          checkLiked(r.tracks || []);
          break;
        }
        case "savedAlbums": {
          const a = await api.savedAlbums(sourceId, 0);
          setAlbumsData(a.albums || []);
          setHasMore(!!a.more);
          break;
        }
        case "stations": {
          const st = await api.stations(sourceId);
          setStationsData(st.stations || []);
          break;
        }
        case "shows": {
          const sh = await api.shows(sourceId);
          setShowsData(sh.shows || []);
          break;
        }
        case "playlist": {
          const pl = await api.playlist(sourceId, route.id);
          setPlaylistDetail(pl);
          checkLiked(pl.tracks || []);
          break;
        }
        case "album": {
          const al = await api.album(sourceId, route.id);
          setAlbumDetail(al);
          checkLiked(al.tracks || []);
          break;
        }
        case "artist": {
          const ar = await api.artist(sourceId, route.id);
          setArtistDetail(ar);
          checkLiked(ar.tracks || []);
          break;
        }
        case "show": {
          const sh = await api.show(sourceId, route.id, 0);
          setShowDetail(sh);
          setHasMore(!!sh.more);
          break;
        }
      }
    } catch (e) {
      if (e instanceof ApiError) {
        setPageError({ message: e.message, code: e.code });
      } else {
        setPageError({ message: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      setLoading(false);
    }
  }, [activeSource, route, sourceId, checkLiked]);

  useEffect(() => {
    loadCurrentRoute();
  }, [loadCurrentRoute]);

  // Persist session periodically
  useEffect(() => {
    const timer = setTimeout(() => {
      api
        .saveSession({
          queue,
          index: queueIndex,
          positionMs,
          repeatMode,
          shuffle,
          stationId: stationCtx?.id,
          stationSource: stationCtx?.source,
          stationName: stationCtx?.name,
        })
        .catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [queue, queueIndex, repeatMode, shuffle, stationCtx]);

  // Playback core: load track via native AVPlayer / Media3 or HTMLAudio fallback
  const loadAndPlayTrack = useCallback(
    async (track: Track, autoplay = true) => {
      const src = track.source || sourceId;
      setBuffering(true);
      setPositionMs(0);
      setDurationMs(track.duration || 0);
      setQualityBadge("");
      try {
        const info = await api.streamInfo(src, track.id, settings.quality);
        const fullAudioUrl = `${window.location.origin}${info.streamUrl}`;
        const artworkUrl = track.album?.imageUrl ? imageProxyUrl(track.album.imageUrl, 512) : "";
        const rawGain = typeof info.normGain === "number" && info.normGain > 0 ? info.normGain : 1.0;
        const effectiveGain = settings.normalize ? rawGain : 1.0;
        setTrackNormGain(rawGain);
        setQualityBadge((info.quality || info.type || "").toUpperCase());

        if (IS_NATIVE) {
          postNative("playerLoad", {
            url: fullAudioUrl,
            title: track.name,
            artist: (track.artists || []).map((a) => a.name).join(", "),
            album: track.album?.name || "",
            artworkUrl,
            durationMs: track.duration || 0,
            autoplay,
            normGain: effectiveGain,
          });
          setPlaying(autoplay);
        } else if (audioRef.current) {
          audioRef.current.src = fullAudioUrl;
          audioRef.current.volume = Math.max(0, Math.min(1, effectiveGain));
          if (autoplay) {
            await audioRef.current.play();
            setPlaying(true);
          }
        }
        api.recordPlayed(src, track).catch(() => {});
      } catch (e) {
        setBuffering(false);
        setPlaying(false);
        showToast(e instanceof Error ? e.message : String(e));
      }
    },
    [sourceId, settings.quality, settings.normalize, showToast]
  );

  const playQueue = useCallback(
    (tracks: Track[], startIdx: number, station: { id: string; source: string; name: string } | null = null) => {
      if (!tracks.length) return;
      const clamped = Math.max(0, Math.min(startIdx, tracks.length - 1));
      setQueue(tracks);
      setQueueIndex(clamped);
      setStationCtx(station);
      loadAndPlayTrack(tracks[clamped], true);
    },
    [loadAndPlayTrack]
  );

  const handleNext = useCallback(async () => {
    const st = playbackRef.current;
    if (!st.queue.length) return;
    if (st.repeatMode === "one") {
      loadAndPlayTrack(st.queue[st.queueIndex], true);
      return;
    }
    let nextIdx = st.queueIndex + 1;
    if (st.shuffle && st.queue.length > 1) {
      nextIdx = Math.floor(Math.random() * st.queue.length);
      if (nextIdx === st.queueIndex) nextIdx = (nextIdx + 1) % st.queue.length;
    }
    if (nextIdx >= st.queue.length) {
      if (st.stationCtx) {
        try {
          const more = await api.stationNext(st.stationCtx.source, st.stationCtx.id);
          if (more.tracks && more.tracks.length > 0) {
            const combined = [...st.queue, ...more.tracks];
            setQueue(combined);
            setQueueIndex(st.queue.length);
            loadAndPlayTrack(more.tracks[0], true);
            return;
          }
        } catch {
          // ignore
        }
      }
      if (st.repeatMode === "all") {
        nextIdx = 0;
      } else {
        setPlaying(false);
        return;
      }
    }
    setQueueIndex(nextIdx);
    loadAndPlayTrack(st.queue[nextIdx], true);
  }, [loadAndPlayTrack]);

  const handlePrev = useCallback(() => {
    const st = playbackRef.current;
    if (!st.queue.length) return;
    if (st.positionMs > 4000) {
      if (IS_NATIVE) postNative("playerSeek", { positionMs: 0 });
      else if (audioRef.current) audioRef.current.currentTime = 0;
      setPositionMs(0);
      return;
    }
    const prevIdx = st.queueIndex > 0 ? st.queueIndex - 1 : st.queue.length - 1;
    setQueueIndex(prevIdx);
    loadAndPlayTrack(st.queue[prevIdx], true);
  }, [loadAndPlayTrack]);

  const handleTogglePlay = useCallback(() => {
    const st = playbackRef.current;
    if (st.queueIndex < 0 || !st.queue[st.queueIndex]) return;
    if (IS_NATIVE) {
      postNative(st.playing ? "playerPause" : "playerPlay", {});
      setPlaying(!st.playing);
    } else if (audioRef.current) {
      if (!audioRef.current.src) {
        loadAndPlayTrack(st.queue[st.queueIndex], true);
        return;
      }
      if (st.playing) {
        audioRef.current.pause();
        setPlaying(false);
      } else {
        audioRef.current.play().catch(() => {});
        setPlaying(true);
      }
    }
  }, [loadAndPlayTrack]);

  const handleSeek = useCallback((ms: number) => {
    setPositionMs(ms);
    audioRuntime.seek(ms);
    if (IS_NATIVE) {
      postNative("playerSeek", { positionMs: Math.round(ms) });
    } else if (audioRef.current) {
      audioRef.current.currentTime = ms / 1000;
    }
  }, []);

  // Register Native -> Web callback handler
  useEffect(() => {
    window.__mygoNativeEvent = (name: string, payload: unknown) => {
      const p = (payload || {}) as Record<string, unknown>;
      if (name === "audioLevel") {
        audioRuntime.pushAudioLevel(Number(p.bass || 0), Boolean(p.live));
        return;
      }
      if (name === "updateDownloadProgress") {
        const prog: UpdateDownloadProgress = {
          state: (p.state as UpdateDownloadProgress["state"]) || "downloading",
          percent: typeof p.percent === "number" ? p.percent : undefined,
          downloadedBytes: typeof p.downloadedBytes === "number" ? p.downloadedBytes : undefined,
          totalBytes: typeof p.totalBytes === "number" ? p.totalBytes : undefined,
          error: typeof p.error === "string" ? p.error : undefined,
        };
        setUpdateProgress(prog);
        return;
      }
      if (name === "playbackState") {
        if (typeof p.playing === "boolean") setPlaying(p.playing);
        if (typeof p.buffering === "boolean") setBuffering(p.buffering);
        if (typeof p.positionMs === "number") setPositionMs(p.positionMs);
        if (typeof p.durationMs === "number" && p.durationMs > 0) setDurationMs(p.durationMs);
        if (p.error) showToast(String(p.error));
        if (p.ended) handleNext();
      } else if (name === "remoteCommand") {
        const cmd = String(p.command || "");
        if (cmd === "play") {
          postNative("playerPlay", {});
          setPlaying(true);
        } else if (cmd === "pause") {
          postNative("playerPause", {});
          setPlaying(false);
        } else if (cmd === "toggle") {
          handleTogglePlay();
        } else if (cmd === "next") {
          handleNext();
        } else if (cmd === "previous") {
          handlePrev();
        } else if (cmd === "seek" && typeof p.positionMs === "number") {
          handleSeek(p.positionMs);
        }
      } else if (name === "pluginZipOpened" && typeof p.path === "string") {
        api
          .preparePluginLocal(p.path)
          .then((pending) => {
            setPendingPlugin(pending);
            setInstallOpen(true);
          })
          .catch((e) => showToast(e instanceof Error ? e.message : String(e)));
      }
    };
    return () => {
      delete window.__mygoNativeEvent;
    };
  }, [handleNext, handlePrev, handleTogglePlay, handleSeek, showToast]);

  // Subscribe to Go SSE events (sign-in prompts, webSignIn, openURL, source changes)
  useEffect(() => {
    return api.subscribeEvents({
      signInPrompt: (p) => {
        setSignInPrompt(p);
        setSignInStatus(p.text || "");
      },
      signInResult: (p) => {
        if (p.error) {
          setSignInStatus(p.reason || p.error);
          showToast(p.reason || p.error);
        } else {
          setSignInPrompt(null);
          setSignInStatus("");
          if (p.account) setAccount(p.account);
          showToast(`登录成功${p.account?.name ? `：${p.account.name}` : ""}`);
          refreshSourceSidebar();
          loadCurrentRoute();
        }
      },
      webSignIn: (p: WebSignInPayload) => {
        if (IS_NATIVE) {
          postNative("openWebSignIn", p as unknown as Record<string, unknown>);
        } else {
          setSignInStatus(`请在原生 App 内打开网页登录：${p.url}`);
        }
      },
      openURL: (p) => {
        if (IS_NATIVE) postNative("openExternal", { url: p.url });
        else window.open(p.url, "_blank");
      },
      sourcesChanged: () => refreshSources(),
      localChanged: () => {
        if (sourceId === "local") loadCurrentRoute();
      },
    });
  }, [refreshSources, refreshSourceSidebar, loadCurrentRoute, showToast, sourceId]);

  const handleStartSignIn = async () => {
    setSignInPrompt(null);
    setSignInStatus("正在准备登录...");
    try {
      await api.startSignIn(sourceId);
    } catch (e) {
      setSignInStatus("");
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const handleToggleLikeTrack = async (track: Track) => {
    const src = track.source || sourceId;
    const next = !likedMap[track.id];
    setLikedMap((prev) => ({ ...prev, [track.id]: next }));
    try {
      await api.like(src, track.id, next, !!track.showId);
    } catch (e) {
      setLikedMap((prev) => ({ ...prev, [track.id]: !next }));
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const handleUpdateSettings = async (patch: Partial<MobileSettings>) => {
    const next = await api.updateSettings(patch);
    setSettings(next);
    if (patch.activeSource) {
      setRouteStack([{ kind: "home" }]);
    }
    if (patch.language) {
      await refreshSources();
    }
    if (patch.updateChannel !== undefined || patch.autoCheckUpdates !== undefined) {
      api.updateStatus().then(setUpdateStatus).catch(() => {});
    }
  };

  const openNowPlayingOverlay = useCallback(() => {
    if (!currentTrack) return;
    if (miniCoverRef.current) {
      setMiniCoverRect(miniCoverRef.current.getBoundingClientRect());
    }
    setNowPlayingOpen(true);
  }, [currentTrack]);

  const runSearch = async (q = searchQuery, kind = searchKind, offset = 0) => {
    if (!q.trim()) return;
    setLoading(true);
    setSuggestions([]);
    try {
      const res = await api.search(sourceId, q.trim(), kind, offset);
      if (offset === 0) {
        setSearchRes(res);
      } else {
        setSearchRes((prev) => ({
          tracks: [...(prev?.tracks || []), ...(res.tracks || [])],
          albums: [...(prev?.albums || []), ...(res.albums || [])],
          artists: [...(prev?.artists || []), ...(res.artists || [])],
          playlists: [...(prev?.playlists || []), ...(res.playlists || [])],
          shows: [...(prev?.shows || []), ...(res.shows || [])],
          more: res.more,
        }));
      }
      checkLiked(res.tracks || []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const startStation = async (st: Station) => {
    try {
      const res = await api.stationNext(sourceId, st.id);
      if (!res.tracks || res.tracks.length === 0) {
        showToast("电台暂无可播放歌曲");
        return;
      }
      playQueue(res.tracks, 0, { id: st.id, source: sourceId, name: st.name });
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const openNavItem = (item: NavItem) => {
    if (item.page) {
      navigate({ kind: "browse", page: item.page, title: item.title }, true);
      return;
    }
    switch (item.builtin) {
      case "home":
        navigate({ kind: "home" }, true);
        break;
      case "liked":
        navigate({ kind: "liked", title: item.title }, true);
        break;
      case "savedAlbums":
        navigate({ kind: "savedAlbums", title: item.title }, true);
        break;
      case "recent":
        navigate({ kind: "recent", title: item.title }, true);
        break;
      case "stations":
        navigate({ kind: "stations", title: item.title }, true);
        break;
      case "shows":
        navigate({ kind: "shows", title: item.title }, true);
        break;
      default:
        navigate({ kind: "home" }, true);
    }
  };

  const navItems = useMemo(() => defaultNav(activeSource, t), [activeSource, t]);

  const renderSection = (sec: Section, idx: number) => (
    <div key={`${sec.title || "sec"}-${idx}`} className="section">
      {(sec.title || sec.morePage) && (
        <div className="section-head">
          <h2>{sec.title}</h2>
          {sec.morePage && (
            <button className="btn" onClick={() => navigate({ kind: "browse", page: sec.morePage!, title: sec.title })}>
              {t("Load More")}
            </button>
          )}
        </div>
      )}

      {sec.tracks && sec.tracks.length > 0 && (
        <TrackList
          tracks={sec.tracks}
          currentTrackId={currentTrack?.id}
          likedMap={likedMap}
          canLike={!!activeSource?.capabilities.like}
          playlists={playlists}
          canAddToPlaylist={!!activeSource?.capabilities.addToPlaylist}
          onPlay={(ts, i) => playQueue(ts, i)}
          onToggleLike={handleToggleLikeTrack}
          onAddToQueue={(tr) => {
            setQueue((q) => [...q, tr]);
            showToast(`已加入队列：${tr.name}`);
          }}
          onAddToPlaylist={(plId, tr) =>
            api.addToPlaylist(sourceId, plId, [tr.id]).then(() => showToast("已添加到歌单"))
          }
          onOpenArtist={activeSource?.capabilities.artist ? (id) => navigate({ kind: "artist", id }) : undefined}
          onOpenAlbum={activeSource?.capabilities.album ? (id) => navigate({ kind: "album", id }) : undefined}
          t={t}
        />
      )}

      {sec.playlists && sec.playlists.length > 0 && (
        <div className="card-grid">
          {sec.playlists.map((pl) => (
            <button key={pl.id} className="card" onClick={() => navigate({ kind: "playlist", id: pl.id })}>
              <div className="card-art">
                {pl.imageUrl ? <img src={imageProxyUrl(pl.imageUrl, 320)} loading="lazy" alt="" /> : <Icon name="playlist" size={32} />}
              </div>
              <div className="card-title">{pl.name}</div>
              {pl.owner && <div className="card-sub">{pl.owner}</div>}
            </button>
          ))}
        </div>
      )}

      {sec.albums && sec.albums.length > 0 && (
        <div className="card-grid">
          {sec.albums.map((al) => (
            <button key={al.id} className="card" onClick={() => navigate({ kind: "album", id: al.id })}>
              <div className="card-art">
                {al.imageUrl ? <img src={imageProxyUrl(al.imageUrl, 320)} loading="lazy" alt="" /> : <Icon name="album" size={32} />}
              </div>
              <div className="card-title">{al.name}</div>
              <div className="card-sub">{(al.artists || []).map((a) => a.name).join(", ") || al.released}</div>
            </button>
          ))}
        </div>
      )}

      {sec.artists && sec.artists.length > 0 && (
        <div className="card-grid">
          {sec.artists.map((ar) => (
            <button key={ar.id} className="card" onClick={() => navigate({ kind: "artist", id: ar.id })}>
              <div className="card-art round">
                {ar.imageUrl ? <img src={imageProxyUrl(ar.imageUrl, 320)} loading="lazy" alt="" /> : <Icon name="artist" size={32} />}
              </div>
              <div className="card-title" style={{ textAlign: "center" }}>{ar.name}</div>
            </button>
          ))}
        </div>
      )}

      {sec.shows && sec.shows.length > 0 && (
        <div className="card-grid">
          {sec.shows.map((sh) => (
            <button key={sh.id} className="card" onClick={() => navigate({ kind: "show", id: sh.id })}>
              <div className="card-art">
                {sh.imageUrl ? <img src={imageProxyUrl(sh.imageUrl, 320)} loading="lazy" alt="" /> : <Icon name="podcast" size={32} />}
              </div>
              <div className="card-title">{sh.name}</div>
              {sh.publisher && <div className="card-sub">{sh.publisher}</div>}
            </button>
          ))}
        </div>
      )}

      {sec.stations && sec.stations.length > 0 && (
        <div className="card-grid">
          {sec.stations.map((st) => (
            <button key={st.id} className="card" onClick={() => startStation(st)}>
              <div className="card-art">
                {st.imageUrl ? <img src={imageProxyUrl(st.imageUrl, 320)} loading="lazy" alt="" /> : <Icon name="radio" size={32} />}
              </div>
              <div className="card-title">{st.name}</div>
              {st.description && <div className="card-sub">{st.description}</div>}
            </button>
          ))}
        </div>
      )}

      {sec.links && sec.links.length > 0 && (
        <div className="card-grid">
          {sec.links.map((lk) => (
            <button key={lk.page} className="card" onClick={() => navigate({ kind: "browse", page: lk.page, title: lk.title })}>
              <div className="card-art">
                {lk.imageUrl ? <img src={imageProxyUrl(lk.imageUrl, 320)} loading="lazy" alt="" /> : <Icon name="star" size={32} />}
              </div>
              <div className="card-title">{lk.title}</div>
              {lk.subtitle && <div className="card-sub">{lk.subtitle}</div>}
            </button>
          ))}
        </div>
      )}

      {sec.empty &&
        !sec.tracks?.length &&
        !sec.albums?.length &&
        !sec.artists?.length &&
        !sec.playlists?.length &&
        !sec.shows?.length &&
        !sec.stations?.length &&
        !sec.links?.length && <div style={{ color: "var(--text-2)", fontSize: 13 }}>{sec.empty}</div>}
    </div>
  );

  const renderMainContent = () => {
    if (route.kind === "settings") {
      return (
        <SettingsPage
          settings={settings}
          sources={sources}
          updateStatus={updateStatus}
          checkingUpdate={checkingUpdate}
          onUpdateSettings={handleUpdateSettings}
          onRefreshSources={refreshSources}
          onOpenInstall={(p) => {
            setPendingPlugin(p || null);
            setInstallOpen(true);
          }}
          onCheckAppUpdate={() => runAppUpdateCheck(true)}
          onToast={showToast}
          t={t}
        />
      );
    }

    if (route.kind === "library") {
      return (
        <div>
          <div className="page-header">
            <h1>{t("Library")}</h1>
          </div>
          {activeSource?.capabilities.signIn && (
            <div className="settings-group" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {account?.imageUrl ? (
                  <img src={imageProxyUrl(account.imageUrl, 80)} style={{ width: 38, height: 38, borderRadius: "50%" }} alt="" />
                ) : (
                  <Icon name="artist" size={24} />
                )}
                <div>
                  <div style={{ fontWeight: 700 }}>{account ? account.name : t("Not signed in")}</div>
                  <div style={{ fontSize: 12, color: "var(--text-2)" }}>{activeSource.info.name}</div>
                </div>
              </div>
              {account ? (
                <button
                  className="btn"
                  onClick={() => api.signOut(sourceId).then(() => { setAccount(null); showToast("已退出登录"); })}
                >
                  {t("Sign Out")}
                </button>
              ) : (
                <button className="btn btn-primary" onClick={handleStartSignIn}>
                  {t("Sign In")}
                </button>
              )}
            </div>
          )}

          <div className="settings-group">
            {navItems.map((item, idx) => (
              <button key={idx} className="nav-btn" onClick={() => openNavItem(item)}>
                <Icon name={item.icon || "note"} size={18} />
                <span className="truncate">{item.title}</span>
              </button>
            ))}
          </div>

          {playlists.length > 0 && (
            <div className="section">
              <div className="section-head">
                <h2>{t("Playlists")}</h2>
                {activeSource?.capabilities.createPlaylist && (
                  <button
                    className="btn"
                    onClick={() => {
                      const name = window.prompt(t("New Playlist"));
                      if (name?.trim()) {
                        api.createPlaylist(sourceId, name.trim()).then(() => refreshSourceSidebar());
                      }
                    }}
                  >
                    <Icon name="plus" size={15} /> {t("New Playlist")}
                  </button>
                )}
              </div>
              <div className="card-grid">
                {playlists.map((pl) => (
                  <button key={pl.id} className="card" onClick={() => navigate({ kind: "playlist", id: pl.id })}>
                    <div className="card-art">
                      {pl.imageUrl ? <img src={imageProxyUrl(pl.imageUrl, 300)} loading="lazy" alt="" /> : <Icon name="playlist" size={30} />}
                    </div>
                    <div className="card-title">{pl.name}</div>
                    {pl.trackCount ? <div className="card-sub">{pl.trackCount} 首</div> : null}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    if (route.kind === "search") {
      return (
        <div>
          <div className="page-header">
            <h1>{t("Search")}</h1>
          </div>
          <div className="search-bar">
            <Icon name="search" size={18} />
            <input
              placeholder={t("Search songs, albums, artists...")}
              value={searchQuery}
              onChange={(e) => {
                const v = e.target.value;
                setSearchQuery(v);
                if (v.trim() && activeSource?.capabilities.suggest) {
                  api.suggest(sourceId, v.trim()).then((r) => setSuggestions(r.suggestions || [])).catch(() => {});
                } else {
                  setSuggestions([]);
                }
              }}
              onKeyDown={(e) => e.key === "Enter" && runSearch(searchQuery, searchKind, 0)}
            />
            {searchQuery && (
              <button className="icon-btn" onClick={() => { setSearchQuery(""); setSearchRes(null); setSuggestions([]); }}>
                <Icon name="close" size={16} />
              </button>
            )}
          </div>

          {suggestions.length > 0 && (
            <div className="pill-row">
              {suggestions.map((sg) => (
                <button
                  key={sg}
                  className="pill"
                  onClick={() => {
                    setSearchQuery(sg);
                    runSearch(sg, searchKind, 0);
                  }}
                >
                  {sg}
                </button>
              ))}
            </div>
          )}

          <div className="pill-row">
            {(["tracks", "albums", "artists", "playlists", "shows"] as const).map((k) => (
              <button
                key={k}
                className={`pill ${searchKind === k ? "active" : ""}`}
                onClick={() => {
                  setSearchKind(k);
                  if (searchQuery.trim()) runSearch(searchQuery, k, 0);
                }}
              >
                {t(k === "tracks" ? "Tracks" : k === "albums" ? "Albums" : k === "artists" ? "Artists" : k === "playlists" ? "Playlists" : "Shows")}
              </button>
            ))}
          </div>

          {loading && <div className="empty-box">Loading...</div>}
          {!loading && searchRes && (
            <>
              {renderSection(
                {
                  tracks: searchRes.tracks,
                  albums: searchRes.albums,
                  artists: searchRes.artists,
                  playlists: searchRes.playlists,
                  shows: searchRes.shows,
                },
                0
              )}
              {searchRes.more && (
                <button
                  className="btn"
                  onClick={() => {
                    const currentCount =
                      (searchRes.tracks?.length || 0) +
                      (searchRes.albums?.length || 0) +
                      (searchRes.artists?.length || 0) +
                      (searchRes.playlists?.length || 0) +
                      (searchRes.shows?.length || 0);
                    runSearch(searchQuery, searchKind, currentCount);
                  }}
                >
                  {t("Load More")}
                </button>
              )}
            </>
          )}
        </div>
      );
    }

    if (pageError) {
      return (
        <div className="empty-box">
          <div style={{ fontWeight: 700, fontSize: 17 }}>
            {pageError.code === "signIn"
              ? t("Needs Sign In")
              : pageError.code === "setup"
              ? t("Needs Setup")
              : pageError.message}
          </div>
          {pageError.code && <div style={{ fontSize: 13 }}>{pageError.message}</div>}
          <div style={{ display: "flex", gap: 10 }}>
            {pageError.code === "signIn" && activeSource?.capabilities.signIn && (
              <button className="btn btn-primary" onClick={handleStartSignIn}>
                {t("Sign In")}
              </button>
            )}
            {pageError.code === "setup" && (
              <button className="btn btn-primary" onClick={() => navigate({ kind: "settings" })}>
                {t("Go to Settings")}
              </button>
            )}
            <button className="btn" onClick={loadCurrentRoute}>
              {t("Retry")}
            </button>
          </div>
        </div>
      );
    }

    if (loading) {
      return <div className="empty-box">Loading...</div>;
    }

    if (route.kind === "home" || route.kind === "browse") {
      return (
        <div>
          <div className="page-header">
            {routeStack.length > 1 && (
              <button className="icon-btn" onClick={goBack}>
                <Icon name="back" size={22} />
              </button>
            )}
            <div>
              <h1>{(route.kind === "browse" ? route.title : "") || browseData?.title || activeSource?.info.name}</h1>
              {browseData?.subtitle && <div className="page-subtitle">{browseData.subtitle}</div>}
            </div>
          </div>
          {browseData?.description && (
            <div style={{ color: "var(--text-2)", marginBottom: 18, whiteSpace: "pre-line" }}>{browseData.description}</div>
          )}
          {(browseData?.sections || []).length === 0 ? (
            <div className="empty-box">
              <div>{sourceId === "local" ? "尚未导入本地音乐，或前往设置安装音乐插件。" : "暂无内容"}</div>
              <button className="btn btn-primary" onClick={() => navigate({ kind: "settings" })}>
                {t("Install Plugin")} / {t("Settings")}
              </button>
            </div>
          ) : (
            (browseData?.sections || []).map((sec, idx) => renderSection(sec, idx))
          )}
        </div>
      );
    }

    if (route.kind === "liked" || route.kind === "recent") {
      return (
        <div>
          <div className="page-header" style={{ justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {routeStack.length > 1 && (
                <button className="icon-btn" onClick={goBack}>
                  <Icon name="back" size={22} />
                </button>
              )}
              <h1>{route.title || (route.kind === "liked" ? t("Liked Songs") : t("Recent"))}</h1>
            </div>
            {tracksData.length > 0 && (
              <button className="btn btn-primary" onClick={() => playQueue(tracksData, 0)}>
                <Icon name="play" size={16} /> {t("Play All")}
              </button>
            )}
          </div>
          <TrackList
            tracks={tracksData}
            currentTrackId={currentTrack?.id}
            likedMap={likedMap}
            canLike={!!activeSource?.capabilities.like}
            playlists={playlists}
            canAddToPlaylist={!!activeSource?.capabilities.addToPlaylist}
            onPlay={(ts, i) => playQueue(ts, i)}
            onToggleLike={handleToggleLikeTrack}
            onAddToQueue={(tr) => { setQueue((q) => [...q, tr]); showToast(`已加入队列：${tr.name}`); }}
            onAddToPlaylist={(plId, tr) => api.addToPlaylist(sourceId, plId, [tr.id]).then(() => showToast("已添加到歌单"))}
            onOpenArtist={activeSource?.capabilities.artist ? (id) => navigate({ kind: "artist", id }) : undefined}
            onOpenAlbum={activeSource?.capabilities.album ? (id) => navigate({ kind: "album", id }) : undefined}
            t={t}
          />
          {route.kind === "liked" && hasMore && (
            <button
              className="btn"
              style={{ marginTop: 14 }}
              onClick={() =>
                api.liked(sourceId, tracksData.length).then((r) => {
                  setTracksData((prev) => [...prev, ...(r.tracks || [])]);
                  setHasMore(!!r.more);
                  checkLiked(r.tracks || []);
                })
              }
            >
              {t("Load More")}
            </button>
          )}
        </div>
      );
    }

    if (route.kind === "savedAlbums") {
      return (
        <div>
          <div className="page-header">
            <h1>{route.title || t("Saved Albums")}</h1>
          </div>
          {renderSection({ albums: albumsData }, 0)}
        </div>
      );
    }

    if (route.kind === "stations") {
      return (
        <div>
          <div className="page-header">
            <h1>{route.title || t("Stations")}</h1>
          </div>
          {renderSection({ stations: stationsData }, 0)}
        </div>
      );
    }

    if (route.kind === "shows") {
      return (
        <div>
          <div className="page-header">
            <h1>{route.title || t("Shows")}</h1>
          </div>
          {renderSection({ shows: showsData }, 0)}
        </div>
      );
    }

    if (route.kind === "playlist" && playlistDetail) {
      const tracks = playlistDetail.tracks || [];
      return (
        <div>
          <div className="page-header">
            <button className="icon-btn" onClick={goBack}>
              <Icon name="back" size={22} />
            </button>
            <span style={{ color: "var(--text-2)" }}>{t("Playlists")}</span>
          </div>
          <div className="hero">
            <div className="hero-art">
              {playlistDetail.imageUrl ? <img src={imageProxyUrl(playlistDetail.imageUrl, 400)} alt="" /> : <Icon name="playlist" size={56} />}
            </div>
            <div className="hero-info">
              <h1>{playlistDetail.name}</h1>
              {playlistDetail.description && <div className="hero-desc">{playlistDetail.description}</div>}
              <div className="hero-actions">
                <button className="btn btn-primary" disabled={!tracks.length} onClick={() => playQueue(tracks, 0)}>
                  <Icon name="play" size={16} /> {t("Play All")}
                </button>
                {activeSource?.capabilities.savePlaylist && !playlistDetail.mine && (
                  <button
                    className="btn"
                    onClick={() => {
                      const next = !playlistDetail.saved;
                      api.savePlaylist(sourceId, playlistDetail.id, next).then(() => {
                        setPlaylistDetail({ ...playlistDetail, saved: next });
                        refreshSourceSidebar();
                      });
                    }}
                  >
                    {playlistDetail.saved ? t("Saved") : t("Save")}
                  </button>
                )}
              </div>
            </div>
          </div>
          <TrackList
            tracks={tracks}
            currentTrackId={currentTrack?.id}
            likedMap={likedMap}
            canLike={!!activeSource?.capabilities.like}
            playlists={playlists}
            canAddToPlaylist={!!activeSource?.capabilities.addToPlaylist}
            onPlay={(ts, i) => playQueue(ts, i)}
            onToggleLike={handleToggleLikeTrack}
            onAddToQueue={(tr) => { setQueue((q) => [...q, tr]); showToast(`已加入队列：${tr.name}`); }}
            onAddToPlaylist={(plId, tr) => api.addToPlaylist(sourceId, plId, [tr.id]).then(() => showToast("已添加到歌单"))}
            onOpenArtist={activeSource?.capabilities.artist ? (id) => navigate({ kind: "artist", id }) : undefined}
            onOpenAlbum={activeSource?.capabilities.album ? (id) => navigate({ kind: "album", id }) : undefined}
            t={t}
          />
        </div>
      );
    }

    if (route.kind === "album" && albumDetail) {
      const tracks = albumDetail.tracks || [];
      return (
        <div>
          <div className="page-header">
            <button className="icon-btn" onClick={goBack}>
              <Icon name="back" size={22} />
            </button>
            <span style={{ color: "var(--text-2)" }}>{t("Albums")}</span>
          </div>
          <div className="hero">
            <div className="hero-art">
              {albumDetail.album.imageUrl ? <img src={imageProxyUrl(albumDetail.album.imageUrl, 400)} alt="" /> : <Icon name="album" size={56} />}
            </div>
            <div className="hero-info">
              <h1>{albumDetail.album.name}</h1>
              <div className="hero-desc">
                {(albumDetail.album.artists || []).map((a) => a.name).join(", ")}
                {albumDetail.album.released ? ` · ${albumDetail.album.released}` : ""}
              </div>
              <div className="hero-actions">
                <button className="btn btn-primary" disabled={!tracks.length} onClick={() => playQueue(tracks, 0)}>
                  <Icon name="play" size={16} /> {t("Play All")}
                </button>
                {activeSource?.capabilities.saveAlbum && (
                  <button
                    className="btn"
                    onClick={() => {
                      const next = !albumDetail.album.saved;
                      api.saveAlbum(sourceId, albumDetail.album.id, next).then(() =>
                        setAlbumDetail({ ...albumDetail, album: { ...albumDetail.album, saved: next } })
                      );
                    }}
                  >
                    {albumDetail.album.saved ? t("Saved") : t("Save")}
                  </button>
                )}
              </div>
            </div>
          </div>
          <TrackList
            tracks={tracks}
            currentTrackId={currentTrack?.id}
            likedMap={likedMap}
            canLike={!!activeSource?.capabilities.like}
            playlists={playlists}
            canAddToPlaylist={!!activeSource?.capabilities.addToPlaylist}
            onPlay={(ts, i) => playQueue(ts, i)}
            onToggleLike={handleToggleLikeTrack}
            onAddToQueue={(tr) => { setQueue((q) => [...q, tr]); showToast(`已加入队列：${tr.name}`); }}
            onAddToPlaylist={(plId, tr) => api.addToPlaylist(sourceId, plId, [tr.id]).then(() => showToast("已添加到歌单"))}
            onOpenArtist={activeSource?.capabilities.artist ? (id) => navigate({ kind: "artist", id }) : undefined}
            t={t}
          />
        </div>
      );
    }

    if (route.kind === "artist" && artistDetail) {
      return (
        <div>
          <div className="page-header">
            <button className="icon-btn" onClick={goBack}>
              <Icon name="back" size={22} />
            </button>
            <span style={{ color: "var(--text-2)" }}>{t("Artists")}</span>
          </div>
          <div className="hero">
            <div className="hero-art round">
              {artistDetail.artist.imageUrl ? <img src={imageProxyUrl(artistDetail.artist.imageUrl, 400)} alt="" /> : <Icon name="artist" size={56} />}
            </div>
            <div className="hero-info">
              <h1>{artistDetail.artist.name}</h1>
              <div className="hero-actions">
                {artistDetail.tracks && artistDetail.tracks.length > 0 && (
                  <button className="btn btn-primary" onClick={() => playQueue(artistDetail.tracks!, 0)}>
                    <Icon name="play" size={16} /> {t("Play All")}
                  </button>
                )}
                {activeSource?.capabilities.followArtist && (
                  <button
                    className="btn"
                    onClick={() => {
                      const next = !artistDetail.artist.following;
                      api.followArtist(sourceId, artistDetail.artist.id, next).then(() =>
                        setArtistDetail({ ...artistDetail, artist: { ...artistDetail.artist, following: next } })
                      );
                    }}
                  >
                    {artistDetail.artist.following ? t("Following") : t("Follow")}
                  </button>
                )}
              </div>
            </div>
          </div>
          {artistDetail.tracks && artistDetail.tracks.length > 0 && renderSection({ title: t("Tracks"), tracks: artistDetail.tracks }, 0)}
          {artistDetail.albums && artistDetail.albums.length > 0 && renderSection({ title: t("Albums"), albums: artistDetail.albums }, 1)}
        </div>
      );
    }

    if (route.kind === "show" && showDetail) {
      const eps = showDetail.episodes || [];
      return (
        <div>
          <div className="page-header">
            <button className="icon-btn" onClick={goBack}>
              <Icon name="back" size={22} />
            </button>
            <span style={{ color: "var(--text-2)" }}>{t("Shows")}</span>
          </div>
          <div className="hero">
            <div className="hero-art">
              {showDetail.show.imageUrl ? <img src={imageProxyUrl(showDetail.show.imageUrl, 400)} alt="" /> : <Icon name="podcast" size={56} />}
            </div>
            <div className="hero-info">
              <h1>{showDetail.show.name}</h1>
              {showDetail.show.description && <div className="hero-desc">{showDetail.show.description}</div>}
              <div className="hero-actions">
                <button className="btn btn-primary" disabled={!eps.length} onClick={() => playQueue(eps, 0)}>
                  <Icon name="play" size={16} /> {t("Play All")}
                </button>
                {activeSource?.capabilities.subscribeShow && (
                  <button
                    className="btn"
                    onClick={() => {
                      const next = !showDetail.show.subscribed;
                      api.subscribeShow(sourceId, showDetail.show.id, next).then(() =>
                        setShowDetail({ ...showDetail, show: { ...showDetail.show, subscribed: next } })
                      );
                    }}
                  >
                    {showDetail.show.subscribed ? t("Subscribed") : t("Subscribe")}
                  </button>
                )}
              </div>
            </div>
          </div>
          <TrackList
            tracks={eps}
            currentTrackId={currentTrack?.id}
            likedMap={likedMap}
            canLike={!!activeSource?.capabilities.likeEpisode}
            playlists={playlists}
            canAddToPlaylist={false}
            onPlay={(ts, i) => playQueue(ts, i)}
            onToggleLike={handleToggleLikeTrack}
            onAddToQueue={(tr) => { setQueue((q) => [...q, tr]); showToast(`已加入队列：${tr.name}`); }}
            onAddToPlaylist={() => {}}
            t={t}
          />
          {hasMore && (
            <button
              className="btn"
              style={{ marginTop: 14 }}
              onClick={() =>
                api.show(sourceId, showDetail.show.id, eps.length).then((r) => {
                  setShowDetail({ show: showDetail.show, episodes: [...eps, ...(r.episodes || [])], more: r.more });
                  setHasMore(!!r.more);
                })
              }
            >
              {t("Load More")}
            </button>
          )}
        </div>
      );
    }

    return null;
  };

  const effectiveDuration = durationMs || currentTrack?.duration || 0;
  const barPos = scrubMs !== null ? scrubMs : positionMs;

  return (
    <div className="app-shell">
      {/* Desktop browser fallback audio element (native apps use AVPlayer / Media3 ExoPlayer) */}
      {!IS_NATIVE && (
        <audio
          ref={audioRef}
          onTimeUpdate={(e) => setPositionMs(e.currentTarget.currentTime * 1000)}
          onDurationChange={(e) => {
            if (isFinite(e.currentTarget.duration)) setDurationMs(e.currentTarget.duration * 1000);
          }}
          onPlaying={() => { setPlaying(true); setBuffering(false); }}
          onWaiting={() => setBuffering(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => handleNext()}
        />
      )}

      {/* iPad / Tablet Sidebar */}
      <aside className="sidebar">
        <div className="source-picker">
          <Icon name="note" size={16} />
          <select
            value={sourceId}
            onChange={(e) => handleUpdateSettings({ activeSource: e.target.value })}
          >
            {enabledSources.map((s) => (
              <option key={s.info.id} value={s.info.id}>
                {s.info.name}
              </option>
            ))}
          </select>
        </div>

        {activeSource?.capabilities.signIn && (
          <button
            className="account-chip"
            onClick={() => {
              if (account) {
                if (window.confirm(`退出 ${account.name}？`)) {
                  api.signOut(sourceId).then(() => { setAccount(null); showToast("已退出登录"); });
                }
              } else {
                handleStartSignIn();
              }
            }}
          >
            {account?.imageUrl ? (
              <img src={imageProxyUrl(account.imageUrl, 64)} alt="" />
            ) : (
              <Icon name="artist" size={16} />
            )}
            <span>{account ? account.name : t("Sign In")}</span>
          </button>
        )}

        {activeSource?.capabilities.search && (
          <button
            className={`nav-btn ${route.kind === "search" ? "active" : ""}`}
            onClick={() => navigate({ kind: "search" }, true)}
          >
            <Icon name="search" size={17} />
            <span>{t("Search")}</span>
          </button>
        )}

        {navItems.map((item, idx) => {
          const isActive =
            (item.page && route.kind === "browse" && route.page === item.page) ||
            (item.builtin && route.kind === item.builtin);
          return (
            <button key={`${item.title}-${idx}`} className={`nav-btn ${isActive ? "active" : ""}`} onClick={() => openNavItem(item)}>
              <Icon name={item.icon || "note"} size={17} />
              <span className="truncate">{item.title}</span>
            </button>
          );
        })}

        {playlists.length > 0 && (
          <>
            <div className="nav-section-title">
              <span>{t("Playlists")}</span>
              {activeSource?.capabilities.createPlaylist && (
                <button
                  className="icon-btn"
                  style={{ width: 24, height: 24 }}
                  onClick={() => {
                    const name = window.prompt(t("New Playlist"));
                    if (name?.trim()) api.createPlaylist(sourceId, name.trim()).then(() => refreshSourceSidebar());
                  }}
                >
                  <Icon name="plus" size={14} />
                </button>
              )}
            </div>
            {playlists.map((pl) => (
              <button
                key={pl.id}
                className={`nav-btn ${route.kind === "playlist" && route.id === pl.id ? "active" : ""}`}
                onClick={() => navigate({ kind: "playlist", id: pl.id })}
              >
                <Icon name="playlist" size={15} />
                <span className="truncate">{pl.name}</span>
              </button>
            ))}
          </>
        )}

        <div style={{ marginTop: "auto", paddingTop: 14 }}>
          <button
            className={`nav-btn ${route.kind === "settings" ? "active" : ""}`}
            onClick={() => navigate({ kind: "settings" }, true)}
          >
            <Icon name="settings" size={17} />
            <span>{t("Plugins")} & {t("Settings")}</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-pane">
        {/* Phone Topbar */}
        <header className="mobile-topbar">
          <div className="source-picker" style={{ marginBottom: 0, flex: 1 }}>
            <Icon name="note" size={15} />
            <select value={sourceId} onChange={(e) => handleUpdateSettings({ activeSource: e.target.value })}>
              {enabledSources.map((s) => (
                <option key={s.info.id} value={s.info.id}>
                  {s.info.name}
                </option>
              ))}
            </select>
          </div>
          {activeSource?.capabilities.signIn && !account && (
            <button className="btn btn-primary" style={{ padding: "6px 12px", fontSize: 13 }} onClick={handleStartSignIn}>
              {t("Sign In")}
            </button>
          )}
        </header>

        <div className="main-scroll">{renderMainContent()}</div>
      </main>

      {/* Player Bar */}
      <footer className="player-bar">
        <div className="player-left" onClick={openNowPlayingOverlay}>
          <div
            ref={miniCoverRef}
            className="player-cover"
            style={{ opacity: hideMiniCover ? 0 : 1, transition: "opacity 80ms ease" }}
          >
            {currentTrack?.album?.imageUrl ? (
              <img src={imageProxyUrl(currentTrack.album.imageUrl, 128)} alt="" />
            ) : (
              <Icon name="note" size={20} />
            )}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {currentTrack ? currentTrack.name : t("Nothing playing")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {currentTrack ? (currentTrack.artists || []).map((a) => a.name).join(", ") : activeSource?.info.name || ""}
            </div>
          </div>
        </div>

        <div className="player-center">
          <div className="player-controls">
            <button className="icon-btn" onClick={handlePrev} aria-label="Prev">
              <Icon name="prev" size={18} />
            </button>
            <button className="play-circle" onClick={handleTogglePlay} aria-label="Play/Pause">
              <Icon name={playing ? "pause" : "play"} size={18} />
            </button>
            <button className="icon-btn" onClick={handleNext} aria-label="Next">
              <Icon name="next" size={18} />
            </button>
          </div>
          <div className="scrubber-row">
            <span>{formatDuration(barPos)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SmokeScrubber
                value={barPos}
                max={effectiveDuration}
                playing={playing}
                buffering={buffering}
                smokeEnabled={settings.smoke}
                accent={palette.accent}
                onChange={(ms) => setScrubMs(ms)}
                onCommit={(ms) => {
                  setScrubMs(null);
                  handleSeek(ms);
                }}
                compact
              />
            </div>
            <span>{buffering ? "..." : formatDuration(effectiveDuration)}</span>
          </div>
        </div>

        <div className="player-right">
          {qualityBadge && <span className="quality-badge">{qualityBadge}</span>}
          {currentTrack && currentSourceObj?.capabilities.like && (
            <button
              className={`icon-btn ${likedMap[currentTrack.id] ? "accent" : ""}`}
              onClick={() => handleToggleLikeTrack(currentTrack)}
            >
              <Icon name="heart" size={18} filled={!!likedMap[currentTrack.id]} />
            </button>
          )}
          <button
            className={`icon-btn ${shuffle ? "accent" : ""}`}
            onClick={() => setShuffle((s) => !s)}
          >
            <Icon name="shuffle" size={17} />
          </button>
          <button
            className={`icon-btn ${repeatMode !== "off" ? "accent" : ""}`}
            onClick={() => setRepeatMode((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"))}
          >
            <Icon name="repeat" size={17} />
          </button>
          <button className="icon-btn" onClick={openNowPlayingOverlay}>
            <Icon name="lyrics" size={18} />
          </button>
        </div>
      </footer>

      {/* Phone Bottom Tabs */}
      <nav className="mobile-tabbar">
        <button className={`tab-btn ${route.kind === "home" || route.kind === "browse" ? "active" : ""}`} onClick={() => navigate({ kind: "home" }, true)}>
          <Icon name="home" size={20} />
          <span>{t("Home")}</span>
        </button>
        <button className={`tab-btn ${route.kind === "search" ? "active" : ""}`} onClick={() => navigate({ kind: "search" }, true)}>
          <Icon name="search" size={20} />
          <span>{t("Search")}</span>
        </button>
        <button className={`tab-btn ${route.kind === "library" || route.kind === "liked" || route.kind === "playlist" ? "active" : ""}`} onClick={() => navigate({ kind: "library" }, true)}>
          <Icon name="playlist" size={20} />
          <span>{t("Library")}</span>
        </button>
        <button className={`tab-btn ${route.kind === "settings" ? "active" : ""}`} onClick={() => navigate({ kind: "settings" }, true)}>
          <Icon name="settings" size={20} />
          <span>{t("Settings")}</span>
        </button>
      </nav>

      <NowPlaying
        open={nowPlayingOpen}
        onClose={() => {
          if (miniCoverRef.current) {
            setMiniCoverRect(miniCoverRef.current.getBoundingClientRect());
          }
          setNowPlayingOpen(false);
        }}
        onAnimatingChange={setHideMiniCover}
        miniCoverRect={miniCoverRect}
        track={currentTrack}
        queue={queue}
        index={queueIndex}
        playing={playing}
        buffering={buffering}
        positionMs={positionMs}
        durationMs={durationMs}
        qualityBadge={qualityBadge}
        repeatMode={repeatMode}
        shuffle={shuffle}
        liked={!!(currentTrack && likedMap[currentTrack.id])}
        canLike={!!currentSourceObj?.capabilities.like}
        canComments={!!currentSourceObj?.capabilities.comments}
        canPostComment={!!currentSourceObj?.capabilities.postComment}
        canLikeComment={!!currentSourceObj?.capabilities.likeComment}
        settings={settings}
        palette={palette}
        onUpdateSettings={handleUpdateSettings}
        onTogglePlay={handleTogglePlay}
        onPrev={handlePrev}
        onNext={handleNext}
        onSeek={handleSeek}
        onSelectQueueIndex={(qi) => {
          setQueueIndex(qi);
          loadAndPlayTrack(queue[qi], true);
        }}
        onToggleLike={() => currentTrack && handleToggleLikeTrack(currentTrack)}
        onToggleShuffle={() => setShuffle((s) => !s)}
        onCycleRepeat={() => setRepeatMode((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"))}
        onToast={showToast}
        t={t}
      />

      <UpdateModal
        release={updateModalRelease}
        progress={updateProgress}
        onClose={() => setUpdateModalRelease(null)}
        onSkip={async (ver) => {
          try {
            const next = await api.skipAppUpdate(ver);
            setSettings(next);
          } catch {
            // ignore
          }
          setUpdateModalRelease(null);
        }}
        t={t}
      />

      <PluginInstallModal
        open={installOpen}
        initialPending={pendingPlugin}
        onClose={() => {
          setInstallOpen(false);
          setPendingPlugin(null);
        }}
        onInstalled={async (id) => {
          await refreshSources();
          await handleUpdateSettings({ activeSource: id });
          showToast(`已安装并切换到 ${id}`);
        }}
        t={t}
      />

      <SignInModal
        prompt={signInPrompt}
        statusText={signInStatus}
        onClose={() => {
          setSignInPrompt(null);
          setSignInStatus("");
        }}
        t={t}
      />

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
};
