#!/bin/sh
# Run explicitly on the relay host. Never replace an existing operator key.
set -eu
umask 077
relay_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$relay_dir"

if [ ! -e .env ]; then
  (set -C; cat .env.example > .env)
fi

secrets_dir=deploy/secrets
secret_file=$secrets_dir/routing.secret
if [ -L "$secrets_dir" ] || [ -L "$secret_file" ]; then
  echo 'Refusing a symlink at the secret directory or file.' >&2
  exit 1
fi
mkdir -p "$secrets_dir"
chmod 700 "$secrets_dir"

if [ ! -e "$secret_file" ]; then
  command -v openssl >/dev/null 2>&1 || {
    echo 'OpenSSL is required to generate the operator key.' >&2
    exit 1
  }
  temporary=$(mktemp "$secrets_dir/.routing.XXXXXX")
  trap 'rm -f "$temporary"' 0
  openssl rand -hex 32 > "$temporary"
  chmod 444 "$temporary"
  # A hard link makes publication atomic and refuses to overwrite a key.
  ln "$temporary" "$secret_file"
  rm -f "$temporary"
  trap - 0
fi

if [ ! -f "$secret_file" ] || [ "$(wc -c < "$secret_file")" -lt 32 ]; then
  echo 'The existing operator key must be a file containing at least 32 bytes.' >&2
  exit 1
fi
# Compose file secrets preserve host ownership. The private parent directory
# protects the host file; this mode lets the non-root container read its mount.
chmod 444 "$secret_file"
echo 'Ready: .env and deploy/secrets/routing.secret (existing values preserved).'
