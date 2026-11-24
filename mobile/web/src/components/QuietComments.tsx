import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Comment, LyricLine, QuietSpan } from "../types";
import { Icon } from "./Icons";

const QUIET_LEAST = 8000;
const QUIET_LEAD = 1200;
const QUIET_TAIL = 1000;
const QUIET_SLOT = 10000;
const QUIET_MAX_RUNES = 140;

export interface ActiveQuietComment {
  comment: Comment;
  visible: boolean;
}

/**
 * Computes whether a hot comment should take over the lyrics area at posMs,
 * faithfully matching internal/app/ui_quiet.go.
 */
export function useQuietComment(opts: {
  enabled: boolean;
  lines: LyricLine[];
  quiets?: QuietSpan[];
  lyricsLoaded: boolean;
  durationMs: number;
  positionMs: number;
  comments: Comment[];
}): ActiveQuietComment | null {
  const { enabled, lines, quiets, lyricsLoaded, durationMs, positionMs, comments } = opts;

  const hot = useMemo(() => {
    const filtered = comments
      .filter((c) => (c.likes || 0) > 0 && Array.from(c.text.trim()).length > 0 && Array.from(c.text.trim()).length <= QUIET_MAX_RUNES)
      .sort((a, b) => (b.likes || 0) - (a.likes || 0))
      .slice(0, 10);
    return filtered;
  }, [comments]);

  const effectiveQuiets = useMemo<QuietSpan[]>(() => {
    if (!lyricsLoaded) return [];
    if (lines.length === 0) {
      if (durationMs >= QUIET_LEAST) {
        return [{ fromMs: 0, toMs: durationMs }];
      }
      return [];
    }
    if (quiets && quiets.length > 0) {
      return quiets;
    }
    // Fallback client calculation if server didn't have duration yet
    const out: QuietSpan[] = [];
    let at = 0;
    let sung = false;
    for (const l of lines) {
      if (l.isCredit) continue;
      if (l.atMs - at >= QUIET_LEAST) {
        out.push({ fromMs: at, toMs: l.atMs });
      }
      at = Math.max(at, l.endMs || l.atMs);
      sung = true;
    }
    if (sung && durationMs > 0 && durationMs - at >= QUIET_LEAST) {
      out.push({ fromMs: at, toMs: durationMs });
    }
    return out;
  }, [lines, quiets, lyricsLoaded, durationMs]);

  return useMemo(() => {
    if (!enabled || hot.length === 0 || effectiveQuiets.length === 0) return null;
    let shown = 0;
    for (const q of effectiveQuiets) {
      const from = q.fromMs + QUIET_LEAD;
      const to = q.toMs - QUIET_TAIL;
      if (to <= from) continue;
      const slots = Math.max(1, Math.floor((to - from + QUIET_SLOT / 2) / QUIET_SLOT));
      if (positionMs >= from && positionMs < to) {
        const each = (to - from) / slots;
        const slot = Math.min(slots - 1, Math.floor((positionMs - from) / each));
        const comment = hot[(shown + slot) % hot.length];
        return { comment, visible: true };
      }
      shown += slots;
    }
    return null;
  }, [enabled, hot, effectiveQuiets, positionMs]);
}

interface QuietCommentCardProps {
  active: ActiveQuietComment | null;
  stage?: boolean;
  onOpenComments: () => void;
  t: (k: string) => string;
}

export const QuietCommentCard: React.FC<QuietCommentCardProps> = ({
  active,
  stage = false,
  onOpenComments,
  t,
}) => {
  const [rendered, setRendered] = useState<Comment | null>(active?.comment || null);
  const [animKey, setAnimKey] = useState(0);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    if (active?.visible && active.comment) {
      setRendered((prev) => {
        if (!prev || prev.id !== active.comment.id) {
          setAnimKey((k) => k + 1);
        }
        return active.comment;
      });
    } else {
      hideTimer.current = window.setTimeout(() => setRendered(null), 620);
    }
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [active?.visible, active?.comment?.id]);

  if (!rendered) return null;

  const visible = !!active?.visible;

  return (
    <div
      className={`quiet-card-wrap ${stage ? "stage" : ""} ${visible ? "visible" : ""}`}
      onClick={onOpenComments}
      role="button"
      tabIndex={0}
      aria-label={t("View Comments")}
    >
      <div key={animKey} className="quiet-card-inner">
        <div className="quiet-card-head">
          <Icon name="comment" size={14} />
          <span>{t("Top Comment")}</span>
        </div>
        <div className="quiet-card-text">{rendered.text}</div>
        <div className="quiet-card-foot">
          <span className="quiet-card-author">{rendered.author}</span>
          {rendered.likes ? (
            <span className="quiet-card-likes">
              <Icon name="heart" size={12} filled />
              {rendered.likes}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
};
