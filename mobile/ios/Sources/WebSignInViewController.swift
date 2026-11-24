import UIKit
import WebKit

final class WebSignInViewController: UIViewController, WKNavigationDelegate {
    private let requestId: String
    private let titleText: String
    private let signInUrl: String
    private let cookiesOf: String
    private let untilCookies: [String]
    private let userAgent: String
    private let onDone: (String, String) -> Void

    private var webView: WKWebView!
    private var pollTimer: Timer?
    private var completed = false

    init(
        requestId: String,
        title: String,
        signInUrl: String,
        cookiesOf: String,
        untilCookies: [String],
        userAgent: String,
        onDone: @escaping (String, String) -> Void
    ) {
        self.requestId = requestId
        self.titleText = title
        self.signInUrl = signInUrl
        self.cookiesOf = cookiesOf
        self.untilCookies = untilCookies
        self.userAgent = userAgent
        self.onDone = onDone
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.06, green: 0.06, blue: 0.08, alpha: 1.0)
        navigationItem.title = titleText.isEmpty ? "Sign In" : titleText
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .close,
            target: self,
            action: #selector(handleCancel)
        )

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        webView = WKWebView(frame: .zero, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        if !userAgent.isEmpty {
            webView.customUserAgent = userAgent
        }

        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        if let url = URL(string: signInUrl) {
            webView.load(URLRequest(url: url))
        }

        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.8, repeats: true) { [weak self] _ in
            self?.checkCookies()
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if isBeingDismissed && !completed {
            finish(cookie: "", error: "sign-in cancelled")
        }
    }

    @objc private func handleCancel() {
        finish(cookie: "", error: "sign-in cancelled")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        checkCookies()
    }

    private func checkCookies() {
        guard !completed, !untilCookies.isEmpty, let targetUrl = URL(string: cookiesOf),
              let targetHost = targetUrl.host?.lowercased() else { return }

        webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            guard let self, !self.completed else { return }
            let matched = cookies.filter { cookie in
                let domain = cookie.domain.lowercased()
                if domain.hasPrefix(".") {
                    return targetHost == String(domain.dropFirst()) || targetHost.hasSuffix(domain)
                }
                return targetHost == domain
            }
            let names = Set(matched.map { $0.name })
            if self.untilCookies.allSatisfy({ names.contains($0) }) {
                let header = matched.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
                DispatchQueue.main.async {
                    self.finish(cookie: header, error: "")
                }
            }
        }
    }

    private func finish(cookie: String, error: String) {
        guard !completed else { return }
        completed = true
        pollTimer?.invalidate()
        pollTimer = nil
        onDone(cookie, error)
        if presentingViewController != nil {
            dismiss(animated: true)
        }
    }
}
