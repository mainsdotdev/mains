Pod::Spec.new do |s|
  s.name = 'MainsDocumentPreview'
  s.version = '1.0.0'
  s.summary = 'Read-only previews of downloaded Mains outputs'
  s.description = 'Presents local conversation outputs with iOS Quick Look.'
  s.license = { :type => 'MIT' }
  s.author = { 'Mains' => 'team@mains.dev' }
  s.homepage = 'https://mains.dev'
  s.source = { :git => 'https://github.com/mainsdotdev/mains.git' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'QuickLook', 'UIKit'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
