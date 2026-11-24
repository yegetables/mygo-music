# MyGo Music Mobile (iPadOS 17.0+ & Android 12+)

移动端采用共享纯 Go 核心（`internal/mobilecore`）+ 响应式 Web UI（`mobile/web`）+ 双端原生壳（`mobile/ios`、`mobile/android`）架构：

- **100% 兼容 MyGo Music 插件系统**（基于纯 Go `moejs` 沙箱，无需 JIT），支持安装纯 JS/网络类插件（包括 `mygo-music-netease-cloud-music`）。
- **原生后台播放与系统媒控**：iPadOS 使用 `AVPlayer` + `AVAudioSession(.playback)` + `MPNowPlayingInfoCenter`（Go 代理自动将 OGG Vorbis 转为 WAV 流以支持 Seek）；Android 12+ 使用 `Media3 ExoPlayer` + `MediaSessionService` 前台服务。
- **单设备完整登录支持**：支持 `host.webSignIn`（弹出原生无痕 `WKWebView` / Android `WebView` 自动获取 Cookie）与二维码登录（支持保存二维码到相册）。

## 安装方式

### iPadOS 17.1+（已越狱 / iloader）
- 产物：`MyGoMusic-v0.1.25-iPadOS17-arm64.ipa`（不含付费开发者受限 Entitlements）
- **推荐方式 1（iloader）**：直接使用 `iloader` 将 `.ipa` 安装到 iPad（重启未越狱时也可正常打开；配合 ReProvision Reborn 可自动续签）。
- **推荐方式 2（Dopamine 越狱永久免签）**：通过 Sileo 安装 **TrollStore Lite** 或 **AppSync Unified + Filza**，将 `.ipa` 传到 iPad 直接安装。

### Android 12+（API 31+, arm64-v8a）
- 产物：`MyGoMusic-v0.1.25-Android12-arm64.apk`
- 直接在手机点击安装或通过 `adb install MyGoMusic-v0.1.25-Android12-arm64.apk` 安装。

## 安装网易云插件（`mygo-music-netease-cloud-music`）

1. 打开 App → 进入 **插件 & 设置** → 点击 **安装插件**；
2. 选择以下任一方式：
   - **本地 ZIP 包**：选择 `mygo-music-netease-cloud-music-v*.zip`（或在 iPadOS「文件」/ Filza、Android 文件管理器中直接用 MyGo Music 打开 `.zip`）；
   - **GitHub 仓库**：输入 `owner/repo`；
   - **局域网链接**：输入局域网 `.zip` 下载地址。
3. 确认权限完成安装后，在插件设置中可将 `Sign-in Method` 设为 `web` 使用原生弹窗单设备登录，或保持默认 `qr` 扫码登录。

## 本地与 CI 构建

- **Android 12+（Linux 本机）**：`bash mobile/android/build-android.sh`
- **iPadOS 17+（macOS / GitHub Actions）**：触发 `.github/workflows/mobile-ios.yml`（或 macOS 本机运行 `bash mobile/ios/build-ios.sh`）
- **桌面浏览器联调**：`cd mobile/web && bun run build && cd ../.. && go run ./mobile/dev`
