// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MainsCore",
    platforms: [.iOS(.v18), .macOS(.v14)],
    products: [.library(name: "MainsCore", targets: ["MainsCore"])],
    targets: [
        .target(name: "MainsCore"),
        .testTarget(name: "MainsCoreTests", dependencies: ["MainsCore"]),
    ]
)
