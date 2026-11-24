import React, { useEffect, useRef, useState } from "react";
import { audioRuntime } from "../audioRuntime";
import type { RGBColor } from "../types";

interface SmokeScrubberProps {
  value: number;
  max: number;
  playing: boolean;
  buffering: boolean;
  smokeEnabled: boolean;
  accent: RGBColor;
  onChange: (ms: number) => void;
  onCommit: (ms: number) => void;
  compact?: boolean;
  ariaLabel?: string;
}

function lineRandom(seed: number, offset: number): number {
  const x = Math.sin(seed + offset) * 10000;
  return x - Math.floor(x);
}

/**
 * Progress bar matching desktop MyGo Music:
 * - Touch & mouse scrubbable with instant visual feedback
 * - When smokeEnabled && playing && !buffering && !dragging:
 *   renders a comet gradient tail, bass-reactive glowing head, and 36 stateless
 *   rising smoke wisps (1.4s life, ~30fps).
 */
export const SmokeScrubber: React.FC<SmokeScrubberProps> = ({
  value,
  max,
  playing,
  buffering,
  smokeEnabled,
  accent,
  onChange,
  onCommit,
  compact = false,
  ariaLabel = "Playback progress",
}) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragVal, setDragVal] = useState<number | null>(null);
  const smokeFadeRef = useRef(0);
  const latestRef = useRef({ value, max, playing, buffering, smokeEnabled, accent, dragging, dragVal });
  latestRef.current = { value, max, playing, buffering, smokeEnabled, accent, dragging, dragVal };

  const safeMax = Math.max(max, 1);
  const shown = dragVal !== null ? dragVal : value;
  const frac = Math.max(0, Math.min(1, shown / safeMax));

  const calcMsFromClientX = (clientX: number): number => {
    const el = wrapRef.current;
    if (!el) return value;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return value;
    const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(p * safeMax);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const ms = calcMsFromClientX(e.clientX);
    setDragging(true);
    setDragVal(ms);
    onChange(ms);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const ms = calcMsFromClientX(e.clientX);
    setDragVal(ms);
    onChange(ms);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const ms = calcMsFromClientX(e.clientX);
    setDragging(false);
    setDragVal(null);
    onCommit(ms);
  };

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (!smokeEnabled || reduced) {
      smokeFadeRef.current = 0;
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    let raf = 0;
    let lastFrame = performance.now();
    const frameInterval = 1000 / 30;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - lastFrame < frameInterval) return;
      const dt = (now - lastFrame) / 1000;
      lastFrame = now;

      const st = latestRef.current;
      const target = st.smokeEnabled && st.playing && !st.buffering && !st.dragging ? 1 : 0;
      const step = Math.min(1, dt / 0.6);
      smokeFadeRef.current += (target - smokeFadeRef.current) * Math.min(1, step * 3);
      if (Math.abs(target - smokeFadeRef.current) < 0.005) {
        smokeFadeRef.current = target;
      }

      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;
      const rect = wrap.getBoundingClientRect();
      if (rect.width <= 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const padTop = compact ? 30 : 42;
      const padBottom = 14;
      const cw = Math.ceil(rect.width);
      const ch = Math.ceil(rect.height + padTop + padBottom);

      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
        canvas.style.width = `${cw}px`;
        canvas.style.height = `${ch}px`;
        canvas.style.top = `${-padTop}px`;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, cw, ch);

      const smoking = smokeFadeRef.current;
      if (smoking <= 0.004) {
        ctx.restore();
        return;
      }

      const bass = audioRuntime.sampleBass(dt);
      const smoothMs = st.dragging && st.dragVal !== null
        ? st.dragVal
        : (st.playing && !st.buffering ? audioRuntime.getSmoothPositionMs() : st.value);
      const p = Math.max(0, Math.min(1, smoothMs / Math.max(st.max, 1)));
      const headX = p * cw;
      const trackY = padTop + rect.height / 2;
      const thick = compact ? 4 : 5;

      // Smoke tint: accent mixed slightly toward white
      const sr = Math.round(st.accent.r * 0.65 + 255 * 0.35);
      const sg = Math.round(st.accent.g * 0.65 + 255 * 0.35);
      const sb = Math.round(st.accent.b * 0.65 + 255 * 0.35);

      // 1. Comet gradient trail over the played portion
      if (headX > 1) {
        const grad = ctx.createLinearGradient(0, trackY, headX, trackY);
        grad.addColorStop(0, `rgba(${sr}, ${sg}, ${sb}, ${0.28 * smoking})`);
        grad.addColorStop(0.75, `rgba(${sr}, ${sg}, ${sb}, ${0.75 * smoking})`);
        grad.addColorStop(1, `rgba(255, 255, 255, ${0.95 * smoking})`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(0, trackY - thick / 2, headX, thick, thick / 2);
        ctx.fill();
      }

      // 2. Stateless deterministic smoke wisps (36 wisps, 1.4s lifetime)
      const wisps = 36;
      const life = 1.4;
      const rate = wisps / life;
      const tSec = Date.now() / 1000;
      const latestIdx = Math.floor(tSec * rate);

      for (let i = 0; i < wisps; i++) {
        const k = latestIdx - i;
        const born = k / rate;
        const age = tSec - born;
        if (age < 0 || age >= life) continue;
        if (lineRandom(k, 5) > 0.6 + 0.4 * bass) continue;

        const f = age / life;
        const wx = headX - age * (12 + 22 * lineRandom(k, 1));
        const wy =
          trackY -
          age * (12 + 18 * lineRandom(k, 2)) +
          Math.sin(age * (2.5 + 2 * lineRandom(k, 3)) + lineRandom(k, 4) * Math.PI * 2) * 6 * f;
        const size = (compact ? 2.5 : 3) + f * (12 + 10 * lineRandom(k, 4));
        const alpha = 0.48 * Math.pow(1 - f, 1.4) * smoking * (0.75 + 0.5 * bass);

        const rg = ctx.createRadialGradient(wx, wy, 0, wx, wy, size * 1.45);
        rg.addColorStop(0, `rgba(${sr}, ${sg}, ${sb}, ${alpha})`);
        rg.addColorStop(0.5, `rgba(${sr}, ${sg}, ${sb}, ${alpha * 0.45})`);
        rg.addColorStop(1, `rgba(${sr}, ${sg}, ${sb}, 0)`);
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(wx, wy, size * 1.45, 0, Math.PI * 2);
        ctx.fill();
      }

      // 3. Glowing playhead & bright core
      const glowRadius = (compact ? 11 : 14) + 10 * bass;
      const hg = ctx.createRadialGradient(headX, trackY, 0, headX, trackY, glowRadius);
      hg.addColorStop(0, `rgba(255, 255, 255, ${0.95 * smoking})`);
      hg.addColorStop(0.35, `rgba(${sr}, ${sg}, ${sb}, ${0.75 * smoking})`);
      hg.addColorStop(1, `rgba(${sr}, ${sg}, ${sb}, 0)`);
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.arc(headX, trackY, glowRadius, 0, Math.PI * 2);
      ctx.fill();

      const coreRadius = (thick * (1 + 0.28 * bass)) * 0.62;
      ctx.fillStyle = `rgba(255, 255, 255, ${smoking})`;
      ctx.beginPath();
      ctx.arc(headX, trackY, coreRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [smokeEnabled, compact]);

  const fillColor = `rgb(${accent.r}, ${accent.g}, ${accent.b})`;

  return (
    <div
      ref={wrapRef}
      className={`smoke-scrubber ${compact ? "compact" : ""} ${dragging ? "dragging" : ""}`}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={Math.round(shown)}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="smoke-track">
        <div
          className="smoke-fill"
          style={{
            width: `${frac * 100}%`,
            background: smokeEnabled && playing && !buffering && !dragging ? "transparent" : fillColor,
          }}
        />
        {(!smokeEnabled || !playing || buffering || dragging) && (
          <div className="smoke-thumb" style={{ left: `${frac * 100}%` }} />
        )}
      </div>
      <canvas ref={canvasRef} className="smoke-canvas" />
    </div>
  );
};
