import AppKit
import ApplicationServices

func frontmostWindowPid() -> Int? { onScreenWindows().first?.pid }

func bringToFront(_ request: JSON) throws -> JSON {
  let pid = try request.int("pid")
  guard let app = NSRunningApplication(processIdentifier: pid_t(pid)) else {
    throw Refusal(reason: "No app is running with pid \(pid). Call list_apps again.")
  }
  if let windowId = request.optionalInt("windowId") {
    try require(accessibility: true)
    let info = try window(windowId)
    guard info.pid == pid, let axWindow = axWindow(for: info) else {
      throw Refusal(reason: "Window \(windowId) does not belong to pid \(pid) or Accessibility cannot see it.")
    }
    AXUIElementPerformAction(axWindow, kAXRaiseAction as CFString)
  }
  app.activate()
  for _ in 0..<20 {
    if frontmostWindowPid() == pid { return ok(["pid": pid]) }
    usleep(50_000)
  }
  throw Unverifiable(detail: "Asked \(app.localizedName ?? "the app") to come to the front, but its window is not frontmost yet.")
}

func applicationURL(_ request: JSON) throws -> URL {
  if let bundleId = request.optionalString("bundleId") {
    guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else {
      throw Refusal(reason: "No app with bundle id \(bundleId) is installed.")
    }
    return url
  }
  let name = try request.string("name")
  let home = FileManager.default.homeDirectoryForCurrentUser.path
  let folders = ["/Applications", "/System/Applications", "/System/Applications/Utilities", "\(home)/Applications"]
  for folder in folders {
    let url = URL(fileURLWithPath: folder).appendingPathComponent("\(name).app")
    if FileManager.default.fileExists(atPath: url.path) { return url }
  }
  throw Refusal(reason: "No app named \(name) in /Applications, /System/Applications or ~/Applications. Try its bundle id.")
}

func launchApp(_ request: JSON) async throws -> JSON {
  let url = try applicationURL(request)
  let configuration = NSWorkspace.OpenConfiguration()
  configuration.activates = request.bool("activate")
  let app = try await NSWorkspace.shared.openApplication(at: url, configuration: configuration)
  return ["pid": Int(app.processIdentifier), "name": app.localizedName ?? url.deletingPathExtension().lastPathComponent, "bundleId": nullable(app.bundleIdentifier)]
}

func setWindowFrame(_ request: JSON) throws -> JSON {
  try require(accessibility: true)
  let info = try window(try request.int("windowId"))
  guard let axWindow = axWindow(for: info) else {
    throw Refusal(reason: "Accessibility cannot see window \(info.windowId) of \(info.app).")
  }
  let wanted = try request.rect("frame")
  guard let position = axValue(wanted.origin), let size = axValue(wanted.size) else { throw Failure(message: "Bad frame") }
  AXUIElementSetAttributeValue(axWindow, kAXPositionAttribute as CFString, position)
  AXUIElementSetAttributeValue(axWindow, kAXSizeAttribute as CFString, size)
  guard let now = frame(of: axWindow) else { throw Unverifiable(detail: "Set the frame, but could not read it back.") }
  if close(now, wanted) { return ok(["frame": rectJSON(now)]) }
  throw Unverifiable(detail: "The window settled at x \(Int(now.origin.x)), y \(Int(now.origin.y)), \(Int(now.width))×\(Int(now.height)) points; the app may limit its size or position.")
}

func clipboardWrite(_ request: JSON) throws -> JSON {
  let text = try request.string("text")
  let board = NSPasteboard.general
  board.clearContents()
  board.setString(text, forType: .string)
  guard board.string(forType: .string) == text else { throw Unverifiable(detail: "Wrote the clipboard, but it reads back differently.") }
  return ok([String: Any]())
}
