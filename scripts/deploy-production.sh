#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

deploy_host="${TIMESINCE_DEPLOY_HOST:-}"
deploy_root="${TIMESINCE_DEPLOY_ROOT:-/opt/timesince}"
environment_file="${TIMESINCE_ENV_FILE:-/etc/timesince/timesince.env}"
service_name="${TIMESINCE_SERVICE_NAME:-timesince}"
remote_node_binary="${TIMESINCE_NODE_BINARY:-auto}"
remote_npm_binary="${TIMESINCE_NPM_BINARY:-auto}"

if [[ -z "$deploy_host" ]]; then
  echo "TIMESINCE_DEPLOY_HOST is required, for example deployer@timesince-host." >&2
  exit 1
fi
if [[ ! "$deploy_root" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
  echo "TIMESINCE_DEPLOY_ROOT must be a simple absolute host path." >&2
  exit 1
fi
if [[ ! "$environment_file" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
  echo "TIMESINCE_ENV_FILE must be a simple absolute host path." >&2
  exit 1
fi
if [[ ! "$service_name" =~ ^[A-Za-z0-9_.@-]+$ ]]; then
  echo "TIMESINCE_SERVICE_NAME contains unsupported characters." >&2
  exit 1
fi
for binary_path in "$remote_node_binary" "$remote_npm_binary"; do
  if [[ "$binary_path" != "auto" && ! "$binary_path" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
    echo "Remote Node/npm overrides must be 'auto' or simple absolute paths." >&2
    exit 1
  fi
done

for command_name in git npm scp ssh tar; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required local command is unavailable: $command_name" >&2
    exit 1
  fi
done

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "Refusing to deploy: commit or remove all working-tree changes first." >&2
  exit 1
fi

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 22 && minor >= 13 ? 0 : 1)'; then
  echo "Local validation requires Node 22.13 or newer in the Node 22 line; found $(node --version). Run nvm use first." >&2
  exit 1
fi

release_sha="$(git rev-parse HEAD)"
temporary_directory="$(mktemp -d)"
trap 'rm -rf -- "$temporary_directory"' EXIT
release_archive="$temporary_directory/timesince-$release_sha.tar"

echo "Validating committed release $release_sha"
npm run check
git archive --format=tar --output="$release_archive" "$release_sha"

remote_archive="/tmp/timesince-release-$release_sha.tar"
remote_script="/tmp/timesince-deploy-host-$release_sha.sh"
scp "$release_archive" "$deploy_host:$remote_archive"
scp "$repository_root/scripts/deploy-host.sh" "$deploy_host:$remote_script"

echo "Deploying $release_sha to $deploy_host"
ssh -tt "$deploy_host" \
  "sudo /bin/bash '$remote_script' '$release_sha' '$remote_archive' '$deploy_root' '$service_name' '$environment_file' '$remote_node_binary' '$remote_npm_binary'"

echo "TimeSince release $release_sha deployed successfully."
