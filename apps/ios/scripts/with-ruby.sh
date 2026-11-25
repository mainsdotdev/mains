#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

supported_ruby() {
  ruby -e 'exit(Gem::Version.new(RUBY_VERSION) >= Gem::Version.new("3.3.0"))' 2>/dev/null
}

# Respect a supported Ruby selected by the caller. On stock/older setups, use
# Homebrew's keg-only Ruby without changing the user's global Ruby or shell.
if ! supported_ruby; then
  for ruby_bin in /opt/homebrew/opt/ruby@3.3/bin /usr/local/opt/ruby@3.3/bin; do
    if [[ -x "$ruby_bin/ruby" ]]; then
      export PATH="$ruby_bin:$PATH"
      break
    fi
  done
fi

if ! supported_ruby; then
  echo 'Ruby 3.3+ is required. Install it with brew install ruby@3.3, then run npm run beta:setup.' >&2
  exit 1
fi

export BUNDLE_GEMFILE="$PWD/Gemfile"
export BUNDLE_PATH="${BUNDLE_PATH:-$PWD/.bundle/gems}"
export FASTLANE_SKIP_UPDATE_CHECK=1
export FASTLANE_HIDE_CHANGELOG=1
export FASTLANE_OPT_OUT_USAGE=1

if ! command -v bundle >/dev/null 2>&1; then
  echo 'Bundler is missing for the selected Ruby. Run gem install bundler, then npm run beta:setup.' >&2
  exit 1
fi

exec "$@"
