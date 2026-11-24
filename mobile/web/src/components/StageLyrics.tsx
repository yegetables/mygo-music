import React, { useEffect, useRef, useState } from "react";
import { audioRuntime } from "../audioRuntime";
import type { LyricLine, LyricWord, ParsedLyrics, RGBColor, StageStyle } from "../types";
import { Icon } from "./Icons";
import { ActiveQuietComment, QuietCommentCard } from "./QuietComments";

interface StageLyricsProps {
  lyrics: ParsedLyrics;
  lyricsLoaded: boolean;
  playing: boolean;
  positionMs: number;
  stageStyle: StageStyle;
  stageSparks: boolean;
  accent: RGBColor;
  quietActive: ActiveQuietComment | null;
  onChangeStyle: (style: StageStyle) => void;
  onToggleSparks: () => void;
  onOpenComments: () => void;
  t: (k: string) => string;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeOutCubic(t: number): number {
  const c = clamp01(t);
  return 1 - (1 - c) * (1 - c) * (1 - c);
}

function easeOutQuad(t: number): number {
  const c = clamp01(t);
  return 1 - (1 - c) * (1 - c);
}

function lineRandom(seed: number, offset: number): number {
  const x = Math.sin(seed + offset) * 10000;
  return x - Math.floor(x);
}

function springStep(t: number): number {
  if (t <= 0) return 0;
  const e = Math.exp(-10 * t);
  return 1 - e * (Math.cos(10 * t) + Math.sin(10 * t));
}

function isMark(ch: string): boolean {
  return /[\s\p{P}]/u.test(ch);
}

function isPunct(ch: string): boolean {
  return /\p{P}/u.test(ch);
}

function stageUnits(words: LyricWord[]): Array<[number, number]> {
  const units: Array<[number, number]> = [];
  const pushPhrase = (from: number, to: number) => {
    const len = to - from;
    const n = len <= 6 ? 1 : Math.floor((len + 3) / 4);
    for (let k = 0; k < n; k++) {
      units.push([from + Math.floor((len * k) / n), from + Math.floor((len * (k + 1)) / n)]);
    }
  };
  let from = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const trimmedMarks = Array.from(w.text).filter((ch) => !isMark(ch)).join("");
    if (i === from && units.length > 0 && trimmedMarks === "") {
      units[units.length - 1][1] = i + 1;
      from = i + 1;
      continue;
    }
    const chars = Array.from(w.text);
    const last = chars[chars.length - 1] || "";
    if (i + 1 === words.length || (isMark(last) && !"'’-".includes(last))) {
      pushPhrase(from, i + 1);
      from = i + 1;
    }
  }
  return units;
}

function wordsLength(words: LyricWord[]): number {
  let n = 0;
  for (const w of words) {
    n += Array.from(w.text.trim()).length;
  }
  return n;
}

function ensureWords(line: LyricLine): LyricWord[] {
  if (line.words && line.words.length > 0) return line.words;
  const text = line.text || "";
  const start = line.atMs;
  const end = Math.max(line.endMs || start + 2500, start + 500);
  const chars = Array.from(text);
  if (chars.length === 0) return [];
  const each = (end - start) / chars.length;
  return chars.map((ch, i) => ({
    text: ch,
    startMs: start + i * each,
    endMs: start + (i + 1) * each,
  }));
}

interface WordShape {
  x: number;
  y: number;
  rotate: number;
  scale: number;
  drift: number;
  margin: number;
  last: boolean;
}

interface PartitaRow {
  from: number;
  to: number;
  x: number;
  y: number;
  scale: number;
  left: boolean;
}

interface TiltPart {
  from: number;
  to: number;
  lean: boolean;
  tail: boolean;
}

const SPARK_TIME = 0.6;

/**
 * Full-canvas 60fps implementation of desktop MyGo Music's Stage Lyrics
 * (internal/app/ui_stage.go & ui_stage_styles.go):
 * - Flow (""): scattered word springs + glow + resting drift
 * - Steps ("partita"): staggered rows + corner L-guides + word springs
 * - Tilt ("tilt"): 1-4 centered large parts + italic wavy accent part + char swell
 * - Sparks: burst streaks radiating from each sung word (16 streaks on line's last word)
 */
