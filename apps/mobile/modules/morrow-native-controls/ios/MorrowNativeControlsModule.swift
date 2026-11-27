import ExpoModulesCore

public final class MorrowNativeControlsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MorrowNativeControls")

    View(MorrowLayoutMetricsView.self) {
      Events("onMetricsChange")
    }
  }
}
