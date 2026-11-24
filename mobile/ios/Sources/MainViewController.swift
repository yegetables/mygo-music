import UIKit
import WebKit

final class MainViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    private var webView: WKWebView!
    private var pageReady = false
    private var pendingOpenedZip: String?

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .lightContent
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.06, green: 0.06, blue: 0.08, alpha: 1.0)

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "mygo")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        webView.scrollView.backgroundColor = view.backgroundColor
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        AudioEngine.shared.onEvent = { [weak self] name, payload in
            self?.sendEventToWeb(name: name, payload: payload)
        }

        startGoCore()
    }

    private func startGoCore() {
        let fm = FileManager.default
        let docsDir = fm.urls(for: .documentDirectory, in: .userDomainMask).first!
        let cachesDir = fm.urls(for: .cachesDirectory, in: .userDomainMask).first!
        let lang = Locale.preferredLanguages.joined(separator: ",")

        DispatchQueue.global(qos: .userInitiated).async {
            let info = CoreBridge.shared.start(
                dataDir: docsDir.path,
                cacheDir: cachesDir.path,
                lang: lang
            )
            DispatchQueue.main.async {
                if let err = info.error, !err.isEmpty {
                    self.showAlert(title: "MyGo Music", message: "Core start failed: \(err)")
                    return
                }
                guard let port = info.port, let token = info.token,
                      let url = URL(string: "http://127.0.0.1:\(port)/?token=\(token)&platform=ios") else {
                    return
                }
                self.webView.load(URLRequest(url: url))
            }
        }
    }

    func handleOpenedPluginZip(url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer {
            if scoped { url.stopAccessingSecurityScopedResource() }
        }
        let fm = FileManager.default
        let dest = fm.temporaryDirectory.appendingPathComponent("opened-\(Int(Date().timeIntervalSince1970)).zip")
        try? fm.removeItem(at: dest)
        do {
            try fm.copyItem(at: url, to: dest)
            if pageReady {
                sendEventToWeb(name: "pluginZipOpened", payload: ["path": dest.path])
            } else {
                pendingOpenedZip = dest.path
            }
        } catch {
            NSLog("Failed to copy opened zip: %@", error.localizedDescription)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        if let path = pendingOpenedZip {
            pendingOpenedZip = nil
            sendEventToWeb(name: "pluginZipOpened", payload: ["path": path])
        }
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if let url = navigationAction.request.url,
           let host = url.host,
           host != "127.0.0.1", host != "localhost",
           navigationAction.navigationType == .linkActivated {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }
        let payload = (body["payload"] as? [String: Any]) ?? [:]

        switch action {
        case "playerLoad":
            AudioEngine.shared.load(
                urlString: payload["url"] as? String ?? "",
                title: payload["title"] as? String ?? "",
                artist: payload["artist"] as? String ?? "",
                album: payload["album"] as? String ?? "",
                artworkUrl: payload["artworkUrl"] as? String ?? "",
                durationMs: (payload["durationMs"] as? NSNumber)?.doubleValue ?? 0,
                autoplay: (payload["autoplay"] as? Bool) ?? true
            )
        case "playerPlay":
            AudioEngine.shared.play()
        case "playerPause":
            AudioEngine.shared.pause()
        case "playerSeek":
            let ms = (payload["positionMs"] as? NSNumber)?.int64Value ?? 0
            AudioEngine.shared.seek(positionMs: ms)
        case "openExternal":
            if let raw = payload["url"] as? String, let url = URL(string: raw) {
                UIApplication.shared.open(url)
            }
        case "saveImage":
            if let raw = payload["url"] as? String, let url = URL(string: raw) {
                saveImageToPhotos(url: url)
            }
        case "openWebSignIn":
            let id = payload["id"] as? String ?? ""
            let name = payload["name"] as? String ?? "Sign In"
            let url = payload["url"] as? String ?? ""
            let cookiesOf = payload["cookiesOf"] as? String ?? ""
            let until = payload["until"] as? [String] ?? []
            let ua = payload["userAgent"] as? String ?? ""

            let vc = WebSignInViewController(
                requestId: id,
                title: name,
                signInUrl: url,
                cookiesOf: cookiesOf,
                untilCookies: until,
                userAgent: ua
            ) { cookie, err in
                DispatchQueue.global(qos: .userInitiated).async {
                    CoreBridge.shared.completeWebSignIn(id: id, cookie: cookie, error: err)
                }
            }
            let nav = UINavigationController(rootViewController: vc)
            nav.modalPresentationStyle = .pageSheet
            present(nav, animated: true)
        default:
            break
        }
    }

    private func saveImageToPhotos(url: URL) {
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data, let image = UIImage(data: data) else { return }
            DispatchQueue.main.async {
                UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
                self?.showAlert(title: "MyGo Music", message: "已保存二维码到相册")
            }
        }.resume()
    }

    private func sendEventToWeb(name: String, payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8),
              let nameData = try? JSONSerialization.data(withJSONObject: name),
              let nameJson = String(data: nameData, encoding: .utf8) else { return }
        let js = "window.__mygoNativeEvent && window.__mygoNativeEvent(\(nameJson), \(json));"
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func showAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "确定", style: .default))
        present(alert, animated: true)
    }
}
