Pod::Spec.new do |s|
  s.name = 'LunaEngine'
  s.version = '0.1.0'
  s.summary = 'LUNA immutable snapshot engine transport'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'LUNA Shift'
  s.homepage = 'https://github.com/vladularu/PflegeShift'
  s.source = { :git => 'https://github.com/vladularu/PflegeShift.git' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.{swift,c,h}'
  # The builder copies the canonical Rust header here before pod installation.
  # Publish both headers so consuming Swift modules need no private source path.
  s.public_header_files = 'LunaEngineBridge.h', 'LunaEngine.h'
  s.vendored_frameworks = 'LunaEngineCore.xcframework'
  s.libraries = 'c++', 'resolv'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
