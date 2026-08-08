Pod::Spec.new do |s|
  # OBLIGATORIO: expo-modules-autolinking descarta silenciosamente el lado iOS
  # de un módulo que no tenga podspec (resolveModuleAsync devuelve null si no
  # encuentra ninguno). Sin este archivo, el escudo simplemente no existiría en
  # iOS y no habría ningún error que lo indicara.
  s.name           = 'NovaShield'
  s.version        = '0.1.0'
  s.summary        = 'Escudo DNS y Protección de Mensajes de Nova Shield'
  s.description    = 'Módulo nativo del Escudo DNS (NEPacketTunnelProvider) y la Protección de Mensajes.'
  s.author         = 'Nova Solutions SAS'
  s.homepage       = 'https://novasolutions.ar'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
