import Capacitor
import CryptoKit
import Foundation
import LocalAuthentication
import Security

class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(DeviceKeyPlugin())
    }
}

@objc(DeviceKeyPlugin)
public class DeviceKeyPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DeviceKeyPlugin"
    public let jsName = "DeviceKey"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "publicKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "agree", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "wipe", returnType: CAPPluginReturnPromise)
    ]

    private let service = "dev.openhut.app.device-key"

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
        do {
            let context = LAContext()
            context.localizedReason = "Unlock your OpenHut device key"
            guard let raw = try read(account: "private", context: context) else {
                return call.reject("There is no device key yet.")
            }
            let key = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: raw)
            let secret = try key.sharedSecretFromKeyAgreement(with: Curve25519.KeyAgreement.PublicKey(rawRepresentation: remote))
            call.resolve(["secret": hex(secret.withUnsafeBytes { Data($0) })])
        } catch {
            call.reject("Couldn't agree on a secret: \(error.localizedDescription)")
        }
    }

    @objc func wipe(_ call: CAPPluginCall) {
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
