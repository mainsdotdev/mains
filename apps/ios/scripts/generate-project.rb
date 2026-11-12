#!/usr/bin/env ruby
# Only needed when adding/removing source files. The generated project is committed.
require 'xcodeproj'
require 'fileutils'

root = File.expand_path('..', __dir__)
project = Xcodeproj::Project.new(File.join(root, 'Mains.xcodeproj'))
app = project.new_target(:application, 'Mains', :ios, '26.0')
app.product_reference.path = 'Mains Native.app'
tests = project.new_target(:ui_test_bundle, 'MainsUITests', :ios, '26.0')
tests.add_dependency(app)

# Pin the native WebRTC binary; MainsCore's portable package has no media dependency.
webrtc = project.new(Xcodeproj::Project::Object::XCRemoteSwiftPackageReference)
webrtc.repositoryURL = 'https://github.com/stasel/WebRTC.git'
webrtc.requirement = { 'kind' => 'exactVersion', 'version' => '157.0.0' }
project.root_object.package_references << webrtc
product = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
product.package = webrtc
product.product_name = 'WebRTC'
app.package_product_dependencies << product
framework = project.new(Xcodeproj::Project::Object::PBXBuildFile)
framework.product_ref = product
app.frameworks_build_phase.files << framework

# Resolve against the selected SDK rather than pinning a versioned SDK path.
project.objects.grep(Xcodeproj::Project::Object::PBXFileReference).each do |reference|
  next unless File.basename(reference.path.to_s) == 'Foundation.framework'
  reference.path = 'System/Library/Frameworks/Foundation.framework'
  reference.source_tree = 'SDKROOT'
end

source_group = project.main_group.new_group('Sources', 'Sources')
%w[MainsCore MainsApp].each do |directory|
  group = source_group.new_group(directory, directory)
  Dir.glob(File.join(root, 'Sources', directory, '*.{swift,metal}')).sort.each do |path|
    app.source_build_phase.add_file_reference(group.new_file(File.basename(path)))
  end
end
resources = project.main_group.new_group('Resources', 'Resources')
app.resources_build_phase.add_file_reference(resources.new_file('Assets.xcassets'))
app.resources_build_phase.add_file_reference(resources.new_file('PrivacyInfo.xcprivacy'))
app.resources_build_phase.add_file_reference(resources.new_file('WebRTC-LICENSE.txt'))
math = resources.new_file('Math')
math.last_known_file_type = 'folder'
app.resources_build_phase.add_file_reference(math)
voice_previews = resources.new_file('VoicePreviews')
voice_previews.last_known_file_type = 'folder'
app.resources_build_phase.add_file_reference(voice_previews)
demo = project.main_group.new_file('Sources/MainsCore/Resources/DemoSnapshot.json')
app.resources_build_phase.add_file_reference(demo)
project.main_group.new_file('Info.plist')
project.main_group.new_file('Info.Debug.plist')
version_config = project.main_group.new_file('Version.xcconfig')
test_group = project.main_group.new_group('UITests', 'UITests')
Dir.glob(File.join(root, 'UITests', '*.swift')).sort.each do |path|
  tests.source_build_phase.add_file_reference(test_group.new_file(File.basename(path)))
end

[app, tests].each do |target|
  target.build_configurations.each do |configuration|
    configuration.build_settings.merge!({
      'SWIFT_VERSION' => '6.0',
      'TARGETED_DEVICE_FAMILY' => '1',
      'CODE_SIGN_STYLE' => 'Automatic',
      'DEVELOPMENT_TEAM' => 'Y4MVJ7JSH6',
      'SUPPORTED_PLATFORMS' => 'iphoneos iphonesimulator',
      'SUPPORTS_MACCATALYST' => 'NO',
      'SWIFT_STRICT_CONCURRENCY' => 'complete',
    })
  end
end
app.build_configurations.each do |configuration|
  configuration.base_configuration_reference = version_config
  debug = configuration.name == 'Debug'
  configuration.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => debug ? 'dev.mains.ios.dev' : 'dev.mains.mobile',
    'PRODUCT_NAME' => 'Mains Native',
    'INFOPLIST_FILE' => debug ? 'Info.Debug.plist' : 'Info.plist',
    'ASSETCATALOG_COMPILER_APPICON_NAME' => 'AppIcon',
    'ENABLE_USER_SCRIPT_SANDBOXING' => 'YES',
  })
end
tests.build_configurations.each do |configuration|
  configuration.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'dev.mains.ios.uitests',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'TEST_TARGET_NAME' => 'Mains',
  })
end
project.predictabilize_uuids
project.save
scheme = Xcodeproj::XCScheme.new
scheme.configure_with_targets(app, tests, :launch_target => app)
scheme.save_as(project.path, 'Mains', true)
puts 'Generated Mains.xcodeproj'
