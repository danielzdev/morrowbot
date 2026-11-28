Pod::Spec.new do |s|
  s.name           = 'MorrowNativeControls'
  s.version        = '0.0.0'
  s.summary        = 'Native layout metrics and orientation support for Ori Bot Mobile.'
  s.description    = 'Reports size classes, iPhone Duo hinge and vertical-bar geometry, and reserved regions to React Native.'
  s.license        = 'Apache-2.0'
  s.author         = 'Legendary Koi'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
end
