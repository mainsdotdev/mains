require 'openssl'

module MainsRelease
  ROOT = File.expand_path('..', __dir__)
  BUNDLE_ID = 'dev.mains.mobile'
  TEAM_ID = 'Y4MVJ7JSH6'

  class Config
    attr_reader :version, :local_build, :key_id, :issuer_id, :key_path

    def initialize(env: ENV, root: ROOT)
      @env = env
      settings = File.read(File.join(root, 'Version.xcconfig'))
      @version = settings[/^MARKETING_VERSION\s*=\s*(\S+)\s*$/, 1]
      @local_build = settings[/^CURRENT_PROJECT_VERSION\s*=\s*(\S+)\s*$/, 1]
      unless @version&.match?(/\A\d+\.\d+\.\d+\z/) && @local_build&.match?(/\A[1-9]\d*\z/)
        raise ArgumentError, 'Version.xcconfig needs a numeric x.y.z version and a positive integer build number.'
      end
      @local_build = Integer(@local_build, 10)
    end

    def validate_credentials!
      missing = %w[ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH].select { |name| @env[name].to_s.strip.empty? }
      unless missing.empty?
        raise ArgumentError, "Missing #{missing.join(', ')}. Copy fastlane/.env.example to fastlane/.env and fill it in."
      end

      @key_id = @env.fetch('ASC_KEY_ID').strip
      @issuer_id = @env.fetch('ASC_ISSUER_ID').strip
      @key_path = File.expand_path(@env.fetch('ASC_KEY_PATH').strip)
      unless @env.fetch('ASC_KEY_PATH').strip.start_with?('/') && File.file?(@key_path) && File.readable?(@key_path)
        raise ArgumentError, 'ASC_KEY_PATH must be an absolute path to a readable .p8 file outside the repository.'
      end
      if File.realpath(@key_path).start_with?(File.realpath(File.join(ROOT, '../..')) + File::SEPARATOR)
        raise ArgumentError, 'Keep the App Store Connect .p8 key outside the repository.'
      end
      key = OpenSSL::PKey.read(File.read(@key_path))
      unless key.is_a?(OpenSSL::PKey::EC) && key.private? && key.group.curve_name == 'prime256v1'
        raise ArgumentError, 'ASC_KEY_PATH must contain an App Store Connect EC private key (P-256).'
      end
      self
    rescue OpenSSL::OpenSSLError
      raise ArgumentError, 'ASC_KEY_PATH does not contain a readable App Store Connect private key.'
    end

    def next_build(latest)
      # Do not silently truncate a dotted build number or reuse an invalid value.
      number = Integer(latest.to_s, 10)
      raise ArgumentError if number.negative?

      [number + 1, local_build].max
    rescue ArgumentError
      raise ArgumentError, 'The latest TestFlight build must be a nonnegative integer.'
    end

    def changelog(build)
      note = @env['MAINS_BETA_CHANGELOG'].to_s.strip
      note.empty? ? "Mains Native #{version} (#{build})" : note
    end
  end
end
