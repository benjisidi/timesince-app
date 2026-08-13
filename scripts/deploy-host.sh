#!/usr/bin/env bash

set -euo pipefail

release_sha="${1:-}"
archive_path="${2:-}"
deploy_root="${3:-/opt/timesince}"
service_name="${4:-timesince}"
environment_file="${5:-/etc/timesince/timesince.env}"
node_override="${6:-auto}"
npm_override="${7:-auto}"

if [[ ! "$release_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Release SHA must be a full 40-character Git commit SHA." >&2
  exit 1
fi
if [[ "$archive_path" != "/tmp/timesince-release-$release_sha.tar" ]]; then
  echo "Unexpected release archive path." >&2
  exit 1
fi
if [[ ! "$deploy_root" =~ ^/[A-Za-z0-9._/-]+$ || ! "$environment_file" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
  echo "Deployment and environment paths must be simple absolute paths." >&2
  exit 1
fi
if [[ ! "$service_name" =~ ^[A-Za-z0-9_.@-]+$ ]]; then
  echo "Invalid systemd service name." >&2
  exit 1
fi
if [[ ! -f "$archive_path" || ! -f "$environment_file" ]]; then
  echo "The release archive and production environment file must both exist." >&2
  exit 1
fi
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "deploy-host.sh must run as root, normally through sudo." >&2
  exit 1
fi

resolve_binary() {
  local override="$1"
  local command_name="$2"
  if [[ "$override" != "auto" ]]; then
    if [[ ! "$override" =~ ^/[A-Za-z0-9._/-]+$ || ! -x "$override" ]]; then
      echo "Configured $command_name binary is not executable: $override" >&2
      exit 1
    fi
    printf '%s\n' "$override"
    return
  fi

  local detected
  detected="$(command -v "$command_name" || true)"
  if [[ -z "$detected" ]]; then
    echo "Could not find $command_name; provide its host path through the deployment environment." >&2
    exit 1
  fi
  printf '%s\n' "$detected"
}

node_binary="$(resolve_binary "$node_override" node)"
npm_binary="$(resolve_binary "$npm_override" npm)"
curl_binary="$(resolve_binary auto curl)"
systemctl_binary="$(resolve_binary auto systemctl)"
deployment_marker="/var/lib/timesince/deployment-in-progress"

if [[ -e "$deployment_marker" ]]; then
  echo "A previous deployment is incomplete ($deployment_marker exists). Resolve release/database compatibility manually before deploying again." >&2
  exit 1
fi

if ! "$node_binary" -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 22 && minor >= 13 ? 0 : 1)'; then
  echo "Production deployment requires Node 22.13 or newer in the Node 22 line; found $($node_binary --version)." >&2
  exit 1
fi

release_directory="$deploy_root/releases/$release_sha"
staging_directory="$deploy_root/releases/.staging-$release_sha-$$"
temporary_link="$deploy_root/.current-$release_sha-$$"
cleanup() {
  if [[ "$staging_directory" == "$deploy_root/releases/.staging-$release_sha-$$" ]]; then
    rm -rf -- "$staging_directory"
  fi
  rm -f -- "$temporary_link" "$archive_path"
  expected_script="/tmp/timesince-deploy-host-$release_sha.sh"
  if [[ "$0" == "$expected_script" ]]; then
    rm -f -- "$expected_script"
  fi
}
trap cleanup EXIT

mkdir -p "$deploy_root/releases"
if [[ ! -d "$release_directory" ]]; then
  mkdir "$staging_directory"
  tar -xf "$archive_path" -C "$staging_directory"
  export PATH="$(dirname "$node_binary"):$(dirname "$npm_binary"):$PATH"
  (
    cd "$staging_directory"
    env -u NODE_ENV "$npm_binary" ci
    env -u NODE_ENV "$npm_binary" run build
    "$npm_binary" prune --omit=dev
  )
  printf '%s\n' "$release_sha" >"$staging_directory/.timesince-release"
  chown -R root:root "$staging_directory"
  mv "$staging_directory" "$release_directory"
else
  recorded_sha="$(cat "$release_directory/.timesince-release" 2>/dev/null || true)"
  if [[ "$recorded_sha" != "$release_sha" ]]; then
    echo "Existing release directory does not contain the expected release marker." >&2
    exit 1
  fi
  echo "Release $release_sha is already built; reusing it."
fi

if ! "$systemctl_binary" cat "$service_name.service" >/dev/null 2>&1; then
  echo "systemd unit $service_name.service is not installed." >&2
  exit 1
fi

current_release=""
if [[ -L "$deploy_root/current" ]]; then
  current_release="$(readlink -f "$deploy_root/current")"
fi
database_path="$($node_binary --env-file="$environment_file" -e 'process.stdout.write(process.env.DATABASE_PATH || "")')"
if [[ ! "$database_path" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
  echo "DATABASE_PATH must be a simple absolute path in the production environment file." >&2
  exit 1
fi

if [[ -n "$current_release" || -e "$database_path" ]]; then
  echo "Taking verified pre-migration backup."
  (
    cd "$release_directory"
    NODE_ENV=production "$node_binary" --env-file="$environment_file" \
      dist/server/backup.js --label pre-migration
    NODE_ENV=production "$node_binary" --env-file="$environment_file" \
      dist/server/sync-backups.js
  )
fi

echo "Stopping $service_name before migrations and release cutover."
"$systemctl_binary" stop "$service_name.service"
install -o root -g root -m 0644 /dev/null "$deployment_marker"

echo "Applying explicit migrations from release $release_sha."
if ! (
  cd "$release_directory"
  NODE_ENV=production "$node_binary" --env-file="$environment_file" \
    dist/server/migrate.js --production
); then
  echo "Migration failed. The service remains stopped and the active release symlink was not changed." >&2
  echo "Restore the pre-migration backup before restarting the previous release." >&2
  exit 1
fi

ln -s "$release_directory" "$temporary_link"
mv -Tf "$temporary_link" "$deploy_root/current"

echo "Starting $service_name from $release_directory."
rm -f -- "$deployment_marker"
if ! "$systemctl_binary" start "$service_name.service"; then
  install -o root -g root -m 0644 /dev/null "$deployment_marker"
  echo "The new schema and release remain paired, but the service failed to start. It has not been rolled back automatically." >&2
  exit 1
fi

port="$($node_binary --env-file="$environment_file" -e 'process.stdout.write(process.env.PORT || "3000")')"
if [[ ! "$port" =~ ^[0-9]+$ || "$port" -lt 1 || "$port" -gt 65535 ]]; then
  "$systemctl_binary" stop "$service_name.service"
  install -o root -g root -m 0644 /dev/null "$deployment_marker"
  echo "Configured PORT is invalid; the service has been stopped." >&2
  exit 1
fi

health_url="http://127.0.0.1:$port/api/health"
healthy=false
for _attempt in {1..20}; do
  if "$curl_binary" --fail --silent --show-error "$health_url" | grep -q '"status":"ok"'; then
    healthy=true
    break
  fi
  sleep 1
done

if [[ "$healthy" != true ]]; then
  "$systemctl_binary" stop "$service_name.service"
  install -o root -g root -m 0644 /dev/null "$deployment_marker"
  echo "Health verification failed at $health_url; the new release remains selected and the service has been stopped." >&2
  echo "Inspect journalctl -u $service_name before deciding whether to fix forward or restore." >&2
  exit 1
fi

echo "Deployment healthy: $release_sha"
if [[ -n "$current_release" ]]; then
  echo "Previous release retained at: $current_release"
fi
