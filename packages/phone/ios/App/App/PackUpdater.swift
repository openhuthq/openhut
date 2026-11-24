import Capacitor
import CryptoKit
import Foundation

// Replaces Capacitor's WebView plugin, whose setServerBasePath and persistServerBasePath let JavaScript pick the served folder. Only
// PackUpdater picks it, so every call is refused.
@objc(LockedWebViewPlugin)
public class LockedWebViewPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LockedWebViewPlugin"
    public let jsName = "WebView"
    public let pluginMethods: [CAPPluginMethod] = ["setServerAssetPath", "setServerBasePath", "getServerBasePath", "persistServerBasePath"]
        .map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    @objc func setServerAssetPath(_ call: CAPPluginCall) { refuse(call) }
    @objc func setServerBasePath(_ call: CAPPluginCall) { refuse(call) }
    @objc func getServerBasePath(_ call: CAPPluginCall) { refuse(call) }
    @objc func persistServerBasePath(_ call: CAPPluginCall) { refuse(call) }
    private func refuse(_ call: CAPPluginCall) { call.reject("only the native pack updater picks the web root") }
}

// R6: the phone's pack updater lives here, in the native shell, never in the app pack it installs. It polls the R4 feed
// (channels/<channel>/release.json + .sig + .rekor, packs/<sha512 hex>), checks the release key's Ed25519 signature, the Rekor entry
// (SET, checkpoint, inclusion proof, that it logged exactly this release) and the SEC6 hour, as verifyRelease and pointerAction in
// packages/desktop/src/release-key.mjs do, then installs release.packs.app's renderer/ as the web root. No plugin exposes any of it to
// JavaScript and its state is a file outside every plugin's reach, so a pack can't switch the check off for the updates after it.
enum PackUpdater {
    static let shellApi = 1
    static let minAge: TimeInterval = 3600
    // The same keys as release-key.mjs: RELEASE_KEY and rekor.sigstore.dev's log key.
    static let releaseKey = "MCowBQYDK2VwAyEAQbo1L199M6phAczpCAlP6iQc0+AMcbpjrnqH1XvCUyk="
    static let rekorKey = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE2G2Y+2tabdTV5BcGiBIx0a9fAFwrkBbmLSGtks4L3qX6yYY0zufBnhC8Ur/iy55GhWP/9A/bY2LhC30M9+RYtw=="
    static let feed = "https://dl.openhut.dev"
    static let channel = "stable"

    struct Settings { var feed: URL; var channel: String; var releaseKey: Data; var rekorKey: Data }

    // Debug builds take a test feed and test keys from the launch environment (xcrun simctl launch, SIMCTL_CHILD_OPENHUT_*). A pack
    // can't set either; release builds ignore them.
    static var settings: Settings {
        var env: [String: String] = [:]
        #if DEBUG
        env = ProcessInfo.processInfo.environment
        #endif
        return Settings(feed: URL(string: env["OPENHUT_FEED"] ?? feed)!, channel: env["OPENHUT_CHANNEL"] ?? channel,
                        releaseKey: Data(base64Encoded: env["OPENHUT_RELEASE_KEY"] ?? releaseKey)!,
                        rekorKey: Data(base64Encoded: env["OPENHUT_REKOR_KEY"] ?? rekorKey)!)
    }

    static let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("openhut-packs")
    static var stateFile: URL { root.appendingPathComponent("state.json") }

    struct State: Codable { var sequence: Int; var path: String; var version: String }
    static var state: State? { (try? Data(contentsOf: stateFile)).flatMap { try? JSONDecoder().decode(State.self, from: $0) } }

    // The installed pack's web root, if one is installed and still on disk.
    static var installed: URL? {
        guard let state, FileManager.default.fileExists(atPath: root.appendingPathComponent(state.path).appendingPathComponent("index.html").path) else { return nil }
        return root.appendingPathComponent(state.path)
    }

    enum Action: Equatable { case refuse(String), none, halt, wait(Date), install(sequence: Int, version: String, sha512: String) }

