import AppKit
import ApplicationServices
import Foundation

// The Computer Use helper: reads one JSON request on stdin, prints one JSON reply line on stdout.
// Replies: ok (with a value), unverifiable, refused, permission_denied or failed. It never writes
// files and never logs what it reads (clipboard text, screenshots, element values).

struct Refusal: Error { let reason: String }
struct Denied: Error { let missing: [String] }
struct Failure: Error { let message: String }
struct Unverifiable: Error { let detail: String }

typealias JSON = [String: Any]

func nullable(_ value: Any?) -> Any { value ?? NSNull() }

extension Dictionary where Key == String, Value == Any {
  func string(_ key: String) throws -> String {
    guard let value = self[key] as? String else { throw Failure(message: "Missing \(key)") }
    return value
  }
  func optionalString(_ key: String) -> String? { self[key] as? String }
  func double(_ key: String) throws -> Double {
    guard let value = self[key] as? NSNumber else { throw Failure(message: "Missing \(key)") }
    return value.doubleValue
  }
  func int(_ key: String) throws -> Int { Int(try double(key)) }
  func optionalInt(_ key: String) -> Int? { (self[key] as? NSNumber)?.intValue }
  func bool(_ key: String) -> Bool { (self[key] as? Bool) ?? false }
  func object(_ key: String) throws -> JSON {
    guard let value = self[key] as? JSON else { throw Failure(message: "Missing \(key)") }
    return value
  }
  func rect(_ key: String) throws -> CGRect {
    let r = try object(key)
    return CGRect(x: try r.double("x"), y: try r.double("y"), width: try r.double("width"), height: try r.double("height"))
  }
  func point(_ key: String) throws -> CGPoint {
    let p = try object(key)
    return CGPoint(x: try p.double("x"), y: try p.double("y"))
  }
}

func handle(_ request: JSON) async throws -> JSON {
  let kind = try request.string("kind")
  switch kind {
  case "check_permissions": return ok(permissionStatus(prompt: request.bool("prompt")))
  case "list_apps": return ok(listApps())
  case "list_windows": return ok(listWindows(pid: request.optionalInt("pid")))
  case "get_screen_size": return ok(listDisplays())
  case "get_window_state": return ok(try await windowState(request))
  case "get_desktop_state": return ok(try await desktopState(request))
  case "click": return try click(request)
  case "move_cursor": return try moveCursor(request)
  case "drag": return try drag(request)
  case "scroll": return try scroll(request)
  case "type_text": return try typeText(request)
  case "hotkey": return try hotkey(request)
  case "bring_to_front": return try bringToFront(request)
  case "launch_app": return ok(try await launchApp(request))
  case "set_window_frame": return try setWindowFrame(request)
  case "clipboard_read": return ok(["text": nullable(NSPasteboard.general.string(forType: .string))])
  case "clipboard_write": return try clipboardWrite(request)
  default: throw Failure(message: "Unknown request \(kind)")
  }
}

func ok(_ value: Any) -> JSON { ["kind": "ok", "value": value] }

func emit(_ reply: JSON) {
  let data = (try? JSONSerialization.data(withJSONObject: reply)) ?? Data("{\"kind\":\"failed\",\"message\":\"Could not encode the reply\"}".utf8)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}

let reply: JSON
do {
  let input = FileHandle.standardInput.readDataToEndOfFile()
  guard let request = try JSONSerialization.jsonObject(with: input) as? JSON else { throw Failure(message: "The request is not a JSON object") }
  reply = try await handle(request)
} catch let refusal as Refusal {
  reply = ["kind": "refused", "reason": refusal.reason]
} catch let denied as Denied {
  reply = ["kind": "permission_denied", "missing": denied.missing]
} catch let unverifiable as Unverifiable {
  reply = ["kind": "unverifiable", "detail": unverifiable.detail]
} catch let failure as Failure {
  reply = ["kind": "failed", "message": failure.message]
} catch {
  reply = ["kind": "failed", "message": String(describing: error)]
}
emit(reply)
exit(0)
