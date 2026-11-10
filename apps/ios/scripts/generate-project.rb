#!/usr/bin/env ruby
# Only needed when adding/removing source files. The generated project is committed.
require 'xcodeproj'
require 'fileutils'

root = File.expand_path('..', __dir__)
project = Xcodeproj::Project.new(File.join(root, 'Mains.xcodeproj'))
app = project.new_target(:application, 'Mains', :ios, '18.0')
app.product_reference.path = 'Mains Native.app'
tests = project.new_target(:ui_test_bundle, 'MainsUITests', :ios, '18.0')
tests.add_dependency(app)

source_group = project.main_group.new_group('Sources', 'Sources')
%w[MainsCore MainsApp].each do |directory|
  group = source_group.new_group(directory, directory)
  Dir.glob(File.join(root, 'Sources', directory, '*.swift')).sort.each do |path|
    app.source_build_phase.add_file_reference(group.new_file(File.basename(path)))
  end
end
resources = project.main_group.new_group('Resources', 'Resources')
app.resources_build_phase.add_file_reference(resources.new_file('Assets.xcassets'))
demo = project.main_group.new_file('Sources/MainsCore/Resources/DemoSnapshot.json')
app.resources_build_phase.add_file_reference(demo)
project.main_group.new_file('Info.plist')
project.main_group.new_file('Info.Debug.plist')
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
  debug = configuration.name == 'Debug'
  configuration.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => debug ? 'dev.mains.ios.dev' : 'dev.mains.ios',
    'PRODUCT_NAME' => 'Mains Native',
    'INFOPLIST_FILE' => debug ? 'Info.Debug.plist' : 'Info.plist',
    'MARKETING_VERSION' => '0.1.0',
    'CURRENT_PROJECT_VERSION' => '1',
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
