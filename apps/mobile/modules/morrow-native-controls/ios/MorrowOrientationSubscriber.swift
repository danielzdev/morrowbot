import ExpoModulesCore
import UIKit

/// Phones stay portrait, except windows on a device with a hinge (iPhone Duo), which may rotate
/// so the unfolded screen can be used in either posture.
public final class MorrowOrientationSubscriber: ExpoAppDelegateSubscriber {
  @MainActor private static let hingeWindows = NSHashTable<UIWindow>.weakObjects()

  @MainActor
  static func allowHingeOrientations(in window: UIWindow) {
    guard !hingeWindows.contains(window) else { return }
    hingeWindows.add(window)
    window.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
  }

  @MainActor
  public func application(
    _ application: UIApplication,
    supportedInterfaceOrientationsFor window: UIWindow?
  ) -> UIInterfaceOrientationMask {
    if UIDevice.current.userInterfaceIdiom == .pad {
      return .all
    }
    guard let window, Self.hingeWindows.contains(window) else { return .portrait }
    return .allButUpsideDown
  }
}