export const StageLyrics: React.FC<StageLyricsProps> = ({
  lyrics,
  lyricsLoaded,
  playing,
  positionMs,
  stageStyle,
  stageSparks,
  accent,
  quietActive,
  onChangeStyle,
  onToggleSparks,
  onOpenComments,
  t,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const stateRef = useRef({
    lyrics,
    lyricsLoaded,
    playing,
    positionMs,
    stageStyle,
    stageSparks,
    accent,
    quietDim: quietActive?.visible ? 1 : 0,
    quietVisible: !!quietActive?.visible,
    noLyricsText: t("No lyrics. Enjoy the music."),
  });
  stateRef.current.lyrics = lyrics;
  stateRef.current.lyricsLoaded = lyricsLoaded;
  stateRef.current.playing = playing;
  stateRef.current.positionMs = positionMs;
  stateRef.current.stageStyle = stageStyle;
  stateRef.current.stageSparks = stageSparks;
  stateRef.current.accent = accent;
  stateRef.current.quietVisible = !!quietActive?.visible;
  stateRef.current.noLyricsText = t("No lyrics. Enjoy the music.");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let lastNow = performance.now();

    const render = (now: number) => {
      raf = requestAnimationFrame(render);
      const dt = Math.min(Math.max((now - lastNow) / 1000, 0.001), 0.1);
      lastNow = now;

      const st = stateRef.current;
      const targetDim = st.quietVisible ? 1 : 0;
      st.quietDim += (targetDim - st.quietDim) * Math.min(1, dt * 6);
      if (Math.abs(targetDim - st.quietDim) < 0.004) st.quietDim = targetDim;

      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.round(rect.width * dpr);
      const ch = Math.round(rect.height * dpr);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const underAlpha = 1 - (1 - 0.06) * st.quietDim;
      if (underAlpha <= 0.02) {
        ctx.restore();
        return;
      }
      ctx.globalAlpha = underAlpha;

      const w = rect.width;
      const h = rect.height;
      const lines = st.lyrics.lines || [];
      const f = Math.min(64, Math.max(28, w * 0.048));
      const fontFamily =
        st.lyrics.lang === "ja"
          ? '"Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", -apple-system, sans-serif'
          : '-apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", sans-serif';

      if (lines.length === 0) {
        if (st.lyricsLoaded) {
          ctx.fillStyle = "rgba(255,255,255,0.4)";
          ctx.font = `800 ${Math.min(28, Math.max(20, w * 0.04))}px ${fontFamily}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(st.noLyricsText, w / 2, h / 2);
        }
        ctx.restore();
        return;
      }

      const posMs = st.playing ? audioRuntime.getSmoothPositionMs() : st.positionMs;

      // Locate current line (last line with atMs <= posMs)
      let cur = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].atMs <= posMs) cur = i;
        else break;
      }

      // Draw previous line fading out over 400ms
      if (cur > 0) {
        const gone = (posMs - lines[cur].atMs) / 400;
        if (gone >= 0 && gone < 1) {
          const prevFade = 1 - easeOutCubic(gone);
          drawStageLine(ctx, lines[cur - 1], posMs, f, w, h, prevFade * underAlpha, st.stageStyle, st.stageSparks, st.accent, fontFamily);
        }
      }

      // Draw current line or interlude breathing dots
      if (cur < 0) {
        drawInterlude(ctx, w, h, posMs, 0, lines[0].atMs, now, underAlpha);
      } else if (
        cur + 1 < lines.length &&
        posMs > (lines[cur].endMs || lines[cur].atMs) + 1000 &&
        lines[cur + 1].atMs - (lines[cur].endMs || lines[cur].atMs) > 4000
      ) {
        drawInterlude(ctx, w, h, posMs, lines[cur].endMs || lines[cur].atMs, lines[cur + 1].atMs, now, underAlpha);
      } else {
        drawStageLine(ctx, lines[cur], posMs, f, w, h, underAlpha, st.stageStyle, st.stageSparks, st.accent, fontFamily);
      }

      // Footer: translation + next line preview
      ctx.globalAlpha = underAlpha;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      let footY = h - 18;
      if (cur + 1 < lines.length) {
        ctx.fillStyle = "rgba(255,255,255,0.32)";
        ctx.font = `500 14px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
        ctx.fillText(clipToWidth(ctx, lines[cur + 1].text, w * 0.86), w / 2, footY);
        footY -= 24;
      }
      if (cur >= 0 && lines[cur].translation) {
        ctx.fillStyle = "rgba(255,255,255,0.74)";
        ctx.font = `600 ${Math.min(18, Math.max(14, w * 0.025))}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
        ctx.fillText(clipToWidth(ctx, lines[cur].translation!, w * 0.88), w / 2, footY);
      }

      ctx.restore();
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  const currentLabel = stageStyle === "partita" ? t("Steps") : stageStyle === "tilt" ? t("Tilt") : t("Flow");

  return (
    <div className="stage-shell" onClick={() => menuOpen && setMenuOpen(false)}>
      <canvas ref={canvasRef} className="stage-canvas" />

      <QuietCommentCard active={quietActive} stage onOpenComments={onOpenComments} t={t} />

      <div className="stage-style-anchor" onClick={(e) => e.stopPropagation()}>
        <button
          className="stage-style-btn"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={t("Stage Style")}
        >
          <span>{currentLabel}</span>
          <Icon name="chevron-down" size={14} />
        </button>

        {menuOpen && (
          <div className="stage-style-menu">
            {(
              [
                ["", "Flow"],
                ["partita", "Steps"],
                ["tilt", "Tilt"],
              ] as Array<[StageStyle, string]>
            ).map(([id, label]) => (
              <button
                key={id || "flow"}
                className={`stage-menu-item ${stageStyle === id ? "active" : ""}`}
                onClick={() => {
                  onChangeStyle(id);
                  setMenuOpen(false);
                }}
              >
                <span>{t(label)}</span>
                {stageStyle === id && <Icon name="check" size={14} />}
              </button>
            ))}
            <div className="stage-menu-sep" />
            <button
              className={`stage-menu-item ${stageSparks ? "active" : ""}`}
              onClick={() => {
                onToggleSparks();
                setMenuOpen(false);
              }}
            >
              <span>{t("Sparks")}</span>
              {stageSparks && <Icon name="check" size={14} />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

function drawInterlude(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  posMs: number,
  fromMs: number,
  toMs: number,
  nowMs: number,
  alpha: number
) {
  const progress = clamp01((posMs - fromMs) / Math.max(100, toMs - fromMs));
  const breath = 1 + 0.12 * Math.sin(nowMs / 420);
  const gap = 18;
  const r = 8 * breath;
  const cx = w / 2;
  const cy = h * 0.48;
  ctx.save();
  for (let i = 0; i < 3; i++) {
    const lit = clamp01(progress * 3 - i);
    const x = cx + (i - 1) * (16 + gap);
    ctx.fillStyle = `rgba(255,255,255,${(0.2 + 0.7 * lit) * alpha})`;
    ctx.beginPath();
    ctx.arc(x, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSparks(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rw: number,
  rh: number,
  sinceSec: number,
  seed: number,
  last: boolean,
  accent: RGBColor,
  layerAlpha: number
) {
  if (sinceSec < 0 || sinceSec >= SPARK_TIME) return;
  const t = sinceSec / SPARK_TIME;
  const n = last ? 16 : 9;
  const reach = Math.max(rw, rh) * 0.75 * (last ? 1.6 : 1.0);
  const out = 1 - Math.pow(1 - t, 3);
  const fade = Math.pow(1 - t, 2);
  const whiteMix = 0.6 * (1 - t);
  const r = Math.round(lerp(accent.r, 255, whiteMix));
  const g = Math.round(lerp(accent.g, 255, whiteMix));
  const b = Math.round(lerp(accent.b, 255, whiteMix));

  ctx.save();
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.9 * fade * layerAlpha})`;
  ctx.lineWidth = 0.8 + 1.6 * (1 - t);
  ctx.lineCap = "round";

  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * (i + lineRandom(seed, i) * 0.7)) / n;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const edge = (rw / 2) * 0.7 * Math.abs(dx) + (rh / 2) * 0.7 * Math.abs(dy);
    const head = edge + reach * (0.55 + 0.45 * lineRandom(seed, i + 50)) * out;
    const tail = Math.max(edge, head - reach * 0.3 * (1 - t));
    ctx.beginPath();
    ctx.moveTo(cx + dx * tail, cy + dy * tail);
    ctx.lineTo(cx + dx * head, cy + dy * head);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStageWord(
  ctx: CanvasRenderingContext2D,
  word: LyricWord,
  shape: WordShape,
  baseX: number,
  baseY: number,
  wordW: number,
  posMs: number,
  f: number,
  accent: RGBColor,
  sparks: boolean,
  layerAlpha: number,
  fontFamily: string
) {
  const lookahead = 80;
  const start = word.startMs - lookahead;
  const end = Math.max(word.endMs, word.startMs + 150);
  const since = (posMs - start) / 1000;
  const after = (posMs - end) / 1000;
  const singing = Math.max(0.08, (end - word.startMs) / 1000);

  let ox = shape.x + Math.sin(shape.y) * 100;
  let oy = shape.y + Math.cos(shape.x) * 50;
  let scale = 0.5;
  let rotate = shape.rotate + 20;
  let opacity = 0;
  let textAlpha = 0.5;
  let glow = 0;

  if (since > 0) {
    const e = springStep(since);
    ox = lerp(ox, shape.x, e);
    oy = lerp(oy, shape.y, e);
    scale = lerp(0.5, shape.scale * 1.4, e);
    rotate = lerp(shape.rotate + 20, shape.rotate, e);
    opacity = clamp01(since / 0.1);
    textAlpha = lerp(0.5, 1, clamp01(since / singing));
    glow = clamp01(since / Math.max(0.08, 0.3 * singing));
  }
  if (after > 0) {
    const q = easeOutCubic(after / 0.5);
    scale = lerp(shape.scale * 1.4, shape.scale, q);
    opacity = lerp(1, 0.82, q);
    rotate = shape.rotate + shape.drift * clamp01(after / 5);
    textAlpha = lerp(1, 0.5, easeOutCubic(after / 0.8));
    glow = 1 - clamp01(after / 0.9);
  }

  const finalAlpha = opacity * layerAlpha;
  if (finalAlpha <= 0.005) return;

  const cx = baseX + wordW / 2 + ox;
  const cy = baseY + oy;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.font = `800 ${f}px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (glow > 0.02) {
    ctx.shadowColor = `rgba(${accent.r}, ${accent.g}, ${accent.b}, ${glow * 0.85 * finalAlpha})`;
    ctx.shadowBlur = 18 * glow;
  }
  ctx.fillStyle = `rgba(255, 255, 255, ${textAlpha * finalAlpha})`;
  ctx.fillText(word.text, 0, 0);
  ctx.restore();

  if (sparks) {
    drawSparks(ctx, cx, cy, wordW * scale, f * scale, (posMs - word.startMs) / 1000, word.startMs, shape.last, accent, layerAlpha);
  }
}

function drawStageLine(
  ctx: CanvasRenderingContext2D,
  line: LyricLine,
  posMs: number,
  f: number,
  w: number,
  h: number,
  fade: number,
  style: StageStyle,
  sparks: boolean,
  accent: RGBColor,
  fontFamily: string
) {
  const words = ensureWords(line);
  if (words.length === 0) return;

  if (style === "partita") {
    drawPartitaLine(ctx, line, words, posMs, f, w, h, fade, sparks, accent, fontFamily);
    return;
  }
  if (style === "tilt") {
    drawTiltLine(ctx, line, words, posMs, w, h, fade, sparks, accent, fontFamily);
    return;
  }

  // Flow (classic): wrapped scattered words
  const seed = line.atMs;
  ctx.font = `800 ${f}px ${fontFamily}`;
  const widths = words.map((wd) => ctx.measureText(wd.text).width);
  const shapes: WordShape[] = words.map((_, i) => {
    const ws = seed + i;
    return {
      x: (lineRandom(ws, 1) - 0.5) * 30,
      y: (lineRandom(ws, 2) - 0.5) * 30,
      rotate: (lineRandom(ws, 3) - 0.5) * 10,
      scale: 1.05 + lineRandom(ws, 4) * 0.2,
      drift: (lineRandom(ws, 5) - 0.5) * 10,
      margin: 0,
      last: i === words.length - 1,
    };
  });
  const gap = f * 0.08;
  for (let i = 0; i < shapes.length; i++) {
    const grow = (widths[i] * (shapes[i].scale * 1.4 - 1)) / 2;
    const next = i + 1 < shapes.length ? (widths[i + 1] * (shapes[i + 1].scale * 1.4 - 1)) / 2 : 0;
    const toward = i + 1 < shapes.length ? shapes[i].x - shapes[i + 1].x : 0;
    shapes[i].margin = Math.max(2 * gap, grow + next + toward + gap);
  }

  // Wrap into visual rows within w * 0.8
  const maxRowW = w * 0.8;
  const rows: Array<{ indices: number[]; width: number }> = [];
  let curRow: number[] = [];
  let curW = 0;
  for (let i = 0; i < words.length; i++) {
    const itemW = widths[i] + (curRow.length > 0 ? shapes[i - 1].margin : 0);
    if (curRow.length > 0 && curW + itemW > maxRowW) {
      rows.push({ indices: curRow, width: curW });
      curRow = [i];
      curW = widths[i];
    } else {
      curW += itemW;
      curRow.push(i);
    }
  }
  if (curRow.length > 0) rows.push({ indices: curRow, width: curW });

  const justifyMode = Math.abs(Math.floor(seed)) % 3; // 0 start, 1 center, 2 end
  const lift = [-0.1, 0, 0.08][Math.abs(Math.floor(seed * 2)) % 3] * h;
  const rowH = f * 1.45;
  const totalH = rows.length * rowH;
  const startY = (h - 70 - totalH) / 2 + rowH / 2 + lift;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    let x = w * 0.1;
    if (justifyMode === 1) x = (w - row.width) / 2;
    else if (justifyMode === 2) x = w * 0.9 - row.width;
    const y = startY + r * rowH;

    for (let k = 0; k < row.indices.length; k++) {
      const idx = row.indices[k];
      drawStageWord(ctx, words[idx], shapes[idx], x, y, widths[idx], posMs, f, accent, sparks, fade, fontFamily);
      x += widths[idx] + shapes[idx].margin;
    }
  }
}

function drawPartitaLine(
  ctx: CanvasRenderingContext2D,
  line: LyricLine,
  words: LyricWord[],
  posMs: number,
  baseF: number,
  w: number,
  h: number,
  fade: number,
  sparks: boolean,
  accent: RGBColor,
  fontFamily: string
) {
  const units = stageUnits(words);
  if (units.length === 0) return;

  let f = baseF * 0.8;
  if (wordsLength(words) > 40) f *= 0.8;

  const seed = line.atMs / 1000;
  let k = 0;
  const rnd = () => {
    k += 1;
    return lineRandom(seed, k);
  };
  const count = Math.min(units.length, Math.max(1, Math.floor((h * 0.6) / 96)));
  const rows: PartitaRow[] = [];
  let left = units.length;
  let unitIdx = 0;
  for (let i = 0; i < count; i++) {
    let n = left;
    if (i < count - 1) {
      const avg = left / (count - i);
      n = Math.min(Math.ceil(avg * 1.5), Math.max(1, Math.round(avg + (rnd() - 0.5) * avg)));
    }
    n = Math.max(1, Math.min(n, left - (count - i - 1)));
    const stagger = Math.min(w * 0.12, 18 + rnd() * 68);
    const isLeft = i % 2 === 0;
    rows.push({
      from: units[unitIdx][0],
      to: units[unitIdx + n - 1][1],
      x: isLeft ? -stagger : stagger,
      y: (i - (count - 1) / 2) * 2.5,
      scale: 0.8 + rnd() * 0.7,
      left: isLeft,
    });
    unitIdx += n;
    left -= n;
  }

  const lookahead = 80;
  const grow = 1 + 0.05 * (1 - fade);
  const rowStep = f * 1.75;
  const totalH = rows.length * rowStep;
  const startY = (h - 70 - totalH) / 2 + rowStep / 2;

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(grow, grow);
  ctx.translate(-w / 2, -h / 2);

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const rWords = words.slice(row.from, row.to);
    if (rWords.length === 0) continue;

    const since = (posMs - (rWords[0].startMs - lookahead)) / 1000;
    const end = (posMs - Math.max(rWords[rWords.length - 1].endMs, rWords[rWords.length - 1].startMs + 150)) / 1000;
    const side = row.left ? -40 : 40;
    let rx = row.x + side;
    let rScale = 0.85;
    let rOpacity = 0;
    if (since > 0) {
      const e = springStep(since);
      rx = lerp(row.x + side, row.x, e);
      rScale = lerp(0.85, 1, e);
      rOpacity = clamp01(since / 0.1);
    }

    const rowAlpha = rOpacity * fade;
    if (rowAlpha <= 0.004) continue;

    ctx.font = `800 ${f}px ${fontFamily}`;
    const widths = rWords.map((wd) => ctx.measureText(wd.text).width);
    const wSeed = rWords[0].startMs / 1000;
    const shapes: WordShape[] = rWords.map((_, i) => {
      const ws = wSeed + i * 7.13;
      return {
        x: (lineRandom(ws, 1) - 0.5) * 12,
        y: (lineRandom(ws, 2) - 0.5) * 12,
        rotate: (lineRandom(ws, 3) - 0.5) * 6,
        scale: row.scale,
        drift: (lineRandom(ws, 8) - 0.5) * 20,
        margin: 0,
        last: ri === rows.length - 1 && i === rWords.length - 1,
      };
    });
    const gap = f * 0.08;
    let rowW = 0;
    for (let i = 0; i < shapes.length; i++) {
      const g1 = (widths[i] * (shapes[i].scale * 1.4 - 1)) / 2;
      const g2 = i + 1 < shapes.length ? (widths[i + 1] * (shapes[i + 1].scale * 1.4 - 1)) / 2 : 0;
      const toward = i + 1 < shapes.length ? shapes[i].x - shapes[i + 1].x : 0;
      shapes[i].margin = i === shapes.length - 1 ? 0 : Math.max(2 * gap, g1 + g2 + toward + gap);
      rowW += widths[i] + shapes[i].margin;
    }

    const fitScale = rowW > w * 0.82 ? (w * 0.82) / rowW : 1;
    const rowY = startY + ri * rowStep + row.y;

    ctx.save();
    ctx.translate(w / 2 + rx, rowY);
    ctx.scale(rScale * fitScale, rScale * fitScale);

    // Corner L-shaped guide line matching ui_stage_styles.go
    const guide = easeOutCubic(since / 0.4);
    if (guide > 0.01) {
      let guideColor = `rgba(255,255,255,${0.14 * guide * rowAlpha})`;
      if (end > 0) {
        guideColor = `rgba(255,255,255,${0.22 * guide * rowAlpha})`;
      } else if (since > 0) {
        guideColor = `rgba(${accent.r},${accent.g},${accent.b},${guide * rowAlpha})`;
      }
      const halfW = rowW / 2 + 8;
      const bottom = f * 0.58;
      ctx.strokeStyle = guideColor;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (row.left) {
        ctx.moveTo(-halfW - 8, bottom + 14);
        ctx.lineTo(-halfW - 8, bottom + 14 - 30 * guide);
        ctx.moveTo(-halfW - 16, bottom + 6);
        ctx.lineTo(-halfW - 16 + (rowW + 40) * guide, bottom + 6);
      } else {
        ctx.moveTo(halfW + 8, bottom + 14);
        ctx.lineTo(halfW + 8, bottom + 14 - 30 * guide);
        ctx.moveTo(halfW + 16, bottom + 6);
        ctx.lineTo(halfW + 16 - (rowW + 40) * guide, bottom + 6);
      }
      ctx.stroke();
    }

    let cursorX = -rowW / 2;
    for (let i = 0; i < rWords.length; i++) {
      drawStageWord(ctx, rWords[i], shapes[i], cursorX, 0, widths[i], posMs, f, accent, sparks, rowAlpha, fontFamily);
      cursorX += widths[i] + shapes[i].margin;
    }

    ctx.restore();
  }

  ctx.restore();
}

function splitTiltParts(words: LyricWord[], units: Array<[number, number]>, n: number): TiltPart[] {
  const total = wordsLength(words);
  const before: number[] = [0];
  for (let i = 0; i < units.length; i++) {
    before.push(before[i] + wordsLength(words.slice(units[i][0], units[i][1])));
  }
  const parts: TiltPart[] = [];
  let from = 0;
  for (let k = 1; k < n; k++) {
    let at = -1;
    let best = 0;
    for (let cut = from + 1; cut <= units.length - (n - k); cut++) {
      let d = Math.abs(before[cut] - (total * k) / n);
      const lastWord = words[units[cut - 1][1] - 1].text.trim();
      const lastChar = Array.from(lastWord).pop() || "";
      if (lastChar && isPunct(lastChar)) {
        d -= total * 0.15;
      }
      if (at < 0 || d < best) {
        at = cut;
        best = d;
      }
    }
    parts.push({ from: units[from][0], to: units[at - 1][1], lean: false, tail: false });
    from = at;
  }
  parts.push({ from: units[from][0], to: units[units.length - 1][1], lean: false, tail: false });
  return parts;
}

function drawTiltLine(
  ctx: CanvasRenderingContext2D,
  line: LyricLine,
  words: LyricWord[],
  posMs: number,
  w: number,
  h: number,
  fade: number,
  sparks: boolean,
  accent: RGBColor,
  fontFamily: string
) {
  const units = stageUnits(words);
  if (units.length === 0) return;

  const seed = line.atMs / 1000;
  const chars = wordsLength(words);
  const score = (Math.log(chars + 4) / Math.log(24)) * (lineRandom(seed, 1) * 0.6 + 0.7) * 0.75;
  let n = 4;
  const thresholds = [0.45, 1.05, 1.7];
  for (let i = 0; i < thresholds.length; i++) {
    if (score < thresholds[i]) {
      n = i + 1;
      break;
    }
  }

  let size = Math.min(w * 0.06875, 86);
  const avail = w * 0.85;

  const measurePart = (p: TiltPart, sz: number) => {
    const weight = p.lean ? 300 : 400;
    const spacing = p.lean ? 0.15 : 0.08;
    const text = words
      .slice(p.from, p.to)
      .map((wd) => wd.text)
      .join("")
      .trim();
    ctx.font = `${p.lean ? "italic " : ""}${weight} ${sz}px ${fontFamily}`;
    return ctx.measureText(text).width + Array.from(text).length * sz * spacing;
  };

  let parts: TiltPart[] = [];
  for (;;) {
    parts = splitTiltParts(words, units, Math.min(n, units.length));
    const leanCandidates: number[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (lineRandom(seed, 100 + i) < 0.35) leanCandidates.push(i);
    }
    if (leanCandidates.length > 0) {
      const pick = leanCandidates[Math.floor(lineRandom(seed, 200) * leanCandidates.length)];
      parts[pick].lean = true;
    }
    const widest = Math.max(...parts.map((p) => measurePart(p, size)));
    if (n >= 4 || n >= units.length || widest <= avail) break;
    n += 1;
  }

  if (parts.length > 1 && !parts[parts.length - 1].lean) {
    const lastLen = wordsLength(words.slice(parts[parts.length - 1].from, parts[parts.length - 1].to));
    const prevLen = wordsLength(words.slice(parts[parts.length - 2].from, parts[parts.length - 2].to));
    parts[parts.length - 1].tail = lastLen <= 2 && lastLen * 2 <= prevLen;
  }

  const widest = Math.max(...parts.map((p) => measurePart(p, size)));
  if (widest > avail) {
    size *= Math.max(0.48, avail / widest);
  }

  const tiltLead = 250;
  const lineStep = size * 1.45 + 10;
  const totalH = parts.length * lineStep;
  const startY = (h - 70 - totalH) / 2 + lineStep / 2 - 12 * (1 - fade);

  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    const pWords = words.slice(part.from, part.to);
    if (pWords.length === 0) continue;
    const partSize = !part.lean && part.tail ? size * 1.18 : size;
    const weight = part.lean ? 300 : 400;
    const spacing = part.lean ? 0.15 : 0.08;
    const gap = part.lean ? 0.35 : 0.25;
    const pulse = part.lean ? 0.18 : 0.15;
    const stagger = part.lean ? 0.05 : 0.04;
    const since = (posMs - (pWords[0].startMs - tiltLead)) / 1000;
    const inVal = easeOutQuad(since / (part.lean ? 0.6 : 0.55));
    const rise = (part.lean ? 24 : 20) * (1 - inVal);
    const pScale = part.lean ? 0.92 + 0.08 * inVal : 1;
    const partAlpha = inVal * fade;
    if (partAlpha <= 0.005) continue;

    ctx.font = `${part.lean ? "italic " : ""}${weight} ${partSize}px ${fontFamily}`;

    // Build character items for layout width measurement
    type CharItem = {
      ch: string;
      space: boolean;
      w: number;
      startMs: number;
      eachMs: number;
      wordStartMs: number;
      isWordFirst: boolean;
      isLastWord: boolean;
      k: number;
    };
    const items: CharItem[] = [];
    let kIdx = 0;
    for (let wi = 0; wi < pWords.length; wi++) {
      const wd = pWords[wi];
      const trimmedRight = wd.text.replace(/\s+$/u, "");
      const charsArr = Array.from(trimmedRight);
      const eachMs = Math.max(1, (wd.endMs - wd.startMs) / Math.max(charsArr.length, 1));
      for (let i = 0; i < charsArr.length; i++) {
        const ch = charsArr[i];
        if (/\s/u.test(ch)) {
          items.push({ ch, space: true, w: partSize * gap, startMs: wd.startMs, eachMs, wordStartMs: wd.startMs, isWordFirst: false, isLastWord: false, k: kIdx });
          continue;
        }
        items.push({
          ch,
          space: false,
          w: ctx.measureText(ch).width + partSize * spacing,
          startMs: wd.startMs + i * eachMs,
          eachMs,
          wordStartMs: wd.startMs,
          isWordFirst: i === 0,
          isLastWord: pi === parts.length - 1 && wi === pWords.length - 1,
          k: kIdx,
        });
        kIdx += 1;
      }
      if (trimmedRight !== wd.text && wi < pWords.length - 1) {
        items.push({ ch: " ", space: true, w: partSize * gap, startMs: wd.endMs, eachMs, wordStartMs: wd.startMs, isWordFirst: false, isLastWord: false, k: kIdx });
      }
    }

    const totalW = items.reduce((acc, it) => acc + it.w, 0);
    const centerY = startY + pi * lineStep + rise;

    ctx.save();
    ctx.translate(w / 2, centerY);
    ctx.scale(pScale, pScale);

    let cx = -totalW / 2;
    for (const it of items) {
      if (it.space) {
        cx += it.w;
        continue;
      }
      const d = Math.min(Math.max(it.eachMs / 1000, 0.2), 0.9);
      const tSec = (posMs - it.startMs) / 1000;
      let swell = 0;
      if (tSec >= 0 && tSec <= d) {
        swell = Math.sin((tSec / d) * Math.PI);
      } else if (tSec > d) {
        swell = 0.25 * clamp01((tSec - d) / (d * 1.2));
      }
      const s = 1 + swell * pulse;
      const shown = easeOutQuad((since - it.k * stagger) / 0.5);
      const yOff = part.lean ? ((it.k % 2 === 0 ? -1 : 1) * (partSize / 6) * (2 - shown)) : 0;

      const drawX = cx + (it.w - partSize * spacing) / 2;
      ctx.save();
      ctx.translate(drawX, yOff);
      ctx.scale(s, s);
      ctx.font = `${part.lean ? "italic " : ""}${weight} ${partSize}px ${fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const alpha = shown * partAlpha;
      ctx.fillStyle = part.lean
        ? `rgba(${accent.r}, ${accent.g}, ${accent.b}, ${alpha})`
        : `rgba(255, 255, 255, ${alpha})`;
      ctx.fillText(it.ch, 0, 0);
      ctx.restore();

      if (sparks && it.isWordFirst) {
        drawSparks(ctx, drawX, yOff, it.w * s, partSize * s, (posMs - it.wordStartMs) / 1000, it.wordStartMs, it.isLastWord, accent, partAlpha);
      }

      cx += it.w;
    }

    ctx.restore();
  }
}

function clipToWidth(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (!text || ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxW) {
    s = s.slice(0, -1);
  }
  return s + "…";
}
