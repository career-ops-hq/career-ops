import AppKit
import WebKit

@MainActor
func presentJavaScriptAlert(_ message: String, in window: NSWindow?, completion: @escaping () -> Void) {
    guard let window, window.attachedSheet == nil else { completion(); return }
    let alert = NSAlert()
    alert.messageText = "Career Ops"
    alert.informativeText = message
    alert.addButton(withTitle: "OK")
    alert.beginSheetModal(for: window) { _ in completion() }
}

@MainActor
func presentJavaScriptConfirm(_ message: String, in window: NSWindow?, completion: @escaping (Bool) -> Void) {
    guard let window, window.attachedSheet == nil else { completion(false); return }
    let alert = NSAlert()
    alert.messageText = "Confirmação"
    alert.informativeText = message
    alert.addButton(withTitle: "Confirmar")
    alert.addButton(withTitle: "Cancelar").keyEquivalent = "\u{1b}"
    alert.beginSheetModal(for: window) { completion($0 == .alertFirstButtonReturn) }
}

@MainActor
func presentJavaScriptPrompt(_ prompt: String, defaultText: String?, in window: NSWindow?,
                             completion: @escaping (String?) -> Void) {
    guard let window, window.attachedSheet == nil else { completion(nil); return }
    let field = NSTextField(string: defaultText ?? "")
    field.frame.size = NSSize(width: 360, height: 24)
    let alert = NSAlert()
    alert.messageText = prompt
    alert.accessoryView = field
    alert.addButton(withTitle: "Confirmar")
    alert.addButton(withTitle: "Cancelar").keyEquivalent = "\u{1b}"
    alert.beginSheetModal(for: window) {
        completion($0 == .alertFirstButtonReturn ? field.stringValue : nil)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var server: Process?
    private var probe: Process?
    private var timer: Timer?
    private var readyTask: URLSessionDataTask?
    private var origin: URL?
    private var generation = UUID()
    private var closing = false
    private var quitting = false
    private var failureShown = false
    private var outputPipe: Pipe?
    private var log: FileHandle?
    private let outputQueue = DispatchQueue(label: "io.career-ops.local.output")
    private let preferences = UserDefaults.standard
    private let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Career Ops/server.log")

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let existing = NSRunningApplication.runningApplications(withBundleIdentifier: "io.career-ops.local")
            .first(where: { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }) {
            existing.activate(options: [.activateAllWindows])
            NSApp.terminate(nil)
            return
        }
        if let defaultsURL = Bundle.main.url(forResource: "Defaults", withExtension: "plist"),
           let defaults = NSDictionary(contentsOf: defaultsURL) as? [String: Any] {
            for (key, value) in defaults where preferences.object(forKey: key) == nil {
                preferences.set(value, forKey: key)
            }
        }
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Sair de Career Ops", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let editItem = NSMenuItem()
        menu.addItem(editItem)
        let editMenu = NSMenu(title: "Editar")
        for (title, action, key) in [("Copiar", "copy:", "c"), ("Colar", "paste:", "v"), ("Cortar", "cut:", "x"), ("Selecionar tudo", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        editItem.submenu = editMenu
        NSApp.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 800),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Career Ops"
        window.minSize = NSSize(width: 640, height: 480)
        window.center()
        window.isReleasedWhenClosed = false
        webView = WKWebView(frame: window.contentView!.bounds)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        start()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window?.makeKeyAndOrderFront(nil)
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if closing { return .terminateNow }
        quitting = true
        cancelStartup()
        probe?.terminate()
        guard let server, server.isRunning else { closing = true; return .terminateNow }
        // The wrapper owns Next and its five-second escalation; wait for that cleanup.
        server.terminate()
        DispatchQueue.global().async {
            server.waitUntilExit()
            DispatchQueue.main.async {
                self.closing = true
                NSApp.reply(toApplicationShouldTerminate: true)
            }
        }
        return .terminateLater
    }

    private func configuration() -> LaunchConfiguration {
        func path(_ key: String) -> URL { URL(fileURLWithPath: preferences.string(forKey: key) ?? "") }
        return LaunchConfiguration(checkout: path("CareerOpsCheckoutPath"), node: path("CareerOpsNodePath"),
                                   dataRoot: preferences.string(forKey: "CareerOpsDataRootPath").map { URL(fileURLWithPath: $0) })
    }

    private func start() {
        failureShown = false
        generation = UUID()
        let token = generation
        let config = configuration()
        if let error = validateConfiguration(config) { fail(error); return }
        let process = Process()
        let pipe = Pipe()
        probe = process
        process.executableURL = config.node
        process.arguments = ["--version"]
        process.environment = serverEnvironment(config, inherited: ProcessInfo.processInfo.environment)
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { process in
            let version = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            DispatchQueue.main.async {
                guard self.generation == token, !self.quitting, !self.failureShown else { return }
                self.timer?.invalidate()
                self.probe = nil
                if process.terminationStatus != 0 { self.fail("Não foi possível executar o Node. Escolha um executável válido.") }
                else if let error = validateConfiguration(config, nodeVersion: version) { self.fail(error) }
                else { self.launch(config, token: token) }
            }
        }
        do {
            try process.run()
            timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) { _ in
                guard self.generation == token else { return }
                process.terminate()
                self.fail("O Node não respondeu à verificação de versão. Escolha outro executável e tente novamente.")
            }
        } catch { fail("Não foi possível executar o Node: \(error.localizedDescription)") }
    }

    private func launch(_ config: LaunchConfiguration, token: UUID) {
        do {
            try FileManager.default.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            if !FileManager.default.fileExists(atPath: logURL.path) {
                guard FileManager.default.createFile(atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600]) else {
                    throw CocoaError(.fileWriteUnknown)
                }
            }
            log = try FileHandle(forWritingTo: logURL)
            try log?.seekToEnd()
            try log?.write(contentsOf: Data("\n--- Arranque \(Date()) ---\n".utf8))
        } catch { fail("Não foi possível abrir o registo local: \(error.localizedDescription)"); return }
        let process = Process()
        let pipe = Pipe()
        var parser = ServerURLParser()
        server = process
        outputPipe = pipe
        origin = nil
        process.executableURL = config.node
        process.arguments = [config.checkout.appendingPathComponent("web/server.mjs").path, "start", "-p", "0"]
        process.currentDirectoryURL = config.checkout.appendingPathComponent("web")
        process.environment = serverEnvironment(config, inherited: ProcessInfo.processInfo.environment)
        process.standardOutput = pipe
        process.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else { handle.readabilityHandler = nil; return }
            self.outputQueue.async {
                do { try self.log?.write(contentsOf: data) }
                catch { DispatchQueue.main.async { if self.generation == token { self.fail("Não foi possível guardar o registo do servidor: \(error.localizedDescription)") } } }
                if let url = parser.append(data) {
                    DispatchQueue.main.async {
                        guard self.generation == token, self.origin == nil, !self.failureShown, !self.quitting else { return }
                        self.origin = url
                        self.checkReady(url, token: token)
                    }
                }
            }
        }
        process.terminationHandler = { process in
            DispatchQueue.main.async {
                guard self.generation == token, !self.quitting, !self.failureShown else { return }
                self.fail("O servidor terminou inesperadamente (código \(process.terminationStatus)). Consulte o registo e tente novamente.")
            }
        }
        do {
            try process.run()
            timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { _ in
                guard self.generation == token else { return }
                self.fail("O servidor não respondeu em 30 segundos. Consulte o registo e tente novamente.")
            }
        } catch { fail("Não foi possível iniciar o servidor: \(error.localizedDescription)") }
    }

    private func checkReady(_ url: URL, token: UUID) {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 2)
        request.httpMethod = "GET"
        readyTask = URLSession.shared.dataTask(with: request) { _, response, _ in
            DispatchQueue.main.async {
                guard self.generation == token, !self.failureShown, !self.quitting, self.server?.isRunning == true else { return }
                if let http = response as? HTTPURLResponse, (200..<400).contains(http.statusCode),
                   navigationDisposition(http.url, origin: url) == .internalPage {
                    self.timer?.invalidate()
                    self.webView.load(URLRequest(url: url))
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.checkReadyIfActive(url, token: token) }
                }
            }
        }
        readyTask?.resume()
    }

    private func checkReadyIfActive(_ url: URL, token: UUID) {
        guard generation == token, !failureShown, !quitting else { return }
        checkReady(url, token: token)
    }

    private func cancelStartup() {
        timer?.invalidate()
        readyTask?.cancel()
    }

    private func fail(_ message: String) {
        guard !failureShown, !quitting else { return }
        failureShown = true
        cancelStartup()
        webView.stopLoading()
        if server?.isRunning == true { server?.terminate() }
        let alert = NSAlert()
        alert.messageText = "Não foi possível abrir Career Ops"
        alert.informativeText = message
        for title in ["Tentar novamente", "Escolher pasta", "Abrir registo", "Fechar"] { alert.addButton(withTitle: title) }
        alert.beginSheetModal(for: window) { response in
            switch response {
            case .alertFirstButtonReturn: self.retry()
            case .alertSecondButtonReturn: self.choosePath()
            case .alertThirdButtonReturn:
                NSWorkspace.shared.open(self.logURL)
                self.failureShown = false
                self.fail(message)
            default: NSApp.terminate(nil)
            }
        }
    }

    private func retry() {
        generation = UUID()
        let previous = server
        if previous?.isRunning == true { previous?.terminate() }
        DispatchQueue.global().async {
            if let previous, previous.processIdentifier > 0 { previous.waitUntilExit() }
            self.outputQueue.sync { try? self.log?.close(); self.log = nil }
            DispatchQueue.main.async {
                guard !self.quitting else { return }
                self.server = nil
                self.outputPipe?.fileHandleForReading.readabilityHandler = nil
                self.start()
            }
        }
    }

    private func choosePath() {
        let alert = NSAlert()
        alert.messageText = "Que caminho pretende corrigir?"
        for title in ["Pasta do projeto", "Executável Node", "Pasta de dados", "Cancelar"] { alert.addButton(withTitle: title) }
        alert.beginSheetModal(for: window) { response in
            let index = response.rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
            guard (0...2).contains(index) else { self.retry(); return }
            let panel = NSOpenPanel()
            panel.canChooseDirectories = index != 1
            panel.canChooseFiles = index == 1
            panel.allowsMultipleSelection = false
            panel.prompt = "Escolher"
            panel.beginSheetModal(for: self.window) { result in
                if result == .OK, let url = panel.url {
                    self.preferences.set(url.path, forKey: ["CareerOpsCheckoutPath", "CareerOpsNodePath", "CareerOpsDataRootPath"][index])
                }
                self.retry()
            }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let origin else { decisionHandler(.cancel); return }
        switch navigationDisposition(navigationAction.request.url, origin: origin,
                                     allowingBlobDownload: webView === self.webView && navigationAction.shouldPerformDownload) {
        case .internalPage: decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
        case .download: decisionHandler(.download)
        case .external:
            if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel)
        case .blocked: decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let origin, let url = navigationAction.request.url {
            switch navigationDisposition(url, origin: origin) {
            case .internalPage: webView.load(navigationAction.request)
            case .external: NSWorkspace.shared.open(url)
            case .download, .blocked: break
            }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        presentJavaScriptAlert(message, in: window, completion: completionHandler)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        presentJavaScriptConfirm(message, in: window, completion: completionHandler)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        presentJavaScriptPrompt(prompt, defaultText: defaultText, in: window, completion: completionHandler)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard let origin else { decisionHandler(.cancel); return }
        switch navigationDisposition(navigationResponse.response.url, origin: origin) {
        case .internalPage: decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
        case .external:
            if let url = navigationResponse.response.url { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel)
        case .download, .blocked: decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        chooseDownloadDestination(suggestedFilename, completionHandler: completionHandler)
    }

    private func chooseDownloadDestination(_ filename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.title = "Guardar ficheiro"
        panel.nameFieldStringValue = filename
        panel.beginSheetModal(for: window) { result in
            guard result == .OK, let chosen = panel.url else { completionHandler(nil); return }
            if let destination = availableDownloadDestination(chosen) { completionHandler(destination); return }
            let alert = NSAlert()
            alert.messageText = "O ficheiro já existe"
            alert.informativeText = "Career Ops não substitui ficheiros existentes. Escolha outro nome para guardar o download ou cancele."
            alert.addButton(withTitle: "Escolher outro nome")
            alert.addButton(withTitle: "Cancelar")
            alert.beginSheetModal(for: self.window) { response in
                if response == .alertFirstButtonReturn {
                    self.chooseDownloadDestination(chosen.lastPathComponent, completionHandler: completionHandler)
                } else { completionHandler(nil) }
            }
        }
    }

    func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void) {
        guard let origin else { decisionHandler(.cancel); return }
        switch navigationDisposition(request.url, origin: origin) {
        case .internalPage: decisionHandler(.allow)
        case .external:
            if let url = request.url { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel)
        case .download, .blocked: decisionHandler(.cancel)
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        let alert = NSAlert()
        alert.messageText = "Não foi possível guardar o ficheiro"
        alert.informativeText = error.localizedDescription
        alert.beginSheetModal(for: window)
    }
}

#if !CAREER_OPS_UI_TESTS
@main
struct CareerOpsApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) { app.run() }
    }
}
#endif
