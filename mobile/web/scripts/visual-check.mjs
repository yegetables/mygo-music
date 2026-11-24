#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.resolve(WEB_DIR, "../bridge/webdist");
const OUT_DIR = process.env.MYGO_VISUAL_OUT || "/tmp/opencode/mygo-visual";

fs.mkdirSync(OUT_DIR, { recursive: true });

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    "/home/yegetables/.local/share/mise/installs/playwright/1.65.1/lib/node_modules/playwright",
  ].filter(Boolean);
  const req = createRequire(import.meta.url);
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return req(c);
    }
  }
  return req("playwright");
}

function findChromium() {
  for (const bin of ["/usr/bin/chromium", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser"]) {
    if (fs.existsSync(bin)) return bin;
  }
  return undefined;
}

// Generate an attractive SVG cover artwork matching green Rain palette
const COVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1b4d2e"/>
      <stop offset="55%" stop-color="#3a7d44"/>
      <stop offset="100%" stop-color="#7bbf6a"/>
    </linearGradient>
  </defs>
  <rect width="600" height="600" fill="url(#g)"/>
  <circle cx="430" cy="180" r="140" fill="rgba(255,255,255,0.16)"/>
  <circle cx="190" cy="410" r="190" fill="rgba(255,255,255,0.12)"/>
  <text x="50%" y="54%" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="62" font-weight="700">Rain</text>
  <text x="50%" y="64%" text-anchor="middle" fill="rgba(255,255,255,0.82)" font-family="sans-serif" font-size="28">言ノ葉 · 秦基博</text>
</svg>`;

const MOCK_TRACKS = Array.from({ length: 10 }, (_, i) => ({
  id: `t-${i + 1}`,
  source: "netease",
  name: i === 0 ? "Rain" : i === 1 ? "One more time, One more chance (秒速5センチメートル 主题曲)" : `言叶之庭 Track ${i + 1}`,
  artists: [{ id: `a-${i + 1}`, name: i === 0 ? "秦基博" : i === 1 ? "山崎まさよし" : "RADWIMPS" }],
  album: { id: `al-${i + 1}`, name: "言ノ葉", imageUrl: `https://mock.local/cover-${i + 1}.svg` },
  duration: 293000 + i * 11000,
}));

const MOCK_LYRICS = {
  lines: [
    { atMs: 0, endMs: 4200, text: "言葉にできず 凍えたままで", trans: "无法化作言语 就这样冻结着" },
    { atMs: 4200, endMs: 9200, text: "人前ではやさしく生きていた", trans: "在人前总是温柔地活着" },
    { atMs: 9200, endMs: 14800, text: "しわよせで こんなふうに雑に", trans: "结果却像这样草率地" },
    { atMs: 14800, endMs: 21000, text: "雨の夜に 君を抱きしめてた", trans: "在雨夜里紧紧拥抱着你" },
  ],
  quiets: [],
};

const MOCK_COMMENTS = {
  more: true,
  comments: [
    { id: "c1", author: "秋月孝雄", text: "隐约雷鸣，阴霾天空，但盼风雨来，能留你在此。", likes: 24891, liked: true },
    { id: "c2", author: "雪野百香里", text: "隐约雷鸣，阴霾天空，即使天无雨，我亦留此地。", likes: 19320, liked: false },
  ],
};

