import AppKit
import ApplicationServices
import CoreGraphics

func permissionStatus(prompt: Bool) -> JSON {
  let accessibility: Bool
  let screenRecording: Bool
  if prompt {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    accessibility = AXIsProcessTrustedWithOptions(options)
    screenRecording = CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess()
  } else {
    accessibility = AXIsProcessTrusted()
    screenRecording = CGPreflightScreenCaptureAccess()
  }
  return ["accessibility": accessibility, "screenRecording": screenRecording]
}

/// Throws `Denied` naming every grant this request needs that the process does not have. Never prompts.
func require(accessibility: Bool = false, screenRecording: Bool = false) throws {
  var missing: [String] = []
  if accessibility && !AXIsProcessTrusted() { missing.append("accessibility") }
  if screenRecording && !CGPreflightScreenCaptureAccess() { missing.append("screen-recording") }
  if !missing.isEmpty { throw Denied(missing: missing) }
}

func listApps() -> [JSON] {
  NSWorkspace.shared.runningApplications
    .filter { $0.activationPolicy == .regular }
    .map { app in
      [
        "pid": Int(app.processIdentifier),
        "name": app.localizedName ?? "",
        "bundleId": nullable(app.bundleIdentifier),
        "active": app.isActive,
        "hidden": app.isHidden,
      ]
    }
}

func rectJSON(_ rect: CGRect) -> JSON {
  ["x": Double(rect.origin.x), "y": Double(rect.origin.y), "width": Double(rect.size.width), "height": Double(rect.size.height)]
}

struct WindowInfo {
  let windowId: Int
  let pid: Int
  let app: String
  let title: String?
  let frame: CGRect

  var json: JSON { ["windowId": windowId, "pid": pid, "app": app, "title": nullable(title), "frame": rectJSON(frame)] }
}

/// On-screen app windows (layer 0), front to back. Titles are nil without Screen Recording.
func onScreenWindows() -> [WindowInfo] {
  let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [JSON] ?? []
  return raw.compactMap { info in
    guard (info[kCGWindowLayer as String] as? Int) == 0,
      let windowId = info[kCGWindowNumber as String] as? Int,
      let pid = info[kCGWindowOwnerPID as String] as? Int,
      let bounds = info[kCGWindowBounds as String] as? NSDictionary,
      let frame = CGRect(dictionaryRepresentation: bounds)
    else { return nil }
    let title = (info[kCGWindowName as String] as? String).flatMap { $0.isEmpty ? nil : $0 }
    return WindowInfo(windowId: windowId, pid: pid, app: info[kCGWindowOwnerName as String] as? String ?? "", title: title, frame: frame)
  }
}

func listWindows(pid: Int?) -> [JSON] {
  onScreenWindows().filter { pid == nil || $0.pid == pid }.map { $0.json }
}

func window(_ windowId: Int) throws -> WindowInfo {
  guard let found = onScreenWindows().first(where: { $0.windowId == windowId }) else {
    throw Refusal(reason: "Window \(windowId) is not on screen any more. Call list_windows again.")
  }
  return found
}

struct DisplayInfo {
  let displayId: CGDirectDisplayID
  let frame: CGRect
  let pixelWidth: Int
  let pixelHeight: Int

  var scale: Double { frame.width > 0 ? Double(pixelWidth) / Double(frame.width) : 1 }
  var json: JSON {
    ["displayId": Int(displayId), "frame": rectJSON(frame), "pixelWidth": pixelWidth, "pixelHeight": pixelHeight, "scale": scale, "main": CGDisplayIsMain(displayId) != 0]
  }
}

func displays() -> [DisplayInfo] {
  var count: UInt32 = 0
  guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return [] }
  var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
  guard CGGetActiveDisplayList(count, &ids, &count) == .success else { return [] }
  return ids.prefix(Int(count)).map { id in
    let frame = CGDisplayBounds(id)
    let mode = CGDisplayCopyDisplayMode(id)
    return DisplayInfo(displayId: id, frame: frame, pixelWidth: mode?.pixelWidth ?? Int(frame.width), pixelHeight: mode?.pixelHeight ?? Int(frame.height))
  }
}

func listDisplays() -> [JSON] { displays().map { $0.json } }

func close(_ a: CGRect, _ b: CGRect, tolerance: CGFloat = 2) -> Bool {
  abs(a.origin.x - b.origin.x) <= tolerance && abs(a.origin.y - b.origin.y) <= tolerance
    && abs(a.width - b.width) <= tolerance && abs(a.height - b.height) <= tolerance
}
