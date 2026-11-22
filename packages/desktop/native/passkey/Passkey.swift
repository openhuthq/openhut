import AppKit
import AuthenticationServices
import CryptoKit
import Foundation

let relyingParty = "keys.openhut.dev"
let salt = Data(SHA256.hash(data: Data("openhut/passkey/v1".utf8)))

func reply(_ object: [String: Any], status: Int32 = 0) -> Never {
  let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
  FileHandle.standardOutput.write(data + Data("\n".utf8))
  exit(status)
}

func base64url(_ data: Data) -> String {
  data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
}

func random() -> Data {
  Data((0..<32).map { _ in UInt8.random(in: 0...255) })
}

func entitled() -> Bool {
  guard let task = SecTaskCreateFromSelf(nil) else { return false }
  let domains = SecTaskCopyValueForEntitlement(task, "com.apple.developer.associated-domains" as CFString, nil) as? [String]
  return domains?.contains("webcredentials:\(relyingParty)") ?? false
}

func status() -> [String: Any] {
  let version = ProcessInfo.processInfo.operatingSystemVersion
  var prf = false
  if #available(macOS 15.0, *) { prf = true }
  return ["passkeys": entitled(), "prf": prf, "os": "\(version.majorVersion).\(version.minorVersion)", "rp": relyingParty]
}

@available(macOS 15.0, *)
final class Passkey: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
  let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 160), styleMask: [.titled, .fullSizeContentView], backing: .buffered, defer: false)
  let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: relyingParty)

  func create(email: String) {
    let request = provider.createCredentialRegistrationRequest(challenge: random(), name: email, userID: Data(SHA256.hash(data: Data(email.utf8))))
    request.prf = .inputValues(.init(saltInput1: salt))
    perform(request)
  }

  func open() {
    let request = provider.createCredentialAssertionRequest(challenge: random())
    request.prf = .inputValues(.init(saltInput1: salt))
    perform(request)
  }

  func perform(_ request: ASAuthorizationRequest) {
    let controller = ASAuthorizationController(authorizationRequests: [request])
    controller.delegate = self
    controller.presentationContextProvider = self
    window.title = "OpenHut"
    window.titlebarAppearsTransparent = true
    window.level = .floating
    window.center()
    window.makeKeyAndOrderFront(nil)
    NSApplication.shared.activate(ignoringOtherApps: true)
    controller.performRequests()
  }

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    window
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
    if let made = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration {
      guard let prf = made.prf, prf.isSupported else { reply(["error": "no-prf"], status: 2) }
      guard let first = prf.first else { return open() }
      reply(["prf": base64url(first.withUnsafeBytes { Data($0) })])
    }
    if let used = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion {
      guard let first = used.prf?.first else { reply(["error": "no-prf"], status: 2) }
      reply(["prf": base64url(first.withUnsafeBytes { Data($0) })])
    }
    reply(["error": "failed", "message": "macOS returned a credential that isn't a passkey."], status: 1)
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    let canceled = (error as? ASAuthorizationError)?.code == .canceled
    reply(["error": canceled ? "canceled" : "failed", "message": error.localizedDescription], status: 1)
  }
}

final class SignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
  let window: NSWindow
  var session: ASWebAuthenticationSession?

  init(frame: NSRect?) {
    window = NSWindow(contentRect: frame ?? NSRect(x: 0, y: 0, width: 520, height: 420), styleMask: frame == nil ? [.titled, .fullSizeContentView] : [.borderless], backing: .buffered, defer: false)
    super.init()
    if frame == nil {
      window.title = "OpenHut"
      window.titlebarAppearsTransparent = true
      window.center()
    } else {
      window.isOpaque = false
      window.backgroundColor = .clear
      window.hasShadow = false
      window.ignoresMouseEvents = true
    }
    window.level = .floating
  }

  func start(url: URL, scheme: String) {
    let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { callback, error in
      if let callback { reply(["url": callback.absoluteString]) }
      let canceled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
      reply(["error": canceled ? "canceled" : "failed", "message": error?.localizedDescription ?? "Sign-in didn't finish."], status: 1)
    }
    session.presentationContextProvider = self
    session.prefersEphemeralWebBrowserSession = false
    self.session = session
    window.makeKeyAndOrderFront(nil)
    NSApplication.shared.activate(ignoringOtherApps: true)
    if !session.start() { reply(["error": "failed", "message": "macOS couldn't open the sign-in sheet."], status: 1) }
  }

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    window
  }
}

func frameOf(_ parts: ArraySlice<String>) -> NSRect? {
  let numbers = parts.compactMap { Double($0) }
  guard numbers.count == 4, let screen = NSScreen.screens.first else { return nil }
  return NSRect(x: numbers[0], y: screen.frame.height - numbers[1] - numbers[3], width: numbers[2], height: numbers[3])
}

let arguments = Array(CommandLine.arguments.dropFirst())
switch arguments.first {
case "status":
  reply(status())
case "create" where arguments.count == 2, "open" where arguments.count == 1:
  guard #available(macOS 15.0, *) else { reply(["error": "needs-macos-15"], status: 2) }
  let passkey = Passkey()
  NSApplication.shared.setActivationPolicy(.regular)
  DispatchQueue.main.async { arguments[0] == "create" ? passkey.create(email: arguments[1]) : passkey.open() }
  NSApplication.shared.run()
case "signin" where arguments.count == 3 || arguments.count == 7:
  guard let url = URL(string: arguments[1]), url.scheme == "https" || (url.scheme == "http" && ["127.0.0.1", "localhost"].contains(url.host ?? "")) else { reply(["error": "usage", "message": "Sign in needs an https URL."], status: 64) }
  NSApplication.shared.setActivationPolicy(.regular)
  let signIn = SignIn(frame: frameOf(arguments.dropFirst(3)))
  DispatchQueue.main.async { signIn.start(url: url, scheme: arguments[2]) }
  NSApplication.shared.run()
default:
  reply(["error": "usage", "message": "passkey status | create <email> | open | signin <url> <scheme> [x y width height]"], status: 64)
}