function createMockServer() {
  let settings = {
    activeSource: "netease",
    quality: "lossless",
    language: "zh-CN",
    theme: "dark",
    cacheLimitMB: 2048,
    playerStyle: "",
    hotComments: false,
    normalize: true,
    smoke: true,
    fog: true,
    growFromCover: false,
    lyricsStage: false,
    stageStyle: "",
    stageSparks: true,
    updateChannel: "fork",
    autoCheckUpdates: false,
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const p = url.pathname;

    if (p === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.write('event: ready\ndata: {"version":"0.1.25-dev-0001"}\n\n');
      return;
    }
    if (p === "/api/image") {
      res.writeHead(200, { "Content-Type": "image/svg+xml" });
      res.end(COVER_SVG);
      return;
    }
    if (p === "/api/image/palette") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          tint: { r: 58, g: 125, b: 68 },
          accent: { r: 123, g: 191, b: 106 },
          deep: { r: 22, g: 56, b: 30 },
          fog: { r: 74, g: 146, b: 84 },
        })
      );
      return;
    }
    if (p === "/api/settings") {
      if (req.method === "POST") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            settings = { ...settings, ...JSON.parse(body) };
          } catch {}
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(settings));
        });
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(settings));
      return;
    }
    if (p === "/api/session") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          queue: MOCK_TRACKS,
          index: 0,
          positionMs: 2000,
          repeatMode: "all",
          shuffle: false,
        })
      );
      return;
    }
    if (p === "/api/sources") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          activeSource: "netease",
          sources: [
            {
              builtin: false,
              disabled: false,
              info: {
                id: "netease",
                name: "网易云音乐",
                version: "0.1.13",
                settings: [
                  {
                    key: "endpoint",
                    label: "自定义 API 地址",
                    help: "留空使用默认接口",
                    link: "https://github.com/yegetables/mygo-music-netease-cloud-music-very-long-url-check",
                    type: "text",
                  },
                ],
              },
              capabilities: {
                home: true,
                search: true,
                stream: true,
                like: true,
                liked: true,
                comments: true,
                postComment: true,
                likeComment: true,
                lyrics: true,
                playlists: true,
                account: true,
                signIn: true,
              },
              settings: { endpoint: "" },
              origin: { repo: "yegetables/mygo-music-netease-cloud-music", version: "0.1.13" },
            },
            {
              builtin: true,
              disabled: false,
              info: { id: "local", name: "本地音乐" },
              capabilities: { home: true, stream: true },
              settings: {},
            },
          ],
        })
      );
      return;
    }
    if (p === "/api/update/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          currentVersion: "0.1.25-dev-0001",
          channel: "fork",
          autoCheck: true,
          channels: [
            { id: "fork", repo: "yegetables/mygo-music", supported: true },
            { id: "official", repo: "egoist/mygo-music", supported: false, reason: "官方上游暂不提供 Android 安装包" },
          ],
        })
      );
      return;
    }
    if (p === "/api/cache/stats") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ totalBytes: 128 * 1024 * 1024, limitMB: 2048, fileCount: 18 }));
      return;
    }
    if (p === "/api/local/folders") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ folders: ["/Music"] }));
      return;
    }
    if (p.endsWith("/account")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ account: { id: "u1", name: "Demo Listener" } }));
      return;
    }
    if (p.endsWith("/playlists")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          playlists: [{ id: "pl1", name: "雨天歌单", mine: true, imageUrl: "https://mock.local/cover-1.svg" }],
        })
      );
      return;
    }
    if (p.endsWith("/home")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          title: "首页",
          sections: [
            { id: "s1", title: "推荐单曲", kind: "tracks", tracks: MOCK_TRACKS.slice(0, 6) },
            {
              id: "s2",
              title: "精选专辑",
              kind: "albums",
              albums: MOCK_TRACKS.slice(0, 4).map((t) => ({ ...t.album, artist: t.artists[0].name })),
            },
          ],
        })
      );
      return;
    }
    if (p.endsWith("/lyrics")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(MOCK_LYRICS));
      return;
    }
    if (p.endsWith("/comments")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(MOCK_COMMENTS));
      return;
    }
    if (p.endsWith("/is-liked")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ liked: { "t-1": true } }));
      return;
    }
    if (p === "/api/stream/info") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ streamUrl: "", quality: "lossless", type: "flac", normGain: 1.0 }));
      return;
    }
    if (p.startsWith("/api/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Static webdist assets
    let filePath = path.join(DIST_DIR, p === "/" ? "index.html" : p);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(DIST_DIR, "index.html");
    }
    const ext = path.extname(filePath);
    const mime =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".js"
        ? "application/javascript; charset=utf-8"
        : ext === ".css"
        ? "text/css; charset=utf-8"
        : "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    fs.createReadStream(filePath).pipe(res);
  });

  return {
    server,
    setTheme(t) {
      settings.theme = t;
    },
    resetStage() {
      settings.lyricsStage = false;
    },
  };
}

