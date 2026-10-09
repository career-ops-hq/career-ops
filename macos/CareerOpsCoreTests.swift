import Foundation
#if CAREER_OPS_UI_TESTS
import AppKit
import WebKit
#endif

@main
struct CareerOpsCoreTests {
    static func main() throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent("Career Ops tests \(UUID().uuidString)")
        try files.createDirectory(at: root.appendingPathComponent("web/.next"), withIntermediateDirectories: true)
        defer { try? files.removeItem(at: root) }
        try Data("build".utf8).write(to: root.appendingPathComponent("web/.next/BUILD_ID"))
        try Data().write(to: root.appendingPathComponent("web/server.mjs"))
        let node = root.appendingPathComponent("node with spaces")
        try Data().write(to: node)
        try files.setAttributes([.posixPermissions: 0o755], ofItemAtPath: node.path)
        let config = LaunchConfiguration(checkout: root, node: node, dataRoot: root)
        assert(validateConfiguration(config, nodeVersion: "v22.6.0") == nil)
        assert(validateConfiguration(config, nodeVersion: "v26.10.0\n") == nil)
        for version in ["v22.5.9", "v20.19.0", "v22.6.0-beta", "garbage"] {
            assert(validateConfiguration(config, nodeVersion: version) != nil, version)
        }
        try files.removeItem(at: root.appendingPathComponent("web/.next/BUILD_ID"))
        assert(validateConfiguration(config, nodeVersion: "v22.6.0") != nil)
        try Data("build".utf8).write(to: root.appendingPathComponent("web/.next/BUILD_ID"))
        assert(validateConfiguration(LaunchConfiguration(checkout: node, node: node, dataRoot: root), nodeVersion: "v22.6.0") != nil)
        assert(validateConfiguration(LaunchConfiguration(checkout: root, node: root, dataRoot: root), nodeVersion: "v22.6.0") != nil)
        assert(validateConfiguration(LaunchConfiguration(checkout: root, node: node, dataRoot: node), nodeVersion: "v22.6.0") != nil)
        assert(validateConfiguration(LaunchConfiguration(checkout: root, node: node, dataRoot: nil), nodeVersion: "v22.6.0") == nil)

        var parser = ServerURLParser()
        assert(parser.append(Data("\u{1b}[3".utf8)) == nil)
        assert(parser.append(Data("2m  - Local: http://127.0.0.1:54".utf8)) == nil)
        assert(parser.append(Data("321\u{1b}[0m\n".utf8))?.absoluteString == "http://127.0.0.1:54321")
        assert(parser.append(Data("Local: http://localhost:1234\n".utf8))?.port == 54321)
        for address in ["https://127.0.0.1:1234", "http://example.com:1234", "http://localhost:0", "http://localhost:65536", "http://localhost", "http://localhost:2evil", "http://user@localhost:1234", "http://127.0.0.1.evil:1234", "garbage"] {
            var invalid = ServerURLParser()
            assert(invalid.append(Data("Local: \(address)\n".utf8)) == nil, address)
        }
        for address in ["http://localhost:1", "http://127.0.0.1:65535"] {
            var valid = ServerURLParser()
            assert(valid.append(Data("Local: \(address)\r\n".utf8))?.absoluteString == address)
        }
        var noLocal = ServerURLParser()
        assert(noLocal.append(Data("Network: http://127.0.0.1:3427\n".utf8)) == nil)
        let origin = URL(string: "http://127.0.0.1:54321")!
        assert(navigationDisposition(URL(string: "http://127.0.0.1:54321/today?q=a#b"), origin: origin) == .internalPage)
        for address in ["http://127.0.0.1:54322/today", "http://localhost:54321", "https://127.0.0.1:54321", "https://career-ops.org", "mailto:test@example.com", "file:///tmp/example.pdf", "x-apple.systempreferences:com.apple.preference.general"] {
            assert(navigationDisposition(URL(string: address), origin: origin) == .external, address)
        }
        assert(navigationDisposition(nil, origin: origin) == .blocked)
        assert(navigationDisposition(URL(string: "/today"), origin: origin) == .blocked)
        assert(navigationDisposition(URL(string: "javascript:alert(1)"), origin: origin) == .blocked)
        let localBlob = URL(string: "blob:http://127.0.0.1:54321/conversation")!
        assert(navigationDisposition(localBlob, origin: origin) == .blocked)
        assert(navigationDisposition(localBlob, origin: origin, allowingBlobDownload: true) == .download)
        assert(navigationDisposition(URL(string: "blob:http://127.0.0.1:54322/conversation"), origin: origin,
                                     allowingBlobDownload: true) == .blocked)
        assert(navigationDisposition(URL(string: "http://127.0.0.1:54321/export"), origin: origin,
                                     allowingBlobDownload: true) == .internalPage)
        let env = serverEnvironment(config, inherited: ["CAREER_OPS_ROOT": "/wrong", "CAREER_OPS_DATA_DIR": "/wrong", "CAREER_OPS_CODE_ROOT": "/wrong", "CAREER_OPS_WEB_ALLOWED_HOSTS": "*", "PATH": "/bin"])
        assert(env["CAREER_OPS_ROOT"] == root.path)
        assert(env["CAREER_OPS_CODE_ROOT"] == root.path)
        assert(env["CAREER_OPS_DATA_DIR"] == nil && env["CAREER_OPS_WEB_ALLOWED_HOSTS"] == nil)
        assert(env["PATH"] == "\(root.path):/bin")
        let markerConfig = LaunchConfiguration(checkout: root, node: node, dataRoot: nil)
        let markerEnv = serverEnvironment(markerConfig, inherited: ["CAREER_OPS_ROOT": "/wrong", "CAREER_OPS_DATA_DIR": "/wrong", "CAREER_OPS_CODE_ROOT": "/wrong", "PATH": "/bin"])
        assert(markerEnv["CAREER_OPS_ROOT"] == nil, "An unset data root must leave marker resolution available")
        assert(markerEnv["CAREER_OPS_DATA_DIR"] == nil)
        assert(markerEnv["CAREER_OPS_CODE_ROOT"] == root.path)
        assert(markerEnv["PATH"] == "\(root.path):/bin")
        let finderPath = "/usr/bin:/bin:/usr/sbin:/sbin"
        let finderEnv = serverEnvironment(config, inherited: ["PATH": finderPath])
        assert(finderEnv["PATH"] == "\(root.path):/usr/bin:/bin:/usr/sbin:/sbin")
        let resolvedNode = finderEnv["PATH"]!.split(separator: ":").map {
            URL(fileURLWithPath: String($0)).appendingPathComponent(node.lastPathComponent)
        }.first { files.isExecutableFile(atPath: $0.path) }
        assert(resolvedNode == node)
        assert(serverEnvironment(config, inherited: [:])["PATH"] == "\(root.path):/usr/bin:/bin:/usr/sbin:/sbin")
        assert(serverEnvironment(config, inherited: ["PATH": ""])["PATH"] == "\(root.path):/usr/bin:/bin:/usr/sbin:/sbin")
        let destination = root.appendingPathComponent("download.pdf")
        assert(availableDownloadDestination(destination) == destination)
        try Data("keep this file".utf8).write(to: destination)
        assert(availableDownloadDestination(destination) == nil)
        let keptContents = try String(contentsOf: destination, encoding: .utf8)
        assert(keptContents == "keep this file")
        assert(availableDownloadDestination(root) == nil)
        assert(availableDownloadDestination(nil) == nil)
        assert(availableDownloadDestination(URL(string: "https://example.com/download.pdf")) == nil)
        let danglingLink = root.appendingPathComponent("dangling.pdf")
        try files.createSymbolicLink(atPath: danglingLink.path, withDestinationPath: root.appendingPathComponent("missing.pdf").path)
        assert(availableDownloadDestination(danglingLink) == nil)
#if CAREER_OPS_UI_TESTS
        testJavaScriptDialogs()
#endif
        print("CareerOpsCore: all assertions passed")
    }

