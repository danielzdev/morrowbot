import ApplicationServices
import CoreGraphics

let valueLimit = 200

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
  var value: CFTypeRef?
  return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

func text(_ element: AXUIElement, _ name: String) -> String? {
  guard let value = attribute(element, name) else { return nil }
  let string: String
  if let s = value as? String { string = s } else if let n = value as? NSNumber { string = n.stringValue } else { return nil }
  if string.isEmpty { return nil }
  return string.count > valueLimit ? String(string.prefix(valueLimit)) + "…" : string
}

func flag(_ element: AXUIElement, _ name: String) -> Bool { (attribute(element, name) as? Bool) ?? false }

func frame(of element: AXUIElement) -> CGRect? {
  guard let position = attribute(element, kAXPositionAttribute), let size = attribute(element, kAXSizeAttribute),
    CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID()
  else { return nil }
  var point = CGPoint.zero
  var extent = CGSize.zero
  guard AXValueGetValue(position as! AXValue, .cgPoint, &point), AXValueGetValue(size as! AXValue, .cgSize, &extent) else { return nil }
  return CGRect(origin: point, size: extent)
}

func children(_ element: AXUIElement) -> [AXUIElement] { attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] }

func actions(_ element: AXUIElement) -> [String] {
  var names: CFArray?
  guard AXUIElementCopyActionNames(element, &names) == .success else { return [] }
  return names as? [String] ?? []
}

/// The Accessibility window of `info`'s app with the same frame (and title, when several match).
func axWindow(for info: WindowInfo) -> AXUIElement? {
  let app = AXUIElementCreateApplication(pid_t(info.pid))
  AXUIElementSetMessagingTimeout(app, 2)
  let windows = (attribute(app, kAXWindowsAttribute) as? [AXUIElement] ?? []).filter { window in
    frame(of: window).map { close($0, info.frame) } ?? false
  }
  if windows.count > 1, let title = info.title, let match = windows.first(where: { text($0, kAXTitleAttribute) == title }) {
    return match
  }
  return windows.first
}

func describe(_ element: AXUIElement, path: [Int], depth: Int) -> JSON {
  let role = text(element, kAXRoleAttribute) ?? "AXUnknown"
  let secure = role == "AXSecureTextField" || text(element, kAXSubroleAttribute) == "AXSecureTextField"
  return [
    "path": path,
    "depth": depth,
    "role": role,
    "subrole": nullable(text(element, kAXSubroleAttribute)),
    "title": nullable(text(element, kAXTitleAttribute)),
    "value": secure ? NSNull() : nullable(text(element, kAXValueAttribute)),
    "description": nullable(text(element, kAXDescriptionAttribute)),
    "frame": nullable(frame(of: element).map(rectJSON)),
    "enabled": flag(element, kAXEnabledAttribute),
    "focused": flag(element, kAXFocusedAttribute),
    "actions": actions(element),
  ]
}

/// Walks the window's tree depth first, stopping at `maxDepth` and `maxElements`.
func tree(of window: AXUIElement, maxDepth: Int, maxElements: Int) -> (elements: [JSON], truncated: Bool) {
  var elements: [JSON] = []
  var truncated = false
  func walk(_ element: AXUIElement, path: [Int], depth: Int) {
    if elements.count >= maxElements {
      truncated = true
      return
    }
    elements.append(describe(element, path: path, depth: depth))
    let kids = children(element)
    if depth >= maxDepth {
      if !kids.isEmpty { truncated = true }
      return
    }
    for (index, child) in kids.enumerated() { walk(child, path: path + [index], depth: depth + 1) }
  }
  walk(window, path: [], depth: 0)
  return (elements, truncated)
}

let staleElement = "That element changed since the snapshot. Call get_window_state again and use a new ref."

/// The window as the snapshot saw it, or a refusal when it moved, resized or closed.
func snapshotWindow(_ request: JSON) throws -> WindowInfo {
  let info = try window(try request.int("windowId"))
  guard close(info.frame, try request.rect("windowFrame")) else {
    throw Refusal(reason: "The window moved or was resized since the snapshot. Call get_window_state again.")
  }
  return info
}

/// The element at `path` in the snapshot's window, if it still has the role and frame the snapshot recorded.
func resolveElement(_ request: JSON) throws -> (frame: CGRect, window: WindowInfo) {
  try require(accessibility: true)
  let info = try snapshotWindow(request)
  guard var element = axWindow(for: info) else { throw Refusal(reason: staleElement) }
  guard let path = request["path"] as? [NSNumber] else { throw Failure(message: "Missing path") }
  for index in path {
    let kids = children(element)
    guard index.intValue >= 0, index.intValue < kids.count else { throw Refusal(reason: staleElement) }
    element = kids[index.intValue]
  }
  guard text(element, kAXRoleAttribute) == (try request.string("role")), let current = frame(of: element),
    close(current, try request.rect("frame"))
  else { throw Refusal(reason: staleElement) }
  return (current, info)
}

func axValue(_ point: CGPoint) -> AXValue? {
  var value = point
  return AXValueCreate(.cgPoint, &value)
}

func axValue(_ size: CGSize) -> AXValue? {
  var value = size
  return AXValueCreate(.cgSize, &value)
}
