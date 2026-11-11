// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MainsCore",
    platforms: [.iOS("26.0"), .macOS(.v14)],
    products: [.library(name: "MainsCore", targets: ["MainsCore"])],
    targets: [
        .target(name: "MainsCore", resources: [.copy("Resources/DemoSnapshot.json")]),
        .testTarget(name: "MainsCoreTests", dependencies: ["MainsCore"]),
    ]
)
