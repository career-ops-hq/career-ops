import Foundation

struct LaunchConfiguration {
    let checkout: URL
    let node: URL
    let dataRoot: URL?
}

func validateConfiguration(_ config: LaunchConfiguration, nodeVersion: String? = nil) -> String? {
    let files = FileManager.default
    func isDirectory(_ url: URL) -> Bool {
        var directory: ObjCBool = false
        return url.isFileURL && files.fileExists(atPath: url.path, isDirectory: &directory) && directory.boolValue
    }
    guard isDirectory(config.checkout) else { return "A pasta do projeto não existe: \(config.checkout.path). Escolha a pasta Career Ops." }
    guard files.isReadableFile(atPath: config.checkout.appendingPathComponent("web/server.mjs").path) else {
        return "A pasta escolhida não contém web/server.mjs. Escolha a pasta Career Ops."
    }
    guard files.isReadableFile(atPath: config.checkout.appendingPathComponent("web/.next/BUILD_ID").path) else {
        return "Falta a compilação web em \(config.checkout.path)/web. Execute npm run build nessa pasta e tente novamente."
    }
    guard config.node.isFileURL, !isDirectory(config.node), files.isExecutableFile(atPath: config.node.path) else {
        return "O executável Node não existe ou não pode ser executado: \(config.node.path). Escolha o executável Node."
    }
    if let root = config.dataRoot, !isDirectory(root) || !files.isReadableFile(atPath: root.path) {
        return "A pasta de dados não existe ou não pode ser lida: \(root.path). Escolha a pasta de dados."
    }
    if let nodeVersion {
        let value = nodeVersion.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.range(of: #"^v?\d+\.\d+\.\d+$"#, options: .regularExpression) != nil else {
            return "Não foi possível confirmar a versão do Node. Escolha um executável Node 22.6.0 ou posterior."
        }
        let parts = value.drop(while: { $0 == "v" }).split(separator: ".").compactMap { Int($0) }
        guard parts.count == 3, !parts.lexicographicallyPrecedes([22, 6, 0]) else {
            return "O Node \(value) é demasiado antigo. É necessário Node 22.6.0 ou posterior."
        }
    }
    return nil
}

struct ServerURLParser {
    private var buffer = Data()
    private(set) var url: URL?

    mutating func append(_ chunk: Data) -> URL? {
        if let url { return url }
        buffer.append(chunk)
        while let newline = buffer.firstIndex(of: 10) {
            let line = String(decoding: buffer[..<newline], as: UTF8.self)
                .replacingOccurrences(of: #"\x1B\[[0-?]*[ -/]*[@-~]"#, with: "", options: .regularExpression)
            buffer.removeSubrange(...newline)
            guard let marker = line.range(of: "Local:") else { continue }
            let address = line[marker.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines)
            guard let components = URLComponents(string: address), components.scheme == "http",
                  ["localhost", "127.0.0.1"].contains(components.host ?? ""),
                  let port = components.port, (1...65535).contains(port),
                  components.user == nil, components.password == nil,
                  components.path.isEmpty || components.path == "/",
                  components.query == nil, components.fragment == nil,
                  let parsed = components.url else { continue }
            url = parsed
            return parsed
        }
        // ponytail: retain at most one 64 KiB line; increase only if Next emits longer startup lines.
        if buffer.count > 65536 { buffer.removeAll(keepingCapacity: true) }
        return nil
    }
}

enum NavigationDisposition { case internalPage, download, external, blocked }

func navigationDisposition(_ url: URL?, origin: URL,
                           allowingBlobDownload: Bool = false) -> NavigationDisposition {
    guard let url, let scheme = url.scheme?.lowercased() else { return .blocked }
    if scheme == "blob" {
        guard allowingBlobDownload,
              let embedded = URL(string: String(url.absoluteString.dropFirst("blob:".count))),
              embedded.user == nil, embedded.password == nil,
              embedded.scheme == origin.scheme, embedded.host == origin.host, embedded.port == origin.port else {
            return .blocked
        }
        return .download
    }
    guard !["javascript", "data", "about"].contains(scheme) else { return .blocked }
    if ["http", "https"].contains(scheme), url.host == nil { return .blocked }
    if url.user == nil, url.password == nil, scheme == origin.scheme,
       url.host == origin.host, url.port == origin.port { return .internalPage }
    return .external
}

func serverEnvironment(_ config: LaunchConfiguration, inherited: [String: String]) -> [String: String] {
    var environment = inherited
    for key in ["CAREER_OPS_WEB_ALLOWED_HOSTS", "CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR", "CAREER_OPS_CODE_ROOT"] {
        environment.removeValue(forKey: key)
    }
    if let dataRoot = config.dataRoot { environment["CAREER_OPS_ROOT"] = dataRoot.path }
    environment["CAREER_OPS_CODE_ROOT"] = config.checkout.path
    let path = inherited["PATH"].flatMap { $0.isEmpty ? nil : $0 } ?? "/usr/bin:/bin:/usr/sbin:/sbin"
    environment["PATH"] = "\(config.node.deletingLastPathComponent().path):\(path)"
    return environment
}

func availableDownloadDestination(_ proposed: URL?) -> URL? {
    guard let proposed, proposed.isFileURL,
          !FileManager.default.fileExists(atPath: proposed.path),
          (try? FileManager.default.destinationOfSymbolicLink(atPath: proposed.path)) == nil else { return nil }
    return proposed
}
