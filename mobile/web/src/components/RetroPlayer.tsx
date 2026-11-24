import React, { useEffect, useRef } from "react";
import { audioRuntime } from "../audioRuntime";
import type { CoverPalette, PlayerStyle, Track } from "../types";
import { Icon } from "./Icons";

interface RetroPlayerProps {
  styleMode: PlayerStyle;
  track: Track;
  artUrl: string;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  palette: CoverPalette;
}

/**
 * Renders the Now Playing centerpiece matching desktop MyGo Music:
 * - "": Cover art with subtle pause breathing (0.88x)
 * - "vinyl": Turntable deck, 33⅓ RPM (200°/s) spinning vinyl record + label,
 *            red 33 strobe LED, and spring-animated tonearm tracking progress
 * - "cassette": 1:0.64 translucent shell, dual 150°/s reels with equal-area
 *               tape pack radius transition, cover color stripes & handwritten label
 */
export const RetroPlayer: React.FC<RetroPlayerProps> = ({
  styleMode,
  track,
  artUrl,
  playing,
  positionMs,
  durationMs,
  palette,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const armOnRef = useRef(playing ? 1 : 0);
  const stateRef = useRef({ styleMode, track, playing, positionMs, durationMs, palette });
  stateRef.current = { styleMode, track, playing, positionMs, durationMs, palette };

  useEffect(() => {
    if (!artUrl) {
      imgRef.current = null;
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
    };
    img.src = artUrl;
  }, [artUrl]);

  useEffect(() => {
    if (styleMode === "") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    let raf = 0;
    let lastFrame = 0;
    const frameInterval = 1000 / 30;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - lastFrame < frameInterval) return;
      const dt = lastFrame > 0 ? Math.min((now - lastFrame) / 1000, 0.1) : 1 / 30;
      lastFrame = now;

      const st = stateRef.current;
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

      const smoothMs = st.playing ? audioRuntime.getSmoothPositionMs() : st.positionMs;
      const posSec = smoothMs / 1000;
      const dur = Math.max(st.durationMs || st.track.duration || 1, 1);
      const prog = Math.max(0, Math.min(1, smoothMs / dur));

      // Smooth spring-like tonearm lift/drop
      const targetArm = st.playing ? 1 : 0;
      if (reduced) {
        armOnRef.current = targetArm;
      } else {
        armOnRef.current += (targetArm - armOnRef.current) * Math.min(1, dt * 4.5);
        if (Math.abs(targetArm - armOnRef.current) < 0.003) armOnRef.current = targetArm;
      }

      if (st.styleMode === "vinyl") {
        drawTurntable(ctx, rect.width, rect.height, posSec, prog, st.playing, armOnRef.current, reduced, imgRef.current);
      } else {
        drawCassette(ctx, rect.width, rect.height, posSec, prog, reduced, imgRef.current, st.track, st.palette);
      }
      ctx.restore();
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [styleMode]);

  if (styleMode === "") {
    return (
      <div className={`np-art ${playing ? "playing" : "paused"}`}>
        {artUrl ? <img src={artUrl} alt="" /> : <Icon name="note" size={64} />}
      </div>
    );
  }

  return (
    <div className={`retro-stage ${styleMode === "cassette" ? "cassette" : "vinyl"}`}>
      <canvas ref={canvasRef} className="retro-canvas" />
    </div>
  );
};

function drawTurntable(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  posSec: number,
  progress: number,
  playing: boolean,
  armOn: number,
  reduced: boolean,
  cover: HTMLImageElement | null
) {
  const s = Math.min(w, h);
  const ox = (w - s) / 2;
  const oy = (h - s) / 2;

  ctx.save();
  ctx.translate(ox, oy);

  // Deck plinth with subtle lighting matching desktop retro_render.go
  const plinthGrad = ctx.createLinearGradient(0, 0, s, s);
  plinthGrad.addColorStop(0, "#2f3239");
  plinthGrad.addColorStop(0.5, "#1f2126");
  plinthGrad.addColorStop(1, "#14161a");
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = s * 0.07;
  ctx.shadowOffsetY = s * 0.03;
  ctx.fillStyle = plinthGrad;
  ctx.beginPath();
  ctx.roundRect(s * 0.02, s * 0.02, s * 0.96, s * 0.96, s * 0.055);
  ctx.fill();
  ctx.restore();

  // Subtle metallic bevel
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(s * 0.022, s * 0.022, s * 0.956, s * 0.956, s * 0.055);
  ctx.stroke();

  const cx = s * 0.445;
  const cy = s * 0.5;
  const platterR = s * 0.415;
  const recordR = s * 0.385;
  const labelR = recordR * 0.36;

  // Machined aluminum platter rim
  const rimGrad = ctx.createLinearGradient(cx - platterR, cy - platterR, cx + platterR, cy + platterR);
  rimGrad.addColorStop(0, "#6d717a");
  rimGrad.addColorStop(0.5, "#3a3d45");
  rimGrad.addColorStop(1, "#555963");
  ctx.fillStyle = rimGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, platterR, 0, Math.PI * 2);
  ctx.fill();

  // Strobe dots around platter rim
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  const dots = 48;
  const spinRad = reduced ? 0 : (((posSec * 200) % 360) * Math.PI) / 180;
  for (let i = 0; i < dots; i++) {
    const a = spinRad + (i / dots) * Math.PI * 2;
    const dx = cx + Math.cos(a) * (platterR - s * 0.015);
    const dy = cy + Math.sin(a) * (platterR - s * 0.015);
    ctx.beginPath();
    ctx.arc(dx, dy, s * 0.004, 0, Math.PI * 2);
    ctx.fill();
  }

  // Vinyl disc
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(spinRad);

  const discGrad = ctx.createRadialGradient(0, 0, labelR, 0, 0, recordR);
  discGrad.addColorStop(0, "#101114");
  discGrad.addColorStop(0.6, "#17181d");
  discGrad.addColorStop(1, "#0b0c0f");
  ctx.fillStyle = discGrad;
  ctx.beginPath();
  ctx.arc(0, 0, recordR, 0, Math.PI * 2);
  ctx.fill();

  // Grooves
  ctx.strokeStyle = "rgba(255,255,255,0.045)";
  ctx.lineWidth = 0.8;
  for (let r = labelR + s * 0.018; r < recordR - s * 0.012; r += s * 0.014) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Specular anisotropic highlight across vinyl
  ctx.save();
  ctx.rotate(-spinRad);
  const sheen = ctx.createLinearGradient(-recordR, -recordR, recordR, recordR);
  sheen.addColorStop(0, "rgba(255,255,255,0.0)");
  sheen.addColorStop(0.32, "rgba(255,255,255,0.09)");
  sheen.addColorStop(0.45, "rgba(255,255,255,0.0)");
  sheen.addColorStop(0.75, "rgba(255,255,255,0.06)");
  sheen.addColorStop(1, "rgba(255,255,255,0.0)");
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.arc(0, 0, recordR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Spinning circular center cover label
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, labelR, 0, Math.PI * 2);
  ctx.clip();
  if (cover) {
    ctx.drawImage(cover, -labelR, -labelR, labelR * 2, labelR * 2);
  } else {
    ctx.fillStyle = "#e05263";
    ctx.fillRect(-labelR, -labelR, labelR * 2, labelR * 2);
  }
  // Subtle paper vignette
  const paper = ctx.createRadialGradient(0, 0, labelR * 0.3, 0, 0, labelR);
  paper.addColorStop(0, "rgba(255,255,255,0.06)");
  paper.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = paper;
  ctx.fillRect(-labelR, -labelR, labelR * 2, labelR * 2);
  ctx.restore();

  // Chrome spindle
  const spindleGrad = ctx.createRadialGradient(-s * 0.004, -s * 0.004, 1, 0, 0, s * 0.02);
  spindleGrad.addColorStop(0, "#ffffff");
  spindleGrad.addColorStop(0.55, "#b7bcc6");
  spindleGrad.addColorStop(1, "#4a4e57");
  ctx.fillStyle = spindleGrad;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.018, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Start/Stop button & 33/45 LEDs matching desktop coordinates
  const btnX = s * 0.12;
  const btnY = s * 0.875;
  ctx.fillStyle = "#2b2e35";
  ctx.beginPath();
  ctx.roundRect(btnX - s * 0.055, btnY - s * 0.032, s * 0.11, s * 0.064, s * 0.012);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = `600 ${Math.max(8, s * 0.024)}px -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("START", btnX, btnY);

  // 33 RPM red LED indicator
  const ledX = s * 0.127;
  const ledY = s * 0.812;
  ctx.save();
  if (playing) {
    ctx.shadowColor = "#ff6a4a";
    ctx.shadowBlur = s * 0.03;
    ctx.fillStyle = "#ff6a4a";
  } else {
    ctx.fillStyle = "#4a1d18";
  }
  ctx.beginPath();
  ctx.arc(ledX, ledY, s * 0.011, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = `700 ${Math.max(8, s * 0.024)}px -apple-system, sans-serif`;
  ctx.fillText("33", ledX + s * 0.042, ledY);

  // Tonearm pivot & tracking geometry matching ui_retro.go
  const px = s * 0.835;
  const py = s * 0.185;

  // Pivot gimbal housing
  const gimbal = ctx.createRadialGradient(px - s * 0.015, py - s * 0.015, s * 0.01, px, py, s * 0.085);
  gimbal.addColorStop(0, "#686d78");
  gimbal.addColorStop(0.6, "#2c2f36");
  gimbal.addColorStop(1, "#181a1f");
  ctx.fillStyle = gimbal;
  ctx.beginPath();
  ctx.arc(px, py, s * 0.082, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.stroke();

  // Compute tonearm angle by law of cosines between outer groove & inner groove
  const armLen = s * 0.56;
  const distPivotCenter = Math.hypot(px - cx, py - cy);
  const targetRadius = recordR * 0.955 + (recordR * 0.42 - recordR * 0.955) * progress;
  const baseAngle = Math.atan2(cy - py, cx - px);
  const cosDelta = Math.max(
    -1,
    Math.min(1, (distPivotCenter * distPivotCenter + armLen * armLen - targetRadius * targetRadius) / (2 * distPivotCenter * armLen))
  );
  const playedAngle = baseAngle - Math.acos(cosDelta);
  const restAngle = Math.PI / 2 - 0.08;
  const angle = restAngle + (playedAngle - restAngle) * armOn;

  const lift = s * (0.01 + 0.016 * (1 - armOn));

  const drawArmShape = (isShadow: boolean) => {
    ctx.save();
    if (isShadow) {
      ctx.translate(px + lift, py + lift * 1.15);
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.filter = "blur(4px)";
    } else {
      ctx.translate(px, py);
    }
    ctx.rotate(angle);

    // Counterweight
    if (!isShadow) ctx.fillStyle = "#484d57";
    ctx.beginPath();
    ctx.roundRect(-s * 0.11, -s * 0.028, s * 0.075, s * 0.056, s * 0.012);
    ctx.fill();

    // S-curved arm tube
    if (!isShadow) {
      const tubeGrad = ctx.createLinearGradient(0, -s * 0.012, 0, s * 0.012);
      tubeGrad.addColorStop(0, "#d7dce4");
      tubeGrad.addColorStop(0.5, "#8d939f");
      tubeGrad.addColorStop(1, "#eef1f6");
      ctx.strokeStyle = tubeGrad;
    }
    ctx.lineWidth = s * 0.022;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-s * 0.04, 0);
    ctx.bezierCurveTo(armLen * 0.35, -s * 0.035, armLen * 0.7, s * 0.045, armLen * 0.94, s * 0.015);
    ctx.stroke();

    // Headshell & cartridge
    ctx.save();
    ctx.translate(armLen * 0.94, s * 0.015);
    ctx.rotate(0.22);
    if (!isShadow) ctx.fillStyle = "#23262c";
    ctx.beginPath();
    ctx.roundRect(-s * 0.02, -s * 0.022, s * 0.095, s * 0.044, s * 0.01);
    ctx.fill();
    if (!isShadow) {
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();

    ctx.restore();
  };

  drawArmShape(true);
  drawArmShape(false);

  // Center pivot cap
  ctx.fillStyle = "#c4c9d3";
  ctx.beginPath();
  ctx.arc(px, py, s * 0.028, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawCassette(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  posSec: number,
  progress: number,
  reduced: boolean,
  cover: HTMLImageElement | null,
  track: Track,
  palette: CoverPalette
) {
  const cw = Math.min(w, h / 0.64);
  const ch = cw * 0.64;
  const ox = (w - cw) / 2;
  const oy = (h - ch) / 2;

  ctx.save();
  ctx.translate(ox, oy);

  // Translucent dark shell
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = cw * 0.06;
  ctx.shadowOffsetY = cw * 0.03;
  const bodyGrad = ctx.createLinearGradient(0, 0, 0, ch);
  bodyGrad.addColorStop(0, "#2f333c");
  bodyGrad.addColorStop(0.5, "#1e2026");
  bodyGrad.addColorStop(1, "#16181d");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.roundRect(0, 0, cw, ch, cw * 0.045);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(1, 1, cw - 2, ch - 2, cw * 0.045);
  ctx.stroke();

  // Corner screws
  const screws = [
    [cw * 0.048, ch * 0.075],
    [cw * 0.952, ch * 0.075],
    [cw * 0.048, ch * 0.925],
    [cw * 0.952, ch * 0.925],
  ];
  for (const [sx, sy] of screws) {
    ctx.fillStyle = "#525763";
    ctx.beginPath();
    ctx.arc(sx, sy, cw * 0.014, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#181a20";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx - cw * 0.008, sy);
    ctx.lineTo(sx + cw * 0.008, sy);
    ctx.stroke();
  }

  // Cream paper label
  const lx = cw * 0.075;
  const ly = ch * 0.08;
  const lw = cw * 0.85;
  const lh = ch * 0.62;
  ctx.fillStyle = "#f2eee6";
  ctx.beginPath();
  ctx.roundRect(lx, ly, lw, lh, cw * 0.022);
  ctx.fill();

  // Cover-tinted dual color stripes on label
  const tintCss = `rgb(${palette.tint.r}, ${palette.tint.g}, ${palette.tint.b})`;
  const accentCss = `rgb(${palette.accent.r}, ${palette.accent.g}, ${palette.accent.b})`;
  ctx.fillStyle = tintCss;
  ctx.fillRect(lx, ly + lh * 0.68, lw, lh * 0.14);
  ctx.fillStyle = accentCss;
  ctx.fillRect(lx, ly + lh * 0.82, lw, lh * 0.07);

  // Small square cover art thumbnail on left of label
  const thumb = cw * 0.095;
  const tx = lx + cw * 0.032;
  const ty = ly + ch * 0.042;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(tx, ty, thumb, thumb, cw * 0.01);
  ctx.clip();
  if (cover) {
    ctx.drawImage(cover, tx, ty, thumb, thumb);
  } else {
    ctx.fillStyle = tintCss;
    ctx.fillRect(tx, ty, thumb, thumb);
  }
  ctx.restore();

  // Handwritten blue ink title & artist + Side A badge
  ctx.fillStyle = "#1d2a6b";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const textX = tx + thumb + cw * 0.028;
  const maxTextW = lx + lw - textX - cw * 0.1;

  ctx.font = `italic 600 ${Math.max(11, cw * 0.042)}px Georgia, "Times New Roman", serif`;
  ctx.fillText(truncateText(ctx, track.name, maxTextW), textX, ty + thumb * 0.32);

  const artistStr = (track.artists || []).map((a) => a.name).join(", ");
  ctx.font = `italic 400 ${Math.max(9, cw * 0.03)}px Georgia, "Times New Roman", serif`;
  ctx.fillStyle = "rgba(29, 42, 107, 0.75)";
  ctx.fillText(truncateText(ctx, artistStr, maxTextW), textX, ty + thumb * 0.76);

  // Side A mark
  ctx.fillStyle = "#1d2a6b";
  ctx.font = `800 ${Math.max(11, cw * 0.045)}px -apple-system, sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText("A", lx + lw - cw * 0.035, ty + thumb * 0.48);

  // Clear center tape window
  const wx = cw * 0.19;
  const wy = ch * 0.34;
  const ww = cw * 0.62;
  const wh = ch * 0.3;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(wx, wy, ww, wh, cw * 0.024);
  ctx.fillStyle = "#121318";
  ctx.fill();
  ctx.clip();

  // Equal-area tape pack radii matching ui_retro.go
  const hubR = cw * 0.055;
  const fullR = cw * 0.185;
  const reelY = wy + wh * 0.5;
  const reelLX = cw * 0.295;
  const reelRX = cw * 0.705;

  const leftR = Math.sqrt(hubR * hubR + (fullR * fullR - hubR * hubR) * (1 - progress));
  const rightR = Math.sqrt(hubR * hubR + (fullR * fullR - hubR * hubR) * progress);

  // Magnetic tape spools
  ctx.fillStyle = "#2b1f1a";
  ctx.beginPath();
  ctx.arc(reelLX, reelY, leftR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(reelRX, reelY, rightR, 0, Math.PI * 2);
  ctx.fill();

  // Tape subtle concentric wrap lines
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(reelLX, reelY, leftR - 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(reelRX, reelY, rightR - 2, 0, Math.PI * 2);
  ctx.stroke();

  // Spinning white toothed hubs (150°/s)
  const reelRad = reduced ? 0 : (((posSec * 150) % 360) * Math.PI) / 180;
  for (const rx of [reelLX, reelRX]) {
    ctx.save();
    ctx.translate(rx, reelY);
    ctx.rotate(reelRad);
    ctx.fillStyle = "#e6e8ee";
    ctx.beginPath();
    ctx.arc(0, 0, hubR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#15171d";
    ctx.beginPath();
    ctx.arc(0, 0, hubR * 0.56, 0, Math.PI * 2);
    ctx.fill();

    // 6 inner drive teeth
    ctx.fillStyle = "#e6e8ee";
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.save();
      ctx.rotate(a);
      ctx.fillRect(-hubR * 0.1, -hubR * 0.62, hubR * 0.2, hubR * 0.24);
      ctx.restore();
    }
    ctx.restore();
  }

  // Subtle window glass highlight
  const glass = ctx.createLinearGradient(wx, wy, wx, wy + wh);
  glass.addColorStop(0, "rgba(255,255,255,0.12)");
  glass.addColorStop(0.45, "rgba(255,255,255,0.0)");
  glass.addColorStop(1, "rgba(255,255,255,0.05)");
  ctx.fillStyle = glass;
  ctx.fillRect(wx, wy, ww, wh);
  ctx.restore();

  // Window frame border
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(wx, wy, ww, wh, cw * 0.024);
  ctx.stroke();

  // Bottom trapezoid tape head bay
  ctx.fillStyle = "#15171c";
  ctx.beginPath();
  ctx.moveTo(cw * 0.22, ch);
  ctx.lineTo(cw * 0.27, ch * 0.78);
  ctx.lineTo(cw * 0.73, ch * 0.78);
  ctx.lineTo(cw * 0.78, ch);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.stroke();

  // Capstan holes
  ctx.fillStyle = "#0b0c10";
  for (const hx of [cw * 0.34, cw * 0.44, cw * 0.56, cw * 0.66]) {
    ctx.beginPath();
    ctx.arc(hx, ch * 0.89, cw * 0.022, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (!text) return "";
  if (ctx.measureText(text).width <= maxW) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(out + "…").width > maxW) {
    out = out.slice(0, -1);
  }
  return out + "…";
}
