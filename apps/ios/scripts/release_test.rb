require 'minitest/autorun'
require 'minitest/mock'
require 'tmpdir'
require 'xcodeproj'
require 'gym'
require 'sigh'
require_relative '../fastlane/release_config'

# Evaluate the real lane with a closed set of offline action doubles. Any
# unexpected action fails; no Xcode archive, Swift test or Apple call can run.
module UI
  def self.user_error!(message)
    raise ArgumentError, message
  end

  def self.message(_message); end
  def self.success(_message); end
end

class ReleaseLaneHarness
  attr_reader :actions
  attr_accessor :fail_at, :latest

  def initialize
    @actions = []
    @latest = 7
    path = File.expand_path('../fastlane/Fastfile', __dir__)
    instance_eval(File.read(path), path)
  end

  def default_platform(_platform); end
  def platform(_platform)
    yield
  end
  def desc(_description); end
  def lane(name, &block)
    define_singleton_method(name) { instance_exec(&block) }
  end

  def record(name, args)
    @actions << [name, args]
    raise "Failure at #{name}" if fail_at == name
  end

  def sh(*args)
    record(:sh, args)
  end

  def app_store_connect_api_key(**args)
    record(:api_key, args)
    { offline: true }
  end

  def latest_testflight_build_number(**args)
    record(:latest_build, args)
    latest
  end

  def build_app(**args)
    record(:archive, args)
    File.join(args.fetch(:output_directory), args.fetch(:output_name))
  end

  def get_provisioning_profile(**args)
    record(:profile, args)
    'offline-profile-uuid'
  end

  def upload_to_testflight(**args)
    record(:upload, args)
  end
end

