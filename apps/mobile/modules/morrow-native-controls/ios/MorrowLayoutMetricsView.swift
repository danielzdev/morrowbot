import ExpoModulesCore
import UIKit

/// An invisible view that reports the geometry React Native cannot see: size classes, whether
/// the device has a hinge, the system vertical bar edge, and reserved regions such as the fold.
/// Every value is in this view's own coordinate space. See `src/lib/reserved-regions.ts`.
final class MorrowLayoutMetricsView: ExpoView {
  let onMetricsChange = EventDispatcher()

  private enum Hinge {
    /// Waiting for the first hinge update; UIKit sends none on devices without one.
    case unknown
    case absent
    case present
  }

  private static let silentHingeTimeout: TimeInterval = 0.25

  private var hinge: Hinge = .absent
  private var lastPublished: NSDictionary?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    registerForTraitChanges([UITraitHorizontalSizeClass.self, UITraitVerticalSizeClass.self]) {
      (view: MorrowLayoutMetricsView, _: UITraitCollection) in
      view.publish()
    }
    // UIHingeInteraction, verticalBarEdge and ReservedRegion ship in the iOS 27.1 SDK (UIKit
    // 9127.0.85). Xcode 27.0's SDK lacks them, so gate on the SDK as well as the OS.
    #if canImport(UIKit, _version: 9127.0.85)
    if #available(iOS 27.1, *) {
      hinge = .unknown
      addInteraction(UIHingeInteraction { [weak self] _, update in
        guard let self, self.window != nil, update.hinge != nil, self.hinge != .present else { return }
        self.hinge = .present
        self.publish()
      })
      registerForTraitChanges(UITraitCollection.systemTraitsAffectingVerticalBarEdge) {
        (view: MorrowLayoutMetricsView, _: UITraitCollection) in
        view.publish()
      }
    }
    #endif
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    lastPublished = nil
    if window != nil, hinge == .unknown {
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.silentHingeTimeout) { [weak self] in
        guard let self, self.window != nil, self.hinge == .unknown else { return }
        self.hinge = .absent
        self.publish()
      }
    }
    publish()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    publish()
  }

  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    publish()
  }

  private func publish() {
    guard let window, bounds.width > 0, bounds.height > 0 else { return }
    let hasHinge: Bool
    switch hinge {
    case .unknown: return
    case .absent: hasHinge = false
    case .present: hasHinge = true
    }
    if hasHinge {
      MorrowOrientationSubscriber.allowHingeOrientations(in: window)
    }

    var payload: [String: Any] = [
      "width": bounds.width,
      "height": bounds.height,
      "hasHinge": hasHinge,
      "horizontalSizeClass": traitCollection.horizontalSizeClass == .regular ? "regular" : "compact",
      "verticalBarEdge": "none",
      "safeArea": [
        "top": safeAreaInsets.top,
        "bottom": safeAreaInsets.bottom,
        "left": safeAreaInsets.left,
        "right": safeAreaInsets.right,
      ],
      "reservedRegions": [[String: Any]](),
      "bottomBarInset": NSNull(),
    ]
    #if canImport(UIKit, _version: 9127.0.85)
    if #available(iOS 27.1, *) {
      payload["verticalBarEdge"] = verticalBarEdgeName()
      payload["reservedRegions"] = activeReservedRegions()
      payload["bottomBarInset"] = edgeInsets(for: .bar(onEdge: UIRectEdge.bottom, extent: 48)).bottom
    }
    #endif

    let next = payload as NSDictionary
    guard lastPublished?.isEqual(next) != true else { return }
    lastPublished = next
    onMetricsChange(payload)
  }

  #if canImport(UIKit, _version: 9127.0.85)
  @available(iOS 27.1, *)
  private func verticalBarEdgeName() -> String {
    let rightToLeft = effectiveUserInterfaceLayoutDirection == .rightToLeft
    switch traitCollection.verticalBarEdge {
    case .leading: return rightToLeft ? "right" : "left"
    case .trailing: return rightToLeft ? "left" : "right"
    default: return "none"
    }
  }

  @available(iOS 27.1, *)
  private func activeReservedRegions() -> [[String: Any]] {
    let kinds: [(UIView.ReservedRegion.Kind, String)] = [(.division, "division"), (.occlusion, "occlusion")]
    return kinds.flatMap { kind, name in
      reservedRegions(kind: kind).compactMap { region -> [String: Any]? in
        guard region.isActive else { return nil }
        let frame = region.frame.intersection(bounds)
        guard !frame.isNull, !frame.isEmpty else { return nil }
        return [
          "kind": name,
          "x": frame.minX,
          "y": frame.minY,
          "width": frame.width,
          "height": frame.height,
        ]
      }
    }
  }
  #endif
}