    // pointerAction() from release-key.mjs.
    static func action(manifest: Data, signature: String, rekor: Data, installed: Int, settings: Settings, now: Date = Date()) -> Action {
        let check = verifyRelease(manifest: manifest, signature: signature, rekor: rekor, key: settings.releaseKey, rekorKey: settings.rekorKey, now: now)
        if case .failure(let reason, nil) = check { return .refuse(reason) }
        guard let release = try? JSONSerialization.jsonObject(with: manifest) as? [String: Any],
              let sequence = release["sequence"] as? Int, let channel = release["channel"] as? String else { return .refuse("malformed release") }
        if channel != settings.channel { return .refuse("a \(channel) release on the \(settings.channel) channel") }
        if sequence <= installed { return .none }
        if release["halt"] as? Bool == true { return .halt }
        let api = release["shellApi"] as? [String: Int]
        guard let min = api?["min"], let max = api?["max"], min <= shellApi, shellApi <= max else { return .refuse("needs another shell") }
        if case .failure(_, let retryAt?) = check { return .wait(retryAt) }
        guard let app = (release["packs"] as? [String: Any])?["app"] as? [String: Any], let sha512 = app["sha512"] as? String else { return .refuse("no app pack") }
        return .install(sequence: sequence, version: release["version"] as? String ?? "", sha512: sha512)
    }

    enum Check { case ok, failure(String, Date?) }

    // verifyRelease() from release-key.mjs: signed by the release key, logged in Rekor as exactly this release, and an hour old.
    static func verifyRelease(manifest: Data, signature: String, rekor: Data, key: Data, rekorKey: Data, now: Date) -> Check {
        let ed25519Prefix = Data([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00])
        guard key.count == 44, key.prefix(12) == ed25519Prefix, let releaseKey = try? Curve25519.Signing.PublicKey(rawRepresentation: key.suffix(32)),
              let sig = Data(base64Encoded: signature.trimmingCharacters(in: .whitespacesAndNewlines)),
              releaseKey.isValidSignature(sig, for: manifest) else { return .failure("not signed by the release key", nil) }
        guard let entries = try? JSONSerialization.jsonObject(with: rekor) as? [String: Any], let entry = entries.values.first as? [String: Any] else {
            return .failure("no Rekor entry", nil)
        }
        guard let integratedTime = rekorIncluded(entry, rekorKey: rekorKey) else { return .failure("the Rekor entry has no valid timestamp or inclusion proof", nil) }
        guard let body = (entry["body"] as? String).flatMap({ Data(base64Encoded: $0) }),
              let logged = try? JSONSerialization.jsonObject(with: body) as? [String: Any], logged["kind"] as? String == "rekord",
              let spec = logged["spec"] as? [String: Any], let hash = (spec["data"] as? [String: Any])?["hash"] as? [String: Any],
              let signed = spec["signature"] as? [String: Any], let pem = ((signed["publicKey"] as? [String: Any])?["content"] as? String).flatMap({ Data(base64Encoded: $0) }),
              hash["algorithm"] as? String == "sha256", hash["value"] as? String == hex(SHA256.hash(data: manifest)),
              (signed["content"] as? String).flatMap({ Data(base64Encoded: $0) }) == sig,
              Data(base64Encoded: String(decoding: pem, as: UTF8.self).split(separator: "\n").filter { !$0.hasPrefix("-----") }.joined()) == key
        else { return .failure("the Rekor entry is for another release", nil) }
        let retryAt = Date(timeIntervalSince1970: TimeInterval(integratedTime) + minAge)
        return now >= retryAt ? .ok : .failure("logged less than an hour ago", retryAt)
    }

