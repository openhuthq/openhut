import Capacitor
import CryptoKit
import Foundation
import LocalAuthentication
import Security

class AppViewController: CAPBridgeViewController {
    // R6: Capacitor's own persisted serverBasePath is ignored on purpose; only the native updater picks the web root.
    override open func instanceDescriptor() -> InstanceDescriptor { InstanceDescriptor() }

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(DeviceKeyPlugin())
        bridge?.registerPluginInstance(LockedWebViewPlugin())
        view.backgroundColor = .white
        // Start from the last pack the native updater installed, else the built-in one.
        if let pack = PackUpdater.installed { setServerBasePath(path: pack.path) }
        Task { @MainActor in
            let line = await PackUpdater.poll()
            print("Pack update: \(line)")
            if line.hasPrefix("installed"), let pack = PackUpdater.installed { setServerBasePath(path: pack.path) }
            #if DEBUG
            let label = UILabel(frame: CGRect(x: 8, y: view.bounds.height - 120, width: view.bounds.width - 16, height: 80))
            label.numberOfLines = 0
            label.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
            label.backgroundColor = UIColor.black.withAlphaComponent(0.8)
            label.textColor = .white
            label.text = "Native shell updater (sequence \(PackUpdater.state?.sequence ?? -1)): \(line)"
            view.addSubview(label)
            #endif
        }
    }
}

@objc(DeviceKeyPlugin)
public class DeviceKeyPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DeviceKeyPlugin"
    public let jsName = "DeviceKey"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "publicKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "agree", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "wipe", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "confirm", returnType: CAPPluginReturnPromise)
    ]

    private let service = "dev.openhut.app.device-key"
    private let queue = DispatchQueue(label: "dev.openhut.app.device-key")
    private let unlockFor: TimeInterval = 300
    private var unlocked: (context: LAContext, at: Date)?

    @objc func publicKey(_ call: CAPPluginCall) {
        do {
            let key = try read(account: "public", context: nil) ?? create()
            call.resolve(["publicKey": hex(key)])
        } catch {
            call.reject("Couldn't make the device key: \(error.localizedDescription)")
        }
    }

    @objc func agree(_ call: CAPPluginCall) {
        guard let remote = call.getString("publicKey").flatMap(unhex), remote.count == 32 else {
            return call.reject("publicKey must be 64 lowercase hex characters.")
        }
        queue.async {
            do {
                guard let raw = try self.read(account: "private", context: try self.unlockedContext()) else {
                    return call.reject("There is no device key yet.")
                }
                let key = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: raw)
                let secret = try key.sharedSecretFromKeyAgreement(with: Curve25519.KeyAgreement.PublicKey(rawRepresentation: remote))
                call.resolve(["secret": self.hex(secret.withUnsafeBytes { Data($0) })])
            } catch let error as LAError where [.userCancel, .appCancel, .systemCancel].contains(error.code) {
                self.unlocked = nil
                call.reject("Unlock OpenHut with Face ID to reach your agents.", "canceled")
            } catch {
                self.unlocked = nil
                call.reject("Couldn't agree on a secret: \(error.localizedDescription)")
            }
        }
    }

    private func unlockedContext() throws -> LAContext {
        if let unlocked, Date().timeIntervalSince(unlocked.at) < unlockFor { return unlocked.context }
        let context = LAContext()
        context.touchIDAuthenticationAllowableReuseDuration = unlockFor
        let done = DispatchSemaphore(value: 0)
        var failure: Error?
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Unlock your OpenHut device key") { ok, error in
            if !ok { failure = error ?? NSError(domain: LAErrorDomain, code: LAError.authenticationFailed.rawValue) }
            done.signal()
        }
        done.wait()
        if let failure { throw failure }
        unlocked = (context, Date())
        return context
    }

    @objc func confirm(_ call: CAPPluginCall) {
        LAContext().evaluatePolicy(.deviceOwnerAuthentication, localizedReason: call.getString("reason") ?? "Confirm it's you") { ok, _ in
            if ok { call.resolve() } else { call.reject("Not confirmed.", "canceled") }
        }
    }

    @objc func wipe(_ call: CAPPluginCall) {
        queue.sync { unlocked = nil }
        SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrService: service] as CFDictionary)
        call.resolve()
    }

    private func create() throws -> Data {
        let key = Curve25519.KeyAgreement.PrivateKey()
        var failure: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, &failure) else {
            throw failure!.takeRetainedValue() as Error
        }
        try add(account: "private", data: key.rawRepresentation, protection: [kSecAttrAccessControl: access])
        try add(account: "public", data: key.publicKey.rawRepresentation, protection: [kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly])
        return key.publicKey.rawRepresentation
    }

    private func add(account: String, data: Data, protection: [CFString: Any]) throws {
        var query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account, kSecValueData: data]
        query.merge(protection) { $1 }
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw keychainError(status) }
    }

    private func read(account: String, context: LAContext?) throws -> Data? {
        var query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account, kSecReturnData: true]
        if let context { query[kSecUseAuthenticationContext] = context }
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw keychainError(status) }
        return item as? Data
    }

    private func keychainError(_ status: OSStatus) -> Error {
        NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: [NSLocalizedDescriptionKey: (SecCopyErrorMessageString(status, nil) as String?) ?? "Keychain error \(status)."])
    }

    private func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    private func unhex(_ text: String) -> Data? {
        guard text.count == 64, text.allSatisfy({ "0123456789abcdef".contains($0) }) else { return nil }
        var data = Data()
        var index = text.startIndex
        while index < text.endIndex {
            let next = text.index(index, offsetBy: 2)
            data.append(UInt8(text[index..<next], radix: 16)!)
            index = next
        }
        return data
    }
}