async function auditLayout(page, label) {
  const issues = await page.evaluate(() => {
    const errs = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (document.documentElement.scrollWidth > vw + 1) {
      errs.push(`document overflow: scrollWidth=${document.documentElement.scrollWidth} > vw=${vw}`);
    }

    // Check settings rows and groups
    for (const el of document.querySelectorAll(".settings-group, .setting-row")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1) {
        errs.push(`settings clipped right (${el.className}): right=${Math.round(r.right)} > vw=${vw}`);
      }
      if (el.scrollWidth > el.clientWidth + 2) {
        errs.push(`settings horizontal overflow (${el.className}): scroll=${el.scrollWidth} > client=${el.clientWidth}`);
      }
    }

    // Check NowPlaying topbar pills + bottom controls + queue thumbs
    const np = document.querySelector(".np-overlay");
    if (np) {
      const pills = Array.from(np.querySelectorAll(".np-pill-group .pill"));
      const pillGroup = np.querySelector(".np-pill-group");
      if (pillGroup && pills.length > 0) {
        const gRect = pillGroup.getBoundingClientRect();
        for (const p of pills) {
          const pr = p.getBoundingClientRect();
          if (pr.right > gRect.right + 2 || pr.left < gRect.left - 2) {
            errs.push(`topbar pill "${p.textContent?.trim()}" overflows pill-group (${Math.round(pr.left)}..${Math.round(pr.right)} vs ${Math.round(gRect.left)}..${Math.round(gRect.right)})`);
          }
        }
      }

      const playBtn = np.querySelector(".play-btn");
      if (playBtn) {
        const br = playBtn.getBoundingClientRect();
        if (br.bottom > vh + 1) {
          errs.push(`play-btn clipped below viewport: bottom=${Math.round(br.bottom)} > vh=${vh}`);
        }
      }

      for (const thumb of np.querySelectorAll(".track-thumb")) {
        const tr = thumb.getBoundingClientRect();
        if (tr.width > 60 || tr.height > 60) {
          errs.push(`queue track-thumb abnormally large: ${Math.round(tr.width)}x${Math.round(tr.height)}`);
        }
      }
    }

    return errs;
  });

  if (issues.length > 0) {
    console.error(`[FAIL] ${label}:`);
    for (const i of issues) console.error(`  - ${i}`);
  } else {
    console.log(`[PASS] ${label}`);
  }
  return issues;
}

const VIEWPORTS = [
  { name: "phone-360", width: 360, height: 800, isMobile: true },
  { name: "phone-se", width: 375, height: 667, isMobile: true },
  { name: "phone-land", width: 812, height: 375, isMobile: true },
  { name: "ipad-port", width: 820, height: 1180, isMobile: true },
  { name: "ipad-land", width: 1180, height: 820, isMobile: false },
];

