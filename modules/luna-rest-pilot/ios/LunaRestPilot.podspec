Pod::Spec.new do |s|
  s.name = 'LunaRestPilot'
  s.version = '0.1.0'
  s.summary = 'Explicit native Preview rest-kernel comparison'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'LUNA Shift'
  s.homepage = 'https://github.com/vladularu/PflegeShift'
  s.source = { :git => 'https://github.com/vladularu/PflegeShift.git' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.{swift,h}'
  s.public_header_files = 'LunaRestPilot.h'
  s.vendored_frameworks = 'LunaRestCore.xcframework'
  s.libraries = 'c++', 'resolv'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
