import React, { useEffect, useRef, useState } from "react";
import { audioRuntime } from "../audioRuntime";
import type { CoverPalette } from "../types";

interface FogBackdropProps {
  enabled: boolean;
  playing: boolean;
  palette: CoverPalette;
  artUrl?: string;
}

const VERT_SRC = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Direct port of internal/app/backdrop.go fogSource (5-octave fbm + domain warp + bass pulse + rising dust specks).
// Uses highp when supported and a sinless hash so mobile fp16 GPUs (Adreno/Mali) never collapse hash() to 0.
const FRAG_SRC = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_res;
uniform float u_time;
uniform float u_bass;
uniform vec3 u_deep;
uniform vec3 u_fog;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
#ifdef GL_FRAGMENT_PRECISION_HIGH
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
#else
  p3 += dot(p3, p3.yzx + 3.33);
  p3 = fract(p3);
  return fract((p3.x + p3.y) * p3.z * 7.13 + p3.x * 3.71);
#endif
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 pos = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 uv = pos / u_res;
  vec2 p = pos / max(u_res.y, 1.0) * 2.4;
  float t = u_time;
  vec2 rise = vec2(0.0, t * 0.1);
  vec2 q = vec2(
    fbm(p + rise + vec2(0.0, t * 0.04)),
    fbm(p + rise + vec2(5.2, 1.3) - vec2(t * 0.05, 0.0))
  );
  float f = fbm(p + rise + 0.9 * q);
  float bank = fbm(p * 0.45 + rise * 0.6 + vec2(3.7, 0.0));
  float cloud = smoothstep(0.3 - 0.06 * u_bass, 0.78, f) * (0.45 + 0.75 * smoothstep(0.3, 0.65, bank));
  float m = smoothstep(-0.1, 0.4, uv.y) * (1.0 - 0.5 * smoothstep(0.65, 1.0, uv.y));
  vec3 c = mix(u_deep, u_fog, min(cloud * m * (0.85 + 0.35 * u_bass), 1.0));

  float g = length((uv - vec2(0.5, 0.42)) * vec2(1.0, 1.25));
  c *= 1.08 - 0.45 * smoothstep(0.2, 0.85, g);

  float cell = max(u_res.y / 22.0, 8.0);
  vec2 sp = (pos + vec2(0.0, t * cell * 0.9)) / cell;
  vec2 id = floor(sp);
  float h = hash(id + vec2(3.1, 7.7));
  if (h > 0.93) {
    vec2 at = vec2(hash(id + vec2(1.3, 2.9)), hash(id + vec2(8.1, 4.3))) * 0.8 + 0.1;
    float d = length((fract(sp) - at) * cell) / max(cell * 0.05, 0.7);
    float glint = 0.5 + 0.5 * sin(t * (1.5 + 2.0 * h) + h * 40.0);
    c += vec3(0.75, 0.82, 1.0) * exp(-d * d) * glint * (0.25 + 0.3 * m);
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export const FogBackdrop: React.FC<FogBackdropProps> = ({ enabled, playing, palette, artUrl }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fallbackRef = useRef<HTMLCanvasElement | null>(null);
  const [use2DFallback, setUse2DFallback] = useState(false);
  const stateRef = useRef({
    playing,
    targetDeep: [palette.deep.r / 255, palette.deep.g / 255, palette.deep.b / 255],
    targetFog: [palette.fog.r / 255, palette.fog.g / 255, palette.fog.b / 255],
    curDeep: [palette.deep.r / 255, palette.deep.g / 255, palette.deep.b / 255],
    curFog: [palette.fog.r / 255, palette.fog.g / 255, palette.fog.b / 255],
    drift: 0,
    speed: playing ? 1 : 0,
  });

  stateRef.current.playing = playing;
  stateRef.current.targetDeep = [palette.deep.r / 255, palette.deep.g / 255, palette.deep.b / 255];
  stateRef.current.targetFog = [palette.fog.r / 255, palette.fog.g / 255, palette.fog.b / 255];

  useEffect(() => {
    if (!enabled || use2DFallback) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl =
      canvas.getContext("webgl", { alpha: false, antialias: false, powerPreference: "low-power" }) ||
      (canvas.getContext("experimental-webgl", { alpha: false, antialias: false }) as WebGLRenderingContext | null);
    if (!gl) {
      setUse2DFallback(true);
      return;
    }

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) {
      setUse2DFallback(true);
      return;
    }
    const prog = gl.createProgram();
    if (!prog) {
      setUse2DFallback(true);
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      setUse2DFallback(true);
      return;
    }

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setUse2DFallback(true);
    };
    canvas.addEventListener("webglcontextlost", onContextLost);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const locPos = gl.getAttribLocation(prog, "a_pos");
    const locRes = gl.getUniformLocation(prog, "u_res");
    const locTime = gl.getUniformLocation(prog, "u_time");
    const locBass = gl.getUniformLocation(prog, "u_bass");
    const locDeep = gl.getUniformLocation(prog, "u_deep");
    const locFog = gl.getUniformLocation(prog, "u_fog");

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    let raf = 0;
    let lastDraw = 0;
    let paintedStatic = false;
    const frameInterval = 1000 / 30;

    const renderFrame = (now: number) => {
      raf = requestAnimationFrame(renderFrame);
      if (now - lastDraw < frameInterval) return;
      const dt = lastDraw > 0 ? Math.min((now - lastDraw) / 1000, 0.1) : 1 / 30;
      lastDraw = now;

      const st = stateRef.current;
      // Smoothly cross-fade colors on track changes (~700ms like backdropFade)
      const colorStep = Math.min(1, dt * 4.5);
      let colorMoving = false;
      for (let i = 0; i < 3; i++) {
        const dd = st.targetDeep[i] - st.curDeep[i];
        const df = st.targetFog[i] - st.curFog[i];
        if (Math.abs(dd) > 0.002 || Math.abs(df) > 0.002) {
          st.curDeep[i] += dd * colorStep;
          st.curFog[i] += df * colorStep;
          colorMoving = true;
        } else {
          st.curDeep[i] = st.targetDeep[i];
          st.curFog[i] = st.targetFog[i];
        }
      }

      const wantSpeed = st.playing && !reduced ? 1 : 0;
      st.speed += (wantSpeed - st.speed) * Math.min(1, 2.5 * dt);
      if (Math.abs(wantSpeed - st.speed) < 0.004) st.speed = wantSpeed;
      st.drift += st.speed * dt;

      const bass = reduced ? 0 : audioRuntime.sampleBass(dt);

      const rect = canvas.getBoundingClientRect();
      // 1/2 resolution matching desktop backdrop.go div=2
      const rw = Math.max(64, Math.round(rect.width * 0.5));
      const rh = Math.max(64, Math.round(rect.height * 0.5));
      const resized = canvas.width !== rw || canvas.height !== rh;
      if (resized) {
        canvas.width = rw;
        canvas.height = rh;
      }

      if (paintedStatic && !resized && !colorMoving && st.speed === 0 && bass <= 0.004) {
        return;
      }
      paintedStatic = true;

      gl.viewport(0, 0, rw, rh);
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(locPos);
      gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);

      gl.uniform2f(locRes, rw, rh);
      gl.uniform1f(locTime, st.drift);
      gl.uniform1f(locBass, Math.min(bass, 1.0));
      gl.uniform3f(locDeep, st.curDeep[0], st.curDeep[1], st.curDeep[2]);
      gl.uniform3f(locFog, st.curFog[0], st.curFog[1], st.curFog[2]);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    raf = requestAnimationFrame(renderFrame);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [enabled, use2DFallback]);

  // Canvas 2D fallback when WebGL is unavailable or lost
  useEffect(() => {
    if (!enabled || !use2DFallback) return;
    const canvas = fallbackRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    let raf = 0;
    let lastDraw = 0;
    let paintedStatic = false;
    const frameInterval = 1000 / 24;

    const render2D = (now: number) => {
      raf = requestAnimationFrame(render2D);
      if (now - lastDraw < frameInterval) return;
      const dt = lastDraw > 0 ? Math.min((now - lastDraw) / 1000, 0.1) : 1 / 24;
      lastDraw = now;

      const st = stateRef.current;
      const colorStep = Math.min(1, dt * 4.5);
      let colorMoving = false;
      for (let i = 0; i < 3; i++) {
        const dd = st.targetDeep[i] - st.curDeep[i];
        const df = st.targetFog[i] - st.curFog[i];
        if (Math.abs(dd) > 0.002 || Math.abs(df) > 0.002) {
          st.curDeep[i] += dd * colorStep;
          st.curFog[i] += df * colorStep;
          colorMoving = true;
        } else {
          st.curDeep[i] = st.targetDeep[i];
          st.curFog[i] = st.targetFog[i];
        }
      }

      const wantSpeed = st.playing && !reduced ? 1 : 0;
      st.speed += (wantSpeed - st.speed) * Math.min(1, 2.5 * dt);
      if (Math.abs(wantSpeed - st.speed) < 0.004) st.speed = wantSpeed;
      st.drift += st.speed * dt;
      const bass = reduced ? 0 : audioRuntime.sampleBass(dt);

      const rect = canvas.getBoundingClientRect();
      const rw = Math.max(64, Math.round(rect.width * 0.35));
      const rh = Math.max(64, Math.round(rect.height * 0.35));
      const resized = canvas.width !== rw || canvas.height !== rh;
      if (resized) {
        canvas.width = rw;
        canvas.height = rh;
      }

      if (paintedStatic && !resized && !colorMoving && st.speed === 0 && bass <= 0.004) {
        return;
      }
      paintedStatic = true;

      const dr = Math.round(st.curDeep[0] * 255);
      const dg = Math.round(st.curDeep[1] * 255);
      const db = Math.round(st.curDeep[2] * 255);
      const fr = Math.round(st.curFog[0] * 255);
      const fg = Math.round(st.curFog[1] * 255);
      const fb = Math.round(st.curFog[2] * 255);

      ctx.fillStyle = `rgb(${dr}, ${dg}, ${db})`;
      ctx.fillRect(0, 0, rw, rh);

      const t = st.drift;
      const pulse = 0.85 + 0.35 * Math.min(bass, 1);
      const puffs = 6;
      for (let i = 0; i < puffs; i++) {
        const phase = i * 1.37;
        const cx = rw * (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(t * (0.14 + i * 0.025) + phase)));
        const cy = rh * (1.15 - (((t * (0.04 + i * 0.008) + i / puffs) % 1.35)));
        const rad = Math.max(rw, rh) * (0.38 + 0.14 * Math.sin(t * 0.2 + phase)) * (1 + 0.1 * bass);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        const alpha = Math.min(0.45, 0.26 * pulse);
        grad.addColorStop(0, `rgba(${fr}, ${fg}, ${fb}, ${alpha})`);
        grad.addColorStop(0.55, `rgba(${fr}, ${fg}, ${fb}, ${alpha * 0.35})`);
        grad.addColorStop(1, `rgba(${fr}, ${fg}, ${fb}, 0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, rw, rh);
      }

      // Vignette matching shader
      const vg = ctx.createRadialGradient(rw * 0.5, rh * 0.42, rw * 0.15, rw * 0.5, rh * 0.42, Math.max(rw, rh) * 0.8);
      vg.addColorStop(0, "rgba(0, 0, 0, 0)");
      vg.addColorStop(1, "rgba(0, 0, 0, 0.42)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, rw, rh);
    };

    raf = requestAnimationFrame(render2D);
    return () => cancelAnimationFrame(raf);
  }, [enabled, use2DFallback]);

  if (!enabled) {
    return (
      <div className="np-backdrop-static" style={{ background: `linear-gradient(180deg, rgb(${palette.deep.r}, ${palette.deep.g}, ${palette.deep.b}) 0%, #0b0c10 100%)` }}>
        {artUrl && <div className="np-backdrop" style={{ backgroundImage: `url(${artUrl})` }} />}
      </div>
    );
  }

  return (
    <div className="np-backdrop-fog">
      {use2DFallback ? (
        <canvas ref={fallbackRef} className="np-fog-canvas" />
      ) : (
        <canvas ref={canvasRef} className="np-fog-canvas" />
      )}
    </div>
  );
};