async function run() {
  const { chromium } = loadPlaywright();
  const mock = createMockServer();
  await new Promise((resolve) => mock.server.listen(0, "127.0.0.1", resolve));
  const port = mock.server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/?token=test&platform=android`;

  const browser = await chromium.launch({
    executablePath: findChromium(),
    headless: true,
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl"],
  });

  const allFailures = [];
  try {
    for (const theme of ["dark", "light"]) {
      mock.setTheme(theme);
      for (const vp of VIEWPORTS) {
        mock.resetStage();
        const ctx = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: 2,
          locale: "zh-CN",
        });
        const page = await ctx.newPage();
        await page.addInitScript(() => {
          window.MyGoNative = {
            postMessage: () => {},
          };
        });
        await page.goto(baseUrl, { waitUntil: "networkidle" });
        await page.waitForTimeout(350);

        // Click first track so /api/stream/info runs and sets LOSSLESS badge
        const firstTrack = page.locator(".track-row .track-meta").first();
        if ((await firstTrack.count()) > 0) {
          await firstTrack.click();
          await page.waitForTimeout(200);
        }

        // Trigger native playing event & bass level so Smoke glow renders at 0:02
        await page.evaluate(() => {
          window.__mygoNativeEvent?.("playbackState", { playing: true, buffering: false, positionMs: 2000, durationMs: 293000 });
          window.__mygoNativeEvent?.("audioLevel", { bass: 0.48, live: true });
        });

        // 1. Home page
        allFailures.push(...(await auditLayout(page, `${vp.name}/${theme}/home`)).map((m) => `${vp.name}/${theme}/home: ${m}`));
        if ((vp.name === "phone-360" || vp.name === "ipad-land") && theme === "light") {
          await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-${theme}-home.png`) });
        }

        // 2. Settings page
        const settingsBtn =
          vp.width <= 820
            ? page.locator(".mobile-tabbar button").last()
            : page.locator(".sidebar button", { hasText: "设置" });
        await settingsBtn.click();
        await page.waitForTimeout(250);
        allFailures.push(...(await auditLayout(page, `${vp.name}/${theme}/settings`)).map((m) => `${vp.name}/${theme}/settings: ${m}`));
        if (vp.name === "phone-360" || (vp.name === "ipad-port" && theme === "light")) {
          await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-${theme}-settings.png`) });
        }

        // 3. Open Now Playing (clicking player bar left)
        await page.locator(".player-left").click();
        await page.waitForTimeout(550);
        await page.evaluate(() => {
          window.__mygoNativeEvent?.("playbackState", { playing: true, buffering: false, positionMs: 2000, durationMs: 293000 });
          window.__mygoNativeEvent?.("audioLevel", { bass: 0.52, live: true });
        });
        await page.waitForTimeout(450);
        allFailures.push(...(await auditLayout(page, `${vp.name}/${theme}/np-cover`)).map((m) => `${vp.name}/${theme}/np-cover: ${m}`));
        if (vp.name === "phone-360" || vp.name === "phone-se" || vp.name === "phone-land" || vp.name === "ipad-land") {
          await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-${theme}-np-cover.png`) });
        }

        // Also capture paused thumb at 0:02 on phone-360 dark to verify zero left slicing
        if (vp.name === "phone-360" && theme === "dark") {
          await page.evaluate(() => {
            window.__mygoNativeEvent?.("playbackState", { playing: false, buffering: false, positionMs: 2000, durationMs: 293000 });
          });
          await page.waitForTimeout(300);
          await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-${theme}-np-paused.png`) });
          await page.evaluate(() => {
            window.__mygoNativeEvent?.("playbackState", { playing: true, buffering: false, positionMs: 2000, durationMs: 293000 });
          });
        }

        // 4. Switch to Queue tab
        const queuePill = page.locator(".np-pill-group .pill", { hasText: /队列/ });
        await queuePill.click();
        await page.waitForTimeout(250);
        allFailures.push(...(await auditLayout(page, `${vp.name}/${theme}/np-queue`)).map((m) => `${vp.name}/${theme}/np-queue: ${m}`));
        if (vp.name === "phone-360" || (vp.name === "ipad-land" && theme === "dark")) {
          await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-${theme}-np-queue.png`) });
        }

        // 5. Switch to Comments tab (especially verify light theme isolation!)
        const commentsPill = page.locator(".np-pill-group .pill", { hasText: "评论" });
        if ((await commentsPill.count()) > 0) {
          await commentsPill.click();
          await page.waitForTimeout(250);
          allFailures.push(...(await auditLayout(page, `${vp.name}/${theme}/np-comments`)).map((m) => `${vp.name}/${theme}/np-comments: ${m}`));
          if (vp.name === "phone-360" && theme === "light") {
            await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-${theme}-np-comments.png`) });
          }
        }

        // 6. Switch to Stage tab
        const stagePill = page.locator(".np-pill-group .pill", { hasText: "律动" });
        await stagePill.click();
        await page.waitForTimeout(350);
        allFailures.push(...(await auditLayout(page, `${vp.name}/${theme}/np-stage`)).map((m) => `${vp.name}/${theme}/np-stage: ${m}`));
        if (vp.name === "phone-360" && theme === "dark") {
          await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-${theme}-np-stage.png`) });
        }

        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    mock.server.close();
  }

  console.log(`\nScreenshots saved to ${OUT_DIR}`);
  if (allFailures.length > 0) {
    console.error(`\nTOTAL FAILURES: ${allFailures.length}`);
    process.exit(1);
  }
  console.log("ALL MULTI-VIEWPORT VISUAL & OVERFLOW CHECKS PASSED!");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