    // rekorIncluded() from release-key.mjs: integratedTime when Rekor signed both the SET and a checkpoint whose tree holds the entry.
    static func rekorIncluded(_ entry: [String: Any], rekorKey: Data) -> Int? {
        guard let key = try? P256.Signing.PublicKey(derRepresentation: rekorKey),
              let body = entry["body"] as? String, let integratedTime = entry["integratedTime"] as? Int,
              let logID = entry["logID"] as? String, let logIndex = entry["logIndex"] as? Int,
              let verification = entry["verification"] as? [String: Any], let set = (verification["signedEntryTimestamp"] as? String).flatMap({ Data(base64Encoded: $0) }),
              let proof = verification["inclusionProof"] as? [String: Any], let checkpoint = proof["checkpoint"] as? String,
              let treeSize = proof["treeSize"] as? Int, let rootHash = proof["rootHash"] as? String, let index = proof["logIndex"] as? Int,
              let hashes = proof["hashes"] as? [String] else { return nil }
        // JSON.stringify({ body, integratedTime, logID, logIndex }); body and logID are base64 and hex, so nothing needs escaping.
        let canonical = "{\"body\":\"\(body)\",\"integratedTime\":\(integratedTime),\"logID\":\"\(logID)\",\"logIndex\":\(logIndex)}"
        guard let setSignature = try? P256.Signing.ECDSASignature(derRepresentation: set), key.isValidSignature(setSignature, for: Data(canonical.utf8)) else { return nil }
        let parts = checkpoint.components(separatedBy: "\n\n")
        guard parts.count >= 2 else { return nil }
        let note = parts[0], lines = note.components(separatedBy: "\n")
        guard lines.count >= 3, lines[1] == String(treeSize), let root = Data(base64Encoded: lines[2]), hex(root) == rootHash else { return nil }
        let signedNote = parts[1].components(separatedBy: "\n").contains { line in
            guard line.hasPrefix("— "), let raw = line.split(separator: " ").last.flatMap({ Data(base64Encoded: String($0)) }), raw.count > 4,
                  let signature = try? P256.Signing.ECDSASignature(derRepresentation: raw.dropFirst(4)) else { return false }
            return key.isValidSignature(signature, for: Data("\(note)\n".utf8))
        }
        guard signedNote, let leafBody = Data(base64Encoded: body) else { return nil }
        let leaf = Data(SHA256.hash(data: Data([0]) + leafBody))
        return rootFrom(index: index, size: treeSize, leaf: leaf, hashes: hashes).map(hex) == rootHash ? integratedTime : nil
    }

    // RFC 9162 §2.1.3.2, as rootFrom() in release-key.mjs.
    static func rootFrom(index: Int, size: Int, leaf: Data, hashes: [String]) -> Data? {
        guard index >= 0, size > 0 else { return nil }
        var fn = UInt64(index), sn = UInt64(size) - 1
        if fn > sn { return nil }
        var r = leaf
        for h in hashes {
            guard let p = unhex(h) else { return nil }
            if sn == 0 { return nil }
            if fn & 1 == 1 || fn == sn {
                r = Data(SHA256.hash(data: Data([1]) + p + r))
                while fn & 1 == 0 && fn != 0 { fn >>= 1; sn >>= 1 }
            } else {
                r = Data(SHA256.hash(data: Data([1]) + r + p))
            }
            fn >>= 1; sn >>= 1
        }
        return sn == 0 ? r : nil
    }

