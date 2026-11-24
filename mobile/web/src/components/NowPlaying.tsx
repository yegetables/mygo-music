import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, imageProxyUrl } from "../api";
import { formatDuration } from "../i18n";
import type { Comment, ParsedLyrics, Track } from "../types";
import { Icon } from "./Icons";

interface NowPlayingProps {
  open: boolean;
  onClose: () => void;
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

export const NowPlaying: React.FC<NowPlayingProps> = ({
  open,
  onClose,
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
  const [rightTab, setRightTab] = useState<"lyrics" | "queue" | "comments">("lyrics");
  const [mobilePanel, setMobilePanel] = useState<"cover" | "lyrics" | "queue" | "comments">("cover");
  const [lyricsData, setLyricsData] = useState<ParsedLyrics>({ lines: [] });
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsMore, setCommentsMore] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const activeLineRef = useRef<HTMLDivElement | null>(null);

  const sourceId = track?.source || "local";

  useEffect(() => {
    if (!open || !track) return;
    setLyricsData({ lines: [] });
    api
      .lyrics(sourceId, track.id)
      .then((res) => setLyricsData(res))
      .catch(() => setLyricsData({ lines: [] }));
  }, [open, track?.id, sourceId]);

  useEffect(() => {
    if (!open || !track || !canComments) return;
    if (rightTab !== "comments" && mobilePanel !== "comments") return;
    api
      .comments(sourceId, track.id, 0)
      .then((res) => {
        setComments(res.comments || []);
        setCommentsMore(!!res.more);
      })
      .catch(() => setComments([]));
  }, [open, track?.id, sourceId, canComments, rightTab, mobilePanel]);

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

  if (!open || !track) return null;

  const art = imageProxyUrl(track.album?.imageUrl, 600);
  const effectiveDuration = durationMs || track.duration || 0;
  const displayPos = scrubMs !== null ? scrubMs : positionMs;

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

  const activeRightPanel = window.innerWidth <= 820 ? mobilePanel : rightTab;

  return (
    <div className="np-overlay">
      {art && <div className="np-backdrop" style={{ backgroundImage: `url(${art})` }} />}
      <div className="np-content">
        <div className="np-topbar">
          <button className="icon-btn" style={{ color: "#fff" }} onClick={onClose} aria-label="Close">
            <Icon name="chevron-down" size={24} />
          </button>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className={`pill ${mobilePanel === "cover" ? "active" : ""}`}
              style={{ display: window.innerWidth <= 820 ? "inline-flex" : "none" }}
              onClick={() => setMobilePanel("cover")}
            >
              {t("Home")}
            </button>
            <button
              className={`pill ${(window.innerWidth <= 820 ? mobilePanel : rightTab) === "lyrics" ? "active" : ""}`}
              onClick={() => {
                setRightTab("lyrics");
                setMobilePanel("lyrics");
              }}
            >
              {t("Lyrics")}
            </button>
            <button
              className={`pill ${(window.innerWidth <= 820 ? mobilePanel : rightTab) === "queue" ? "active" : ""}`}
              onClick={() => {
                setRightTab("queue");
                setMobilePanel("queue");
              }}
            >
              {t("Queue")} ({queue.length})
            </button>
            {canComments && (
              <button
                className={`pill ${(window.innerWidth <= 820 ? mobilePanel : rightTab) === "comments" ? "active" : ""}`}
                onClick={() => {
                  setRightTab("comments");
                  setMobilePanel("comments");
                }}
              >
                {t("Comments")}
              </button>
            )}
          </div>
          <div style={{ width: 36 }} />
        </div>

        <div className="np-grid">
          <div className={`np-left ${mobilePanel !== "cover" ? "np-mobile-hidden" : ""}`}>
            <div className="np-art">
              {art ? <img src={art} alt="" /> : <Icon name="note" size={64} />}
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 21, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {track.name}
                </div>
                <div style={{ fontSize: 15, color: "rgba(255,255,255,0.72)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {(track.artists || []).map((a) => a.name).join(", ")}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {qualityBadge && <span className="badge">{qualityBadge}</span>}
                {canLike && (
                  <button className={`icon-btn ${liked ? "accent" : ""}`} style={{ color: liked ? "var(--accent)" : "#fff" }} onClick={onToggleLike}>
                    <Icon name="heart" size={22} filled={liked} />
                  </button>
                )}
              </div>
            </div>

            <div>
              <input
                type="range"
                className="scrubber"
                style={{ width: "100%" }}
                min={0}
                max={Math.max(effectiveDuration, 1)}
                value={Math.min(displayPos, effectiveDuration || 1)}
                onChange={(e) => setScrubMs(Number(e.target.value))}
                onMouseUp={() => {
                  if (scrubMs !== null) {
                    onSeek(scrubMs);
                    setScrubMs(null);
                  }
                }}
                onTouchEnd={() => {
                  if (scrubMs !== null) {
                    onSeek(scrubMs);
                    setScrubMs(null);
                  }
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>
                <span>{formatDuration(displayPos)}</span>
                <span>{buffering ? "..." : formatDuration(effectiveDuration)}</span>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 12px" }}>
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
                className="play-circle"
                style={{ width: 58, height: 58, background: "#fff", color: "#111" }}
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
                  <span style={{ position: "absolute", fontSize: 9, fontWeight: 800, bottom: 3, right: 4 }}>1</span>
                )}
              </button>
            </div>
          </div>

          <div className={`np-right ${mobilePanel === "cover" ? "np-mobile-hidden" : ""}`}>
            <div className="np-scroll" lang={lyricsData.lang || undefined}>
              {activeRightPanel === "lyrics" && (
                lyricsData.lines.length === 0 ? (
                  <div style={{ color: "rgba(255,255,255,0.5)", paddingTop: 40, textAlign: "center" }}>
                    {t("No lyrics")}
                  </div>
                ) : (
                  <div style={{ padding: "24px 0 80px" }}>
                    {lyricsData.lines.map((line, i) => (
                      <div
                        key={`${line.atMs}-${i}`}
                        ref={i === activeLineIdx ? activeLineRef : null}
                        className={`lyric-line ${i === activeLineIdx ? "active" : ""}`}
                        onClick={() => onSeek(line.atMs)}
                      >
                        <div>{line.text}</div>
                        {line.translation && <div className="lyric-trans">{line.translation}</div>}
                      </div>
                    ))}
                  </div>
                )
              )}

              {activeRightPanel === "queue" && (
                <div className="track-list">
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
                        <div className="track-name" style={{ color: qi === index ? "var(--accent)" : "#fff" }}>
                          {qt.name}
                        </div>
                        <div className="track-sub" style={{ color: "rgba(255,255,255,0.6)" }}>
                          {(qt.artists || []).map((a) => a.name).join(", ")}
                        </div>
                      </div>
                      <span className="track-dur">{formatDuration(qt.duration)}</span>
                    </div>
                  ))}
                </div>
              )}

              {activeRightPanel === "comments" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {canPostComment && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        className="form-input"
                        style={{ flex: 1, background: "rgba(255,255,255,0.1)", color: "#fff" }}
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
                  {comments.length === 0 ? (
                    <div style={{ color: "rgba(255,255,255,0.5)", textAlign: "center", paddingTop: 28 }}>
                      {t("No comments yet")}
                    </div>
                  ) : (
                    comments.map((c) => (
                      <div
                        key={c.id}
                        style={{
                          padding: 12,
                          borderRadius: 12,
                          background: "rgba(255,255,255,0.07)",
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{c.author}</span>
                          {canLikeComment && (
                            <button
                              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: c.liked ? "var(--accent)" : "rgba(255,255,255,0.65)" }}
                              onClick={() => handleLikeComment(c)}
                            >
                              <Icon name="heart" size={14} filled={!!c.liked} />
                              <span>{c.likes || 0}</span>
                            </button>
                          )}
                        </div>
                        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.9)" }}>{c.text}</div>
                      </div>
                    ))
                  )}
                  {commentsMore && (
                    <button
                      className="btn"
                      onClick={() =>
                        api.comments(sourceId, track.id, comments.length).then((res) => {
                          setComments((prev) => [...prev, ...(res.comments || [])]);
                          setCommentsMore(!!res.more);
                        })
                      }
                    >
                      {t("Load More")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
