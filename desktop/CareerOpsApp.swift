import Cocoa
import WebKit

private let dashboardURL = URL(string: "http://127.0.0.1:3111/watch")!
private let healthURL = URL(string: "http://127.0.0.1:3111/api/health")!
private let serviceLabel = "com.careerops.dashboard"

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var retryTimer: Timer?
    private var attempts = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.applicationIconImage = makeIcon()
        installMenu()
        createWindow()
        showLoading(message: "Startar din karriärmotor …")
        kickDashboardService(forceRestart: false)
        waitForDashboard()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow()
        return true
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        showWindow()
    }

    private func installMenu() {
        let menu = NSMenu()
        let applicationItem = NSMenuItem()
        menu.addItem(applicationItem)
        let applicationMenu = NSMenu()
        applicationMenu.addItem(withTitle: "Om Career-Ops", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        applicationMenu.addItem(.separator())
        applicationMenu.addItem(withTitle: "Avsluta Career-Ops", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        applicationItem.submenu = applicationMenu
        NSApp.mainMenu = menu
    }

    private func createWindow() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Career-Ops"
        window.titlebarAppearsTransparent = true
        window.minSize = NSSize(width: 980, height: 640)
        window.sharingType = .readOnly
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.contentView = webView
        window.center()
        showWindow()
    }

    private func showWindow() {
        guard let window else { return }
        window.deminiaturize(nil)
        window.makeKeyAndOrderFront(nil)
        window.orderFrontRegardless()
        NSApp.activate(ignoringOtherApps: true)
    }

    private func kickDashboardService(forceRestart: Bool) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        let target = "gui/\(getuid())/\(serviceLabel)"
        process.arguments = forceRestart ? ["kickstart", "-k", target] : ["kickstart", target]
        try? process.run()
    }

    private func waitForDashboard() {
        retryTimer?.invalidate()
        attempts = 0
        probeDashboard()
    }

    private func probeDashboard() {
        attempts += 1
        var request = URLRequest(url: healthURL)
        request.timeoutInterval = 2
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                    self.retryTimer?.invalidate()
                    var dashboardRequest = URLRequest(
                        url: dashboardURL,
                        cachePolicy: .reloadIgnoringLocalCacheData,
                        timeoutInterval: 15
                    )
                    dashboardRequest.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
                    self.webView.load(dashboardRequest)
                } else if self.attempts < 45 {
                    if self.attempts == 5 {
                        self.kickDashboardService(forceRestart: true)
                    }
                    self.scheduleProbe(after: 1.0)
                } else {
                    self.showLoading(message: "Dashboarden kunde inte startas. Kontrollera Career-Ops tjänstestatus och försök igen.", showRetry: true)
                    self.scheduleProbe(after: 10.0)
                }
            }
        }.resume()
    }

    private func scheduleProbe(after delay: TimeInterval) {
        retryTimer?.invalidate()
        retryTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            self?.probeDashboard()
        }
    }

    private func recoverDashboard() {
        showLoading(message: "Återansluter till din karriärmotor …")
        kickDashboardService(forceRestart: false)
        waitForDashboard()
    }

    private func showLoading(message: String, showRetry: Bool = false) {
        let retry = showRetry ? "<p><a href='careerops://retry'>Försök igen</a></p>" : ""
        let html = """
        <!doctype html><html lang='sv'><meta charset='utf-8'><style>
        :root{color-scheme:dark}body{margin:0;background:#080b10;color:#f4f7fb;font:16px -apple-system,BlinkMacSystemFont,sans-serif;display:grid;place-items:center;height:100vh}.card{width:min(560px,80vw);padding:48px;border:1px solid #253040;border-radius:24px;background:linear-gradient(145deg,#111824,#0b1018);box-shadow:0 30px 90px #0008}.mark{width:54px;height:54px;border-radius:16px;background:linear-gradient(145deg,#58d6b0,#2f7bf4);display:grid;place-items:center;font-size:28px;font-weight:800;color:#07100e}h1{font-size:28px;margin:24px 0 10px}p{color:#aebaca;line-height:1.55}a{color:#6ee7bd;text-decoration:none;font-weight:700}
        </style><body><main class='card'><div class='mark'>C</div><h1>Career-Ops</h1><p>\(message)</p>\(retry)</main></body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if url.scheme == "careerops" {
            kickDashboardService(forceRestart: true)
            showLoading(message: "Startar om din karriärmotor …")
            waitForDashboard()
            decisionHandler(.cancel)
            return
        }
        if let host = url.host, host != "127.0.0.1" && host != "localhost" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView.url?.path == dashboardURL.path else { return }
        retryTimer?.invalidate()
        attempts = 0
        captureVerificationSnapshotIfRequested()
    }

    private func captureVerificationSnapshotIfRequested() {
        guard let path = ProcessInfo.processInfo.environment["CAREER_OPS_VERIFY_SNAPSHOT"], !path.isEmpty else {
            return
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
            self?.webView.takeSnapshot(with: nil) { image, error in
                guard error == nil,
                      let image,
                      let tiffData = image.tiffRepresentation,
                      let bitmap = NSBitmapImageRep(data: tiffData),
                      let pngData = bitmap.representation(using: .png, properties: [:]) else {
                    return
                }
                try? pngData.write(to: URL(fileURLWithPath: path), options: .atomic)
            }
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        recoverDashboard()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        recoverDashboard()
    }

    private func makeIcon() -> NSImage {
        let image = NSImage(size: NSSize(width: 512, height: 512))
        image.lockFocus()
        let bounds = NSRect(x: 24, y: 24, width: 464, height: 464)
        NSGradient(colors: [NSColor(calibratedRed: 0.12, green: 0.84, blue: 0.66, alpha: 1), NSColor(calibratedRed: 0.19, green: 0.43, blue: 0.95, alpha: 1)])?.draw(in: NSBezierPath(roundedRect: bounds, xRadius: 112, yRadius: 112), angle: -35)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 270, weight: .black),
            .foregroundColor: NSColor.white,
        ]
        let text = NSString(string: "C")
        let size = text.size(withAttributes: attributes)
        text.draw(at: NSPoint(x: 256 - size.width / 2, y: 242 - size.height / 2), withAttributes: attributes)
        image.unlockFocus()
        return image
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.run()
