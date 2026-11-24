// swift-tools-version: 6.0
// Platform-neutral core shared by the iOS app: schema, deterministic checks and the
// verify-then-escalate router (a port of web/src/core, kept behaviour-identical).
import PackageDescription

let package = Package(
  name: "TermCore",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [.library(name: "TermCore", targets: ["TermCore"])],
  targets: [
    .target(name: "TermCore"),
    .testTarget(name: "TermCoreTests", dependencies: ["TermCore"]),
  ]
)
