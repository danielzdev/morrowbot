import AppKit
import Carbon.HIToolbox
import CoreGraphics

let source = CGEventSource(stateID: .hidSystemState)
let posted = "Posted the input. It cannot be confirmed from here: take a new state to check what happened."

/// Where an action lands, in global points, after checking the snapshot it came from still holds.
func target(_ request: JSON, _ key: String) throws -> CGPoint {
  let spec = try request.object(key)
  let check = try spec.object("check")
  switch try check.string("kind") {
  case "element":
    let (current, info) = try resolveElement(check)
    return try uncovered(CGPoint(x: current.midX, y: current.midY), in: info)
  case "window":
    return try uncovered(try spec.point("point"), in: try snapshotWindow(check))
  case "display":
    let point = try spec.point("point")
    let displayId = try check.int("displayId")
    guard let display = displays().first(where: { Int($0.displayId) == displayId }), close(display.frame, try check.rect("frame")) else {
      throw Refusal(reason: "The display changed since the snapshot. Call get_desktop_state again.")
    }
    return point
  case let other:
    throw Failure(message: "Unknown target check \(other)")
  }
}

/// `point`, if the snapshot's window is the frontmost one there.
func uncovered(_ point: CGPoint, in info: WindowInfo) throws -> CGPoint {
  guard let top = onScreenWindows().first(where: { $0.frame.contains(point) }), top.windowId == info.windowId else {
    throw Refusal(reason: "Another window covers that point now. Bring \(info.app) to the front, then take a new state.")
  }
  return point
}

func post(_ event: CGEvent?) {
  event?.post(tap: .cghidEventTap)
  usleep(8_000)
}

func mouse(_ type: CGEventType, _ point: CGPoint, _ button: CGMouseButton, clickState: Int64 = 1) {
  let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: button)
  event?.setIntegerValueField(.mouseEventClickState, value: clickState)
  post(event)
}

func click(_ request: JSON) throws -> JSON {
  try require(accessibility: true)
  let point = try target(request, "target")
  let right = try request.string("button") == "right"
  let (down, up, button): (CGEventType, CGEventType, CGMouseButton) = right ? (.rightMouseDown, .rightMouseUp, .right) : (.leftMouseDown, .leftMouseUp, .left)
  mouse(.mouseMoved, point, .left)
  for count in 1...max(1, try request.int("count")) {
    mouse(down, point, button, clickState: Int64(count))
    mouse(up, point, button, clickState: Int64(count))
  }
  throw Unverifiable(detail: posted)
}

func moveCursor(_ request: JSON) throws -> JSON {
  try require(accessibility: true)
  let point = try target(request, "target")
  mouse(.mouseMoved, point, .left)
  guard let now = CGEvent(source: nil)?.location, abs(now.x - point.x) <= 1, abs(now.y - point.y) <= 1 else {
    throw Unverifiable(detail: "Moved the cursor, but it is not where it was sent.")
  }
  return ok(["x": Double(now.x), "y": Double(now.y)])
}

func drag(_ request: JSON) throws -> JSON {
  try require(accessibility: true)
  let from = try target(request, "from")
  let to = try target(request, "to")
  mouse(.mouseMoved, from, .left)
  mouse(.leftMouseDown, from, .left)
  let steps = 12
  for step in 1...steps {
    let t = CGFloat(step) / CGFloat(steps)
    mouse(.leftMouseDragged, CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t), .left)
  }
  mouse(.leftMouseUp, to, .left)
  throw Unverifiable(detail: posted)
}

func scroll(_ request: JSON) throws -> JSON {
  try require(accessibility: true)
  let point = try target(request, "target")
  mouse(.mouseMoved, point, .left)
  let dx = Int32(try request.int("dx"))
  let dy = Int32(try request.int("dy"))
  post(CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 2, wheel1: -dy, wheel2: -dx, wheel3: 0))
  throw Unverifiable(detail: posted)
}

func refuseSecureInput() throws {
  if IsSecureEventInputEnabled() {
    throw Refusal(reason: "Secure input is on (a password field has focus). Ask the person to type it themselves.")
  }
}

func key(_ code: CGKeyCode, flags: CGEventFlags = []) {
  for down in [true, false] {
    let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down)
    event?.flags = flags
    post(event)
  }
}

func typeText(_ request: JSON) throws -> JSON {
  try require(accessibility: true)
  try refuseSecureInput()
  var chunk: [UniChar] = []
  func flush() {
    guard !chunk.isEmpty else { return }
    for down in [true, false] {
      let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down)
      event?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
      post(event)
    }
    chunk = []
  }
  for character in try request.string("text") {
    switch character {
    case "\n", "\r\n", "\r":
      flush()
      key(CGKeyCode(kVK_Return))
    case "\t":
      flush()
      key(CGKeyCode(kVK_Tab))
    default:
      let units = Array(String(character).utf16)
      if chunk.count + units.count > 16 { flush() }
      chunk.append(contentsOf: units)
    }
  }
  flush()
  throw Unverifiable(detail: posted)
}

func hotkey(_ request: JSON) throws -> JSON {
  try require(accessibility: true)
  try refuseSecureInput()
  guard let names = request["modifiers"] as? [String] else { throw Failure(message: "Missing modifiers") }
  var flags: CGEventFlags = []
  for name in names {
    switch name {
    case "command": flags.insert(.maskCommand)
    case "shift": flags.insert(.maskShift)
    case "option": flags.insert(.maskAlternate)
    case "control": flags.insert(.maskControl)
    case "fn": flags.insert(.maskSecondaryFn)
    default: throw Failure(message: "Unknown modifier \(name)")
    }
  }
  key(CGKeyCode(try request.int("keyCode")), flags: flags)
  throw Unverifiable(detail: posted)
}