class ReleaseTest < Minitest::Test
  def setup
    @root = Dir.mktmpdir('mains-release-test')
    @key = File.join(@root, 'key with spaces.p8')
    File.write(@key, OpenSSL::PKey::EC.generate('prime256v1').private_to_pem)
    File.write(File.join(@root, 'Version.xcconfig'), "MARKETING_VERSION = 0.1.0\nCURRENT_PROJECT_VERSION = 1\n")
    @env = { 'ASC_KEY_ID' => 'OFFLINEKEY', 'ASC_ISSUER_ID' => 'offline-issuer', 'ASC_KEY_PATH' => @key }
    @config = MainsRelease::Config.new(env: @env, root: @root)
    @harness = ReleaseLaneHarness.new
  end

  def teardown
    FileUtils.remove_entry(@root)
  end

  def run_lane(name = :beta, identities: '"Apple Distribution: Offline Test"')
    local_command = lambda do |*args|
      status = Struct.new(:success?).new(true)
      case args
      when ['xcodebuild', '-version'] then ["Xcode 27.2\n", status]
      when ['security', 'find-identity', '-v', '-p', 'codesigning'] then [identities, status]
      else raise "Unexpected local command: #{args.inspect}"
      end
    end
    MainsRelease::Config.stub(:new, @config) do
      Open3.stub(:capture2e, local_command) { @harness.public_send(name) }
    end
  end

  def test_missing_credentials_fail_before_tests_or_apple_actions
    @env.delete('ASC_KEY_ID')
    error = assert_raises(ArgumentError) { run_lane }
    assert_includes error.message, 'Missing ASC_KEY_ID'
    assert_empty @harness.actions
  end

  def test_invalid_key_error_does_not_print_key_content
    secret = 'this-is-not-a-private-key'
    File.write(@key, secret)
    error = assert_raises(ArgumentError) { run_lane }
    refute_includes error.message, secret
    assert_empty @harness.actions
  end

  def test_missing_distribution_private_key_blocks_archive_and_upload
    assert_raises(ArgumentError) { run_lane(identities: '0 valid identities found') }
    assert_empty @harness.actions
  end

  def test_doctor_does_not_execute_release_actions
    run_lane(:doctor)
    assert_empty @harness.actions
  end

  def test_tests_and_archive_must_succeed_before_upload
    [:sh, :profile, :archive].each do |failure|
      @harness = ReleaseLaneHarness.new
      @harness.fail_at = failure
      assert_raises(RuntimeError) { run_lane }
      refute_includes @harness.actions.map(&:first), :upload
      refute_includes @harness.actions.map(&:first), :api_key if failure == :sh
    end
  end

  def test_archive_and_upload_use_same_number_without_editing_version_files
    before = File.read(File.join(@root, 'Version.xcconfig'))
    run_lane
    assert_equal [:sh, :api_key, :latest_build, :profile, :archive, :upload], @harness.actions.map(&:first)
    assert_equal ['swift', 'test'], @harness.actions.first.last
    archive = @harness.actions.assoc(:archive).last
    upload = @harness.actions.assoc(:upload).last
    assert_equal 'Release', archive.fetch(:configuration)
    assert_equal 'generic/platform=iOS', archive.fetch(:destination)
    assert_includes Shellwords.split(archive.fetch(:xcargs)), @key
    assert_includes archive.fetch(:xcargs), 'CURRENT_PROJECT_VERSION=8'
    assert_equal false, archive.fetch(:export_options).fetch(:manageAppVersionAndBuildNumber)
    assert_equal 'manual', archive.fetch(:export_options).fetch(:signingStyle)
    assert_equal 'Apple Distribution', archive.fetch(:export_options).fetch(:signingCertificate)
    assert_equal({ 'dev.mains.mobile' => 'offline-profile-uuid' }, archive.fetch(:export_options).fetch(:provisioningProfiles))
    assert_equal true, @harness.actions.assoc(:profile).last.fetch(:ignore_profiles_with_different_name)
    assert_equal File.join(archive.fetch(:output_directory), 'Mains-0.1.0-8.ipa'), upload.fetch(:ipa)
    assert_equal 'dev.mains.mobile', upload.fetch(:app_identifier)
    assert_equal false, upload.fetch(:distribute_external)
    assert_equal false, upload.fetch(:submit_beta_review)
    assert_equal false, upload.fetch(:skip_waiting_for_build_processing)
    assert_equal before, File.read(File.join(@root, 'Version.xcconfig'))
  end

  def test_first_build_floor_and_invalid_remote_numbers
    assert_equal 1, @config.next_build(0)
    assert_equal 8, @config.next_build(7)
    assert_equal 2, @config.next_build('1')
    ['1.2.3', '-1', 'unknown'].each { |value| assert_raises(ArgumentError) { @config.next_build(value) } }
    File.write(File.join(@root, 'Version.xcconfig'), "MARKETING_VERSION = 0.2.0\nCURRENT_PROJECT_VERSION = 10\n")
    config = MainsRelease::Config.new(env: @env, root: @root)
    assert_equal 10, config.next_build(7)
  end

  def test_release_continues_existing_testflight_app_and_debug_stays_separate
    project = Xcodeproj::Project.open(File.join(MainsRelease::ROOT, 'Mains.xcodeproj'))
    app = project.targets.find { |target| target.name == 'Mains' }
    release = app.build_configurations.find { |config| config.name == 'Release' }
    debug = app.build_configurations.find { |config| config.name == 'Debug' }
    assert_equal 'dev.mains.mobile', MainsRelease::BUNDLE_ID
    assert_equal MainsRelease::BUNDLE_ID, release.build_settings.fetch('PRODUCT_BUNDLE_IDENTIFIER')
    assert_equal MainsRelease::TEAM_ID, release.build_settings.fetch('DEVELOPMENT_TEAM')
    assert_equal 'dev.mains.ios.dev', debug.build_settings.fetch('PRODUCT_BUNDLE_IDENTIFIER')
    config = MainsRelease::Config.new
    assert_equal '1.0.0', config.version
    assert_equal 10, config.next_build(9)
    assert_equal 13, config.next_build(12)
  end

  def test_export_command_contains_authentication_flags_only_once
    run_lane
    archive = @harness.actions.assoc(:archive).last
    generator = Gym::PackageCommandGeneratorXcode7
    options = nil
    Gym.stub(:config, archive) do
      generator.stub(:config_path, File.join(@root, 'Export.plist')) do
        generator.stub(:temporary_output_path, @root) do
          Gym::BuildCommandGenerator.stub(:archive_path, archive.fetch(:archive_path)) do
            options = Shellwords.split(generator.options.join(' '))
          end
        end
      end
    end
    %w[-authenticationKeyPath -authenticationKeyID -authenticationKeyIssuerID].each do |flag|
      assert_equal 1, options.count(flag), "Expected exactly one #{flag} in the real gym export command"
    end
    assert_equal @key, options[options.index('-authenticationKeyPath') + 1]
  end

  def test_profile_options_are_accepted_by_the_real_sigh_configuration
    run_lane
    options = @harness.actions.assoc(:profile).last
    config = FastlaneCore::Configuration.create(Sigh::Options.available_options, options)
    assert_equal false, config[:development]
    assert_equal false, config[:adhoc]
    assert_equal false, config[:skip_certificate_verification]
  end

  def test_privacy_manifest_is_a_shipped_resource_with_required_api_reasons
    project = Xcodeproj::Project.open(File.join(MainsRelease::ROOT, 'Mains.xcodeproj'))
    app = project.targets.find { |target| target.name == 'Mains' }
    reference = app.resources_build_phase.files_references.find { |file| file.path == 'PrivacyInfo.xcprivacy' }
    refute_nil reference
    manifest = Xcodeproj::Plist.read_from_path(reference.real_path)
    reasons = manifest.fetch('NSPrivacyAccessedAPITypes').to_h do |entry|
      [entry.fetch('NSPrivacyAccessedAPIType'), entry.fetch('NSPrivacyAccessedAPITypeReasons')]
    end
    assert_includes reasons.fetch('NSPrivacyAccessedAPICategoryUserDefaults'), 'CA92.1'
    assert_includes reasons.fetch('NSPrivacyAccessedAPICategoryFileTimestamp'), 'C617.1'
    assert_includes reasons.fetch('NSPrivacyAccessedAPICategoryFileTimestamp'), '3B52.1'
  end

  def test_v1_target_excludes_voice_sources_packages_resources_and_permissions
    project = Xcodeproj::Project.open(File.join(MainsRelease::ROOT, 'Mains.xcodeproj'))
    app = project.targets.find { |target| target.name == 'Mains' }
    sources = app.source_build_phase.files_references.map(&:path)
    %w[NativeRealtimeVoiceMedia.swift RealtimeVoiceControls.swift VoiceSettingsView.swift VoiceAppearancePreview.swift VoiceWater.metal].each do |name|
      refute_includes sources, name
    end
    assert_empty app.package_product_dependencies
    assert_empty project.root_object.package_references
    resources = app.resources_build_phase.files_references.map(&:path)
    refute_includes resources, 'VoicePreviews'
    refute_includes resources, 'WebRTC-LICENSE.txt'
    app.build_configurations.each do |config|
      refute_includes config.build_settings.fetch('SWIFT_ACTIVE_COMPILATION_CONDITIONS'), 'MAINS_GPT_LIVE'
      plist = Xcodeproj::Plist.read_from_path(File.join(MainsRelease::ROOT, config.build_settings.fetch('INFOPLIST_FILE')))
      refute plist.key?('NSMicrophoneUsageDescription')
      refute_includes Array(plist['UIBackgroundModes']), 'audio'
    end
  end

  def test_hot_reload_is_limited_to_debug_simulators_and_not_embedded
    project = Xcodeproj::Project.open(File.join(MainsRelease::ROOT, 'Mains.xcodeproj'))
    app = project.targets.find { |target| target.name == 'Mains' }
    debug = app.build_configurations.find { |config| config.name == 'Debug' }.build_settings
    release = app.build_configurations.find { |config| config.name == 'Release' }.build_settings
    assert_equal ['$(inherited)', '-Xlinker', '-interposable'], debug.fetch('OTHER_LDFLAGS[sdk=iphonesimulator*]')
    assert_equal 'YES', debug.fetch('EMIT_FRONTEND_COMMAND_LINES[sdk=iphonesimulator*]')
    assert_equal 'YES', debug.fetch('SWIFT_ENABLE_OPAQUE_TYPE_ERASURE[sdk=iphonesimulator*]')
    assert_equal 'NO', debug.fetch('COMPILATION_CACHE_ENABLE_CACHING[sdk=iphonesimulator*]')
    refute debug.key?('OTHER_LDFLAGS')
    refute release.keys.any? { |key| key.start_with?('OTHER_LDFLAGS', 'EMIT_FRONTEND_COMMAND_LINES', 'SWIFT_ENABLE_OPAQUE_TYPE_ERASURE') }
    assert_includes release.fetch('EXCLUDED_SOURCE_FILE_NAMES'), 'DeveloperHotReload.swift'
    refute app.resources_build_phase.files_references.any? { |file| file.path.include?('Injection') }
    refute app.shell_script_build_phases.any? { |phase| phase.shell_script.include?('Injection') }
    scheme = Xcodeproj::XCScheme.new(File.join(project.path, 'xcshareddata/xcschemes/Mains.xcscheme'))
    assert_equal '$(SRCROOT)/Sources/MainsApp,$(HOME)/Library', scheme.launch_action.environment_variables['INJECTION_DIRECTORIES'].value
    refute scheme.test_action.should_use_launch_scheme_args_env?
    assert_equal '0', scheme.test_action.environment_variables['MAINS_HOT_RELOAD'].value
  end

  def test_invalid_version_cannot_reach_build_arguments
    File.write(File.join(@root, 'Version.xcconfig'), "MARKETING_VERSION = 0.1.0;bad\nCURRENT_PROJECT_VERSION = 1\n")
    assert_raises(ArgumentError) { MainsRelease::Config.new(env: @env, root: @root) }
  end

  def test_custom_changelog_is_sent_to_testflight
    @env['MAINS_BETA_CHANGELOG'] = "Pairing improvements\nComposer fixes"
    run_lane
    assert_equal @env['MAINS_BETA_CHANGELOG'], @harness.actions.assoc(:upload).last.fetch(:changelog)
  end

  def test_concurrent_release_cannot_execute_upload_steps
    output = File.join(MainsRelease::ROOT, 'build', 'beta')
    FileUtils.mkdir_p(output)
    File.open(File.join(output, '.lock'), 'w') do |lock|
      lock.flock(File::LOCK_EX | File::LOCK_NB)
      assert_raises(ArgumentError) { run_lane }
      assert_empty @harness.actions
    end
  end
end
