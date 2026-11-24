import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, imageProxyUrl } from "../api";
import { formatDuration } from "../i18n";
import type {
  Comment,
  CoverPalette,
  MobileSettings,
  ParsedLyrics,
  StageStyle,
  Track,
} from "../types";
import { FogBackdrop } from "./FogBackdrop";
import { Icon } from "./Icons";
import { QuietCommentCard, useQuietComment } from "./QuietComments";
import { RetroPlayer } from "./RetroPlayer";
import { SmokeScrubber } from "./SmokeScrubber";
import { StageLyrics } from "./StageLyrics";

interface NowPlayingProps {
  open: boolean;
  onClose: () => void;
  onAnimatingChange?: (hidingMiniCover: boolean) => void;
  miniCoverRect: DOMRect | null;
  track: Track | null;
  queue: Track[];
  index: number;
  playing: boolean;
  buffering: boolean;
  positionMs: number;
  durationMs: number;
  qualityBadge: string;
  repeatMode: "off" | "all" | "one";
  shuffle: boolean;
  liked: boolean;
  canLike: boolean;
  canComments: boolean;
  canPostComment: boolean;
  canLikeComment: boolean;
  settings: MobileSettings;
  palette: CoverPalette;
  onUpdateSettings: (patch: Partial<MobileSettings>) => Promise<void>;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (ms: number) => void;
  onSelectQueueIndex: (idx: number) => void;
  onToggleLike: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onToast: (msg: string) => void;
  t: (k: string) => string;
}

type PanelTab = "lyrics" | "stage" | "queue" | "comments";