#if CAREER_OPS_UI_TESTS
    @MainActor
    private static func testJavaScriptDialogs() {
        _ = NSApplication.shared
        let delegate = AppDelegate()
        for selector in [
            "webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:",
            "webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:",
            "webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:",
        ] {
            assert(delegate.responds(to: NSSelectorFromString(selector)), selector)
        }
        let host = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 320),
                            styleMask: [.titled], backing: .buffered, defer: false)

        var alertCalls = 0
        presentJavaScriptAlert("Mensagem", in: host) { alertCalls += 1 }
        finishSheet(on: host, with: .alertFirstButtonReturn)
        assert(alertCalls == 1)

        var confirmation: [Bool] = []
        presentJavaScriptConfirm("Confirmar?", in: host) { confirmation.append($0) }
        finishSheet(on: host, with: .alertSecondButtonReturn)
        assert(confirmation == [false])

        presentJavaScriptConfirm("Confirmar?", in: host) { confirmation.append($0) }
        finishSheet(on: host, with: .alertFirstButtonReturn)
        assert(confirmation == [false, true])

        var answer: [String?] = []
        presentJavaScriptPrompt("Nome", defaultText: "Inicial", in: host) { answer.append($0) }
        finishSheet(on: host, with: .alertFirstButtonReturn)
        assert(answer.count == 1 && answer[0] == "Inicial")

        var cancelledAnswer: [String?] = []
        presentJavaScriptPrompt("Nome", defaultText: nil, in: host) { cancelledAnswer.append($0) }
        finishSheet(on: host, with: .alertSecondButtonReturn)
        assert(cancelledAnswer.count == 1 && cancelledAnswer[0] == nil)

        var unavailableConfirmation: [Bool] = []
        presentJavaScriptConfirm("Confirmar?", in: nil) { unavailableConfirmation.append($0) }
        assert(unavailableConfirmation == [false])
    }

    @MainActor
    private static func finishSheet(on host: NSWindow, with response: NSApplication.ModalResponse) {
        guard let sheet = host.attachedSheet else { assertionFailure("Expected JavaScript dialog sheet"); return }
        host.endSheet(sheet, returnCode: response)
        let deadline = Date().addingTimeInterval(1)
        while host.attachedSheet != nil && RunLoop.current.run(mode: .default, before: deadline) && Date() < deadline {}
        assert(host.attachedSheet == nil)
    }
#endif
}