    // One poll: fetch the channel pointer, decide, and install the app pack when the decision is install. Returns a line for the log.
    static func poll() async -> String {
        let settings = settings
        let channel = settings.feed.appendingPathComponent("channels/\(settings.channel)/release.json")
        do {
            let manifest = try await fetch(channel)
            let signature = String(decoding: try await fetch(URL(string: channel.absoluteString + ".sig")!), as: UTF8.self)
            let rekor = (try? await fetch(URL(string: channel.absoluteString + ".rekor")!)) ?? Data()
            switch action(manifest: manifest, signature: signature, rekor: rekor, installed: state?.sequence ?? -1, settings: settings) {
            case .refuse(let reason): return "refused: \(reason)"
            case .none: return "up to date (sequence \(state?.sequence ?? -1))"
            case .halt: return "halted"
            case .wait(let at): return "refused for now: logged less than an hour ago, retry after \(ISO8601DateFormatter().string(from: at))"
            case .install(let sequence, let version, let sha512):
                guard let digest = Data(base64Encoded: sha512) else { return "refused: bad pack hash" }
                let pack = try await fetch(settings.feed.appendingPathComponent("packs/\(hex(digest))"))
                guard Data(SHA512.hash(data: pack)) == digest else { return "refused: the app pack doesn't match release.json" }
                let dir = "\(sequence)"
                try? FileManager.default.removeItem(at: root.appendingPathComponent(dir))
                try untar(gunzip(pack), only: "renderer/", into: root.appendingPathComponent(dir))
                let data = try JSONEncoder().encode(State(sequence: sequence, path: dir, version: version))
                try data.write(to: stateFile, options: .atomic)
                return "installed \(version) (sequence \(sequence))"
            }
        } catch {
            return "refused: \(error.localizedDescription)"
        }
    }

    static func fetch(_ url: URL) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        return data
    }

    // A gzip member: skip the header (RFC 1952) and the 8-byte trailer, inflate the raw deflate stream between.
    static func gunzip(_ data: Data) throws -> Data {
        let bytes = [UInt8](data)
        guard bytes.count > 18, bytes[0] == 0x1f, bytes[1] == 0x8b, bytes[2] == 8 else { throw URLError(.cannotDecodeContentData) }
        let flags = bytes[3]
        var at = 10
        if flags & 4 != 0 { at += 2 + Int(bytes[at]) + Int(bytes[at + 1]) << 8 }
        if flags & 8 != 0 { while bytes[at] != 0 { at += 1 }; at += 1 }
        if flags & 16 != 0 { while bytes[at] != 0 { at += 1 }; at += 1 }
        if flags & 2 != 0 { at += 2 }
        return try (Data(bytes[at..<(bytes.count - 8)]) as NSData).decompressed(using: .zlib) as Data
    }

    // The files under `prefix` in a ustar/PAX archive (as scripts/pack.ts writes), written below `into` without the prefix.
    static func untar(_ tar: Data, only prefix: String, into: URL) throws {
        let bytes = [UInt8](tar)
        var at = 0, longName: String?
        let field = { (from: Int, length: Int) in String(decoding: bytes[from..<(from + length)].prefix { $0 != 0 }, as: UTF8.self) }
        while at + 512 <= bytes.count, bytes[at] != 0 {
            let size = Int(field(at + 124, 12).trimmingCharacters(in: .whitespaces), radix: 8) ?? 0
            let type = bytes[at + 156], start = at + 512
            guard start + size <= bytes.count else { throw URLError(.cannotDecodeContentData) }
            let name = longName ?? field(at, 100)
            longName = nil
            if type == UInt8(ascii: "x") {
                for record in String(decoding: bytes[start..<(start + size)], as: UTF8.self).split(separator: "\n") where record.contains(" path=") {
                    longName = String(record.split(separator: "=", maxSplits: 1)[1])
                }
            } else if type == UInt8(ascii: "0") || type == 0, name.hasPrefix(prefix) {
                let path = String(name.dropFirst(prefix.count))
                guard !path.split(separator: "/").contains("..") else { throw URLError(.cannotDecodeContentData) }
                let file = into.appendingPathComponent(path)
                try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
                try Data(bytes[start..<(start + size)]).write(to: file)
            }
            at = start + (size + 511) / 512 * 512
        }
    }

    static func hex<D: Sequence>(_ bytes: D) -> String where D.Element == UInt8 { bytes.map { String(format: "%02x", $0) }.joined() }
    static func unhex(_ text: String) -> Data? {
        var data = Data(), chars = Array(text)
        guard chars.count % 2 == 0 else { return nil }
        for i in stride(from: 0, to: chars.count, by: 2) { guard let b = UInt8(String(chars[i...i + 1]), radix: 16) else { return nil }; data.append(b) }
        return data
    }
}
