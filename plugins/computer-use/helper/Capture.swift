import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

/// The largest size that fits `maxDimension` on its long edge, keeping the aspect ratio (never upscaled).
func fit(width: Double, height: Double, maxDimension: Int) -> (Int, Int) {
  let scale = min(1, Double(maxDimension) / max(width, height))
  return (max(1, Int((width * scale).rounded())), max(1, Int((height * scale).rounded())))
}

func pngJSON(_ image: CGImage) throws -> JSON {
  let data = NSMutableData()
  guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else {
    throw Failure(message: "Could not encode the screenshot")
  }
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else { throw Failure(message: "Could not encode the screenshot") }
  return ["base64": data.base64EncodedString(), "width": image.width, "height": image.height]
}

func capture(_ filter: SCContentFilter, points: CGSize, maxDimension: Int) async throws -> JSON {
  let scale = Double(filter.pointPixelScale)
  let (width, height) = fit(width: Double(points.width) * scale, height: Double(points.height) * scale, maxDimension: maxDimension)
  let config = SCStreamConfiguration()
  config.width = width
  config.height = height
  config.showsCursor = false
  let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
  return try pngJSON(image)
}

func windowState(_ request: JSON) async throws -> JSON {
  let screenshot = request.bool("screenshot")
  try require(accessibility: true, screenRecording: screenshot)
  let info = try window(try request.int("windowId"))
  guard let axWindow = axWindow(for: info) else {
    throw Refusal(reason: "Accessibility cannot see window \(info.windowId) of \(info.app). Some apps do not expose their windows.")
  }
  let (elements, truncated) = tree(of: axWindow, maxDepth: try request.int("maxDepth"), maxElements: try request.int("maxElements"))
  var image: Any = NSNull()
  if screenshot {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let scWindow = content.windows.first(where: { Int($0.windowID) == info.windowId }) else {
      throw Refusal(reason: "Window \(info.windowId) cannot be captured right now.")
    }
    image = try await capture(SCContentFilter(desktopIndependentWindow: scWindow), points: scWindow.frame.size, maxDimension: try request.int("maxDimension"))
  }
  return ["window": info.json, "elements": elements, "truncated": truncated, "image": image]
}

func desktopState(_ request: JSON) async throws -> JSON {
  try require(screenRecording: true)
  let all = displays()
  let wanted = request.optionalInt("displayId")
  guard let display = wanted == nil ? all.first(where: { CGDisplayIsMain($0.displayId) != 0 }) ?? all.first : all.first(where: { Int($0.displayId) == wanted }) else {
    throw Refusal(reason: "No such display. Call get_screen_size for the display ids.")
  }
  let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
  guard let scDisplay = content.displays.first(where: { $0.displayID == display.displayId }) else {
    throw Refusal(reason: "Display \(display.displayId) cannot be captured right now.")
  }
  let filter = SCContentFilter(display: scDisplay, excludingWindows: [])
  let image = try await capture(filter, points: display.frame.size, maxDimension: try request.int("maxDimension"))
  return ["display": display.json, "image": image]
}