export const NowPlaying: React.FC<NowPlayingProps> = ({
  open,
  onClose,
  onAnimatingChange,
  miniCoverRect,
  track,
  queue,
  index,
  playing,
  buffering,
  positionMs,
  durationMs,
  qualityBadge,
  repeatMode,
  shuffle,
  liked,
  canLike,
  canComments,
  canPostComment,
  canLikeComment,
  settings,
  palette,
  onUpdateSettings,
  onTogglePlay,
  onPrev,
  onNext,
  onSeek,
  onSelectQueueIndex,
  onToggleLike,
  onToggleShuffle,
  onCycleRepeat,
  onToast,
  t,
}) => {
  const [rightTab, setRightTab] = useState<PanelTab>(settings.lyricsStage ? "stage" : "lyrics");
  const [mobilePanel, setMobilePanel] = useState<"cover" | PanelTab>(settings.lyricsStage ? "stage" : "cover");
  const [lyricsData, setLyricsData] = useState<ParsedLyrics>({ lines: [] });
  const [lyricsLoaded, setLyricsLoaded] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsMore, setCommentsMore] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 820);

  // Open / close transition & GrowFromCover state
  const [mounted, setMounted] = useState(open);
  const [phase, setPhase] = useState<"closed" | "entering" | "open" | "closing">(open ? "open" : "closed");
  const [pullY, setPullY] = useState(0);
  const pullStartY = useRef<number | null>(null);
  const pullStartT = useRef(0);
  const artHolderRef = useRef<HTMLDivElement | null>(null);
  const [coverDelta, setCoverDelta] = useState<{ dx: number; dy: number; scale: number } | null>(null);

  const activeLineRef = useRef<HTMLDivElement | null>(null);
  const sourceId = track?.source || "local";
  const effectiveDuration = durationMs || track?.duration || 0;
  const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const growMode = settings.growFromCover && !reducedMotion && !!miniCoverRect;

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth <= 820);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Sync preferred stage tab from settings when opening
  useEffect(() => {
    if (open) {
      if (settings.lyricsStage) {
        setRightTab("stage");
        setMobilePanel("stage");
      } else if (rightTab === "stage") {
        setRightTab("lyrics");
        if (mobilePanel === "stage") setMobilePanel("cover");
      }
    }
  }, [open, settings.lyricsStage]);

  // Open / close animation lifecycle (GrowFromCover FLIP or bottom slide)
  useEffect(() => {
    if (open && track) {
      setMounted(true);
      setPhase("entering");
      setPullY(0);
      if (growMode) onAnimatingChange?.(true);

      const id1 = requestAnimationFrame(() => {
        if (growMode && artHolderRef.current && miniCoverRect) {
          const target = artHolderRef.current.getBoundingClientRect();
          if (target.width > 0) {
            setCoverDelta({
              dx: miniCoverRect.left - target.left,
              dy: miniCoverRect.top - target.top,
              scale: miniCoverRect.width / target.width,
            });
          }
        } else {
          setCoverDelta(null);
        }
        requestAnimationFrame(() => {
          setPhase("open");
        });
      });
      return () => cancelAnimationFrame(id1);
    } else if (mounted) {
      if (growMode && artHolderRef.current && miniCoverRect) {
        const target = artHolderRef.current.getBoundingClientRect();
        if (target.width > 0) {
          setCoverDelta({
            dx: miniCoverRect.left - target.left,
            dy: miniCoverRect.top - target.top,
            scale: miniCoverRect.width / target.width,
          });
        }
      }
      setPhase("closing");
      const timer = window.setTimeout(() => {
        setMounted(false);
        setPhase("closed");
        setPullY(0);
        onAnimatingChange?.(false);
      }, 360);
      return () => window.clearTimeout(timer);
    }
  }, [open, !!track]);

  // Fetch lyrics whenever track changes while mounted
  useEffect(() => {
    if (!mounted || !track) return;
    setLyricsData({ lines: [] });
    setLyricsLoaded(false);
    api
      .lyrics(sourceId, track.id, effectiveDuration)
      .then((res) => {
        setLyricsData(res);
        setLyricsLoaded(true);
      })
      .catch(() => {
        setLyricsData({ lines: [] });
        setLyricsLoaded(true);
      });
  }, [mounted, track?.id, sourceId]);

  // Fetch comments either when comments tab is opened OR proactively when hotComments is enabled
  useEffect(() => {
    if (!mounted || !track || !canComments) {
      setComments([]);
      return;
    }
    const needNow =
      settings.hotComments || rightTab === "comments" || mobilePanel === "comments";
    if (!needNow) return;
    api
      .comments(sourceId, track.id, 0)
      .then((res) => {
        setComments(res.comments || []);
        setCommentsMore(!!res.more);
      })
      .catch(() => setComments([]));
  }, [mounted, track?.id, sourceId, canComments, settings.hotComments, rightTab, mobilePanel]);

  const activeLineIdx = useMemo(() => {
    const lines = lyricsData.lines;
    if (!lines.length) return -1;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].atMs <= positionMs + 250) idx = i;
      else break;
    }
    return idx;
  }, [lyricsData.lines, positionMs]);

  useEffect(() => {
    if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeLineIdx]);

  const quietActive = useQuietComment({
    enabled: settings.hotComments && canComments,
    lines: lyricsData.lines,
    quiets: lyricsData.quiets,
    lyricsLoaded,
    durationMs: effectiveDuration,
    positionMs,
    comments,
  });

  if (!mounted || !track) return null;

  const art = imageProxyUrl(track.album?.imageUrl, 600);
  const displayPos = scrubMs !== null ? scrubMs : positionMs;
  const activePanel: "cover" | PanelTab = narrow ? mobilePanel : rightTab;
  const isStageMode = activePanel === "stage";

  const switchTab = (tab: "cover" | PanelTab) => {
    if (tab !== "cover") {
      setRightTab(tab);
      const nextStage = tab === "stage";
      if (nextStage !== settings.lyricsStage) {
        onUpdateSettings({ lyricsStage: nextStage }).catch(() => {});
      }
    }
    setMobilePanel(tab);
  };

  const handleSendComment = async () => {
    const text = commentText.trim();
    if (!text) return;
    try {
      const created = await api.postComment(sourceId, track.id, text);
      setComments((prev) => [created, ...prev]);
      setCommentText("");
    } catch (e) {
      onToast(String(e instanceof Error ? e.message : e));
    }
  };

  const handleLikeComment = async (c: Comment) => {
    if (!canLikeComment) return;
    const next = !c.liked;
    try {
      await api.likeComment(sourceId, track.id, c.id, next);
      setComments((prev) =>
        prev.map((item) =>
          item.id === c.id ? { ...item, liked: next, likes: (item.likes || 0) + (next ? 1 : -1) } : item
        )
      );
    } catch (e) {
      onToast(String(e instanceof Error ? e.message : e));
    }
  };

  // Pull-down to dismiss gesture on topbar
  const handleTopPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    pullStartY.current = e.clientY;
    pullStartT.current = performance.now();
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleTopPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pullStartY.current === null) return;
    const dy = Math.max(0, e.clientY - pullStartY.current);
    // Rubberband feel matching desktop ui_nowplaying.go
    const damped = dy > 0 ? dy / (1 + dy / 900) : 0;
    setPullY(damped);
  };

  const handleTopPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pullStartY.current === null) return;
    const dy = Math.max(0, e.clientY - pullStartY.current);
    const dt = Math.max(0.01, (performance.now() - pullStartT.current) / 1000);
    const vy = dy / dt;
    pullStartY.current = null;
    if (dy > window.innerHeight * 0.2 || (dy > 24 && vy > 700)) {
      onClose();
    } else {
      setPullY(0);
    }
  };

  // Compute container transition style (GrowFromCover clip-path vs bottom slide vs reduced fade)
  const overlayStyle: React.CSSProperties = {};
  const isCollapsed = phase === "entering" || phase === "closing";
  if (reducedMotion) {
    overlayStyle.opacity = isCollapsed ? 0 : 1;
    overlayStyle.transition = "opacity 200ms ease";
  } else if (growMode && miniCoverRect) {
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const top = Math.max(0, miniCoverRect.top);
    const left = Math.max(0, miniCoverRect.left);
    const right = Math.max(0, vw - miniCoverRect.right);
    const bottom = Math.max(0, vh - miniCoverRect.bottom);
    const pulled = Math.min(1, pullY / 160);
    const pullRadius = Math.round(pulled * 28);
    overlayStyle.clipPath = isCollapsed
      ? `inset(${top}px ${right}px ${bottom}px ${left}px round 10px)`
      : `inset(0px 0px 0px 0px round ${pullRadius}px)`;
    if (!isCollapsed && pullY > 0) {
      const sc = 1 - 0.12 * pulled;
      overlayStyle.transform = `translate3d(0, ${pullY}px, 0) scale(${sc})`;
      overlayStyle.transition = "none";
    } else {
      overlayStyle.transform = "translate3d(0, 0, 0) scale(1)";
      overlayStyle.transition =
        "clip-path 340ms cubic-bezier(0.22, 1, 0.36, 1), transform 340ms cubic-bezier(0.22, 1, 0.36, 1)";
    }
  } else {
    overlayStyle.transform = isCollapsed
      ? "translate3d(0, 100%, 0)"
      : `translate3d(0, ${pullY}px, 0)`;
    overlayStyle.transition =
      !isCollapsed && pullY > 0 ? "none" : "transform 340ms cubic-bezier(0.22, 1, 0.36, 1)";
  }

  const coverMorphStyle: React.CSSProperties | undefined =
    growMode && coverDelta
      ? {
          transformOrigin: "top left",
          transform: isCollapsed
            ? `translate3d(${coverDelta.dx}px, ${coverDelta.dy}px, 0) scale(${coverDelta.scale})`
            : "translate3d(0, 0, 0) scale(1)",
          transition: "transform 340ms cubic-bezier(0.22, 1, 0.36, 1)",
        }
      : undefined;

  const riseStyle = (level: number): React.CSSProperties | undefined => {
    if (!growMode) return undefined;
    const delayMs = isCollapsed ? 0 : 70 + level * 35;
    return {
      opacity: isCollapsed ? 0 : 1,
      transform: isCollapsed ? "translate3d(0, 22px, 0)" : "translate3d(0, 0, 0)",
      transition: `opacity 260ms ease ${delayMs}ms, transform 320ms cubic-bezier(0.22, 1, 0.36, 1) ${delayMs}ms`,
    };
  };

  return (
    <div className={`np-overlay ${growMode ? "grow-mode" : ""}`} style={overlayStyle}>
      <FogBackdrop enabled={settings.fog} playing={playing} palette={palette} artUrl={art} />

      <div className="np-content">
        <div
          className="np-topbar"
          style={riseStyle(0)}
          onPointerDown={handleTopPointerDown}
          onPointerMove={handleTopPointerMove}
          onPointerUp={handleTopPointerUp}
        >
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="chevron-down" size={24} />
          </button>

          <div className="np-pill-group">
            <div className="np-pill-track">
              {narrow && (
                <button
                  className={`pill ${mobilePanel === "cover" ? "active" : ""}`}
                  onClick={() => switchTab("cover")}
                >
                  {t("Cover")}
                </button>
              )}
              <button
                className={`pill ${activePanel === "lyrics" ? "active" : ""}`}
                onClick={() => switchTab("lyrics")}
              >
                {t("Lyrics")}
              </button>
              <button
                className={`pill ${activePanel === "stage" ? "active" : ""}`}
                onClick={() => switchTab("stage")}
              >
                {t("Stage")}
              </button>
              <button
                className={`pill ${activePanel === "queue" ? "active" : ""}`}
                onClick={() => switchTab("queue")}
              >
                {narrow ? `${t("QueueShort")} ${queue.length}` : `${t("Queue")} (${queue.length})`}
              </button>
              {canComments && (
                <button
                  className={`pill ${activePanel === "comments" ? "active" : ""}`}
                  onClick={() => switchTab("comments")}
                >
                  {t("Comments")}
                </button>
              )}
            </div>
          </div>

          <div className="np-topbar-spacer" aria-hidden="true" />
        </div>

        {isStageMode ? (
          /* Fullscreen Stage Lyrics view + compact bottom stageBar matching desktop ui_nowplaying.go */
          <div className="np-stage-layout">
            <div className="np-stage-main" style={riseStyle(1)}>
              <StageLyrics
                lyrics={lyricsData}
                lyricsLoaded={lyricsLoaded}
                playing={playing}
                positionMs={displayPos}
                stageStyle={settings.stageStyle}
                stageSparks={settings.stageSparks}
                accent={palette.accent}
                quietActive={quietActive}
                onChangeStyle={(st: StageStyle) => {
                  onUpdateSettings({ stageStyle: st }).catch(() => {});
                }}
                onToggleSparks={() => {
                  onUpdateSettings({ stageSparks: !settings.stageSparks }).catch(() => {});
                }}
                onOpenComments={() => switchTab("comments")}
                t={t}
              />
            </div>

            <div className="np-stage-bar" style={riseStyle(2)}>
              <div className="np-stage-scrubber-row">
                <span className="np-time-tag">{formatDuration(displayPos)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <SmokeScrubber
                    value={displayPos}
                    max={effectiveDuration}
                    playing={playing}
                    buffering={buffering}
                    smokeEnabled={settings.smoke}
                    accent={palette.accent}
                    onChange={(ms) => setScrubMs(ms)}
                    onCommit={(ms) => {
                      setScrubMs(null);
                      onSeek(ms);
                    }}
                    compact
                  />
                </div>
                <span className="np-time-tag">{buffering ? "..." : formatDuration(effectiveDuration)}</span>
              </div>

              <div className="np-stage-controls-row">
                <div className="np-stage-track">
                  <div ref={artHolderRef} className="np-stage-cover" style={coverMorphStyle}>
                    {art ? <img src={art} alt="" /> : <Icon name="note" size={20} />}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="truncate" style={{ fontSize: 14, fontWeight: 700 }}>{track.name}</div>
                    <div className="truncate" style={{ fontSize: 12, color: "var(--text-2)" }}>
                      {(track.artists || []).map((a) => a.name).join(", ")}
                    </div>
                  </div>
                </div>

                <div className="np-stage-buttons">
                  <button className="icon-btn" onClick={onPrev} aria-label="Previous">
                    <Icon name="prev" size={22} />
                  </button>
                  <button
                    className="play-btn play-btn-sm"
                    onClick={onTogglePlay}
                    aria-label={playing ? "Pause" : "Play"}
                  >
                    <Icon name={playing ? "pause" : "play"} size={20} />
                  </button>
                  <button className="icon-btn" onClick={onNext} aria-label="Next">
                    <Icon name="next" size={22} />
                  </button>
                </div>

                <div className="np-stage-actions">
                  {qualityBadge && <span className="quality-badge np-stage-quality">{qualityBadge}</span>}
                  {canLike && (
                    <button
                      className={`icon-btn ${liked ? "accent" : ""}`}
                      onClick={onToggleLike}
                      aria-label="Like"
                    >
                      <Icon name="heart" size={20} filled={liked} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Standard two-column (iPad) / tabbed (Phone) Now Playing view */
          <div className="np-grid">
            <div className={`np-left ${narrow && mobilePanel !== "cover" ? "np-mobile-hidden" : ""}`}>
              <div ref={artHolderRef} className="np-art-holder" style={coverMorphStyle}>
                <RetroPlayer
                  styleMode={settings.playerStyle}
                  track={track}
                  artUrl={art}
                  playing={playing}
                  positionMs={displayPos}
                  durationMs={effectiveDuration}
                  palette={palette}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, ...riseStyle(1) }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 21, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {track.name}
                  </div>
                  <div style={{ fontSize: 15, color: "rgba(255,255,255,0.72)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {(track.artists || []).map((a) => a.name).join(", ")}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  {qualityBadge && <span className="quality-badge">{qualityBadge}</span>}
                  {canLike && (
                    <button
                      className={`icon-btn ${liked ? "accent" : ""}`}
                      onClick={onToggleLike}
                      aria-label="Like"
                    >
                      <Icon name="heart" size={22} filled={liked} />
                    </button>
                  )}
                </div>
              </div>

              <div style={riseStyle(2)}>
                <SmokeScrubber
                  value={displayPos}
                  max={effectiveDuration}
                  playing={playing}
                  buffering={buffering}
                  smokeEnabled={settings.smoke}
                  accent={palette.accent}
                  onChange={(ms) => setScrubMs(ms)}
                  onCommit={(ms) => {
                    setScrubMs(null);
                    onSeek(ms);
                  }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>
                  <span>{formatDuration(displayPos)}</span>
                  <span>{buffering ? "..." : formatDuration(effectiveDuration)}</span>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 6px", ...riseStyle(3) }}>
                <button
                  className="icon-btn"
                  style={{ color: shuffle ? "var(--accent)" : "rgba(255,255,255,0.75)" }}
                  onClick={onToggleShuffle}
                >
                  <Icon name="shuffle" size={20} />
                </button>
                <button className="icon-btn" style={{ color: "#fff" }} onClick={onPrev}>
                  <Icon name="prev" size={28} />
                </button>
                <button
                  className="play-btn"
                  onClick={onTogglePlay}
                >
                  <Icon name={playing ? "pause" : "play"} size={28} />
                </button>
                <button className="icon-btn" style={{ color: "#fff" }} onClick={onNext}>
                  <Icon name="next" size={28} />
                </button>
                <button
                  className="icon-btn"
                  style={{ color: repeatMode !== "off" ? "var(--accent)" : "rgba(255,255,255,0.75)", position: "relative" }}
                  onClick={onCycleRepeat}
                >
                  <Icon name="repeat" size={20} />
                  {repeatMode === "one" && (
                    <span style={{ position: "absolute", fontSize: 9, fontWeight: 800, bottom: 2, right: 2 }}>1</span>
                  )}
                </button>
              </div>
            </div>

            <div className={`np-right ${narrow && mobilePanel === "cover" ? "np-mobile-hidden" : ""}`} style={riseStyle(2)}>
              {activePanel === "lyrics" && (
                <div className="np-lyrics-container">
                  <div
                    className={`np-scroll np-lyrics-scroll ${quietActive?.visible ? "faded-under-quiet" : ""}`}
                    lang={lyricsData.lang || undefined}
                  >
                    {lyricsData.lines.length === 0 ? (
                      <div style={{ color: "rgba(255,255,255,0.5)", padding: "40px 10px", textAlign: "center" }}>
                        {lyricsLoaded ? t("No lyrics. Enjoy the music.") : "..."}
                      </div>
                    ) : (
                      lyricsData.lines.map((line, i) => (
                        <div
                          key={`${line.atMs}-${i}`}
                          ref={i === activeLineIdx ? activeLineRef : null}
                          className={`lyric-line ${i === activeLineIdx ? "active" : ""}`}
                          onClick={() => onSeek(line.atMs)}
                        >
                          <div>{line.text}</div>
                          {line.translation && <div className="lyric-trans">{line.translation}</div>}
                        </div>
                      ))
                    )}
                  </div>

                  <QuietCommentCard
                    active={quietActive}
                    onOpenComments={() => switchTab("comments")}
                    t={t}
                  />
                </div>
              )}

              {activePanel === "queue" && (
                <div className="np-scroll track-list">
                  {queue.map((qt, qi) => (
                    <div
                      key={`${qt.id}-${qi}`}
                      className={`track-row ${qi === index ? "playing" : ""}`}
                      onClick={() => onSelectQueueIndex(qi)}
                    >
                      <div className="track-thumb">
                        {qt.album?.imageUrl ? (
                          <img src={imageProxyUrl(qt.album.imageUrl, 96)} alt="" />
                        ) : (
                          <Icon name="note" size={16} />
                        )}
                      </div>
                      <div className="track-meta">
                        <div className="track-name">{qt.name}</div>
                        <div className="track-sub">
                          {(qt.artists || []).map((a) => a.name).join(", ")}
                        </div>
                      </div>
                      <div className="track-dur">
                        {formatDuration(qt.duration)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activePanel === "comments" && (
                <div className="np-right">
                  {canPostComment && (
                    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                      <input
                        className="form-input"
                        style={{ flex: 1, background: "rgba(255,255,255,0.1)", color: "#fff", borderColor: "rgba(255,255,255,0.2)" }}
                        placeholder={t("Write a comment...")}
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSendComment()}
                      />
                      <button className="btn btn-primary" onClick={handleSendComment}>
                        {t("Send")}
                      </button>
                    </div>
                  )}
                  <div className="np-scroll">
                    {comments.length === 0 ? (
                      <div style={{ color: "rgba(255,255,255,0.5)", padding: "40px 10px", textAlign: "center" }}>
                        {t("No comments yet")}
                      </div>
                    ) : (
                      comments.map((c) => (
                        <div
                          key={c.id}
                          style={{
                            padding: "12px 10px",
                            borderBottom: "1px solid rgba(255,255,255,0.1)",
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                            <strong style={{ color: "rgba(255,255,255,0.9)" }}>{c.author}</strong>
                            <button
                              className="icon-btn"
                              style={{ color: c.liked ? "var(--accent)" : "rgba(255,255,255,0.6)", fontSize: 12, width: "auto", gap: 4, padding: "2px 6px" }}
                              onClick={() => handleLikeComment(c)}
                            >
                              <Icon name="heart" size={14} filled={!!c.liked} />
                              {c.likes || 0}
                            </button>
                          </div>
                          <div style={{ fontSize: 14, lineHeight: 1.5, color: "rgba(255,255,255,0.85)" }}>{c.text}</div>
                        </div>
                      ))
                    )}
                    {commentsMore && (
                      <button
                        className="btn"
                        style={{ margin: "14px auto", display: "flex" }}
                        onClick={() =>
                          api
                            .comments(sourceId, track.id, comments.length)
                            .then((res) => {
                              setComments((prev) => [...prev, ...(res.comments || [])]);
                              setCommentsMore(!!res.more);
                            })
                            .catch(() => {})
                        }
                      >
                        {t("Load More")}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
