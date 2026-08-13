# TimeSince production deployment

TimeSince runs as a systemd-managed Node 22 service. Tailscale Serve terminates
private tailnet HTTPS and proxies to the application on `127.0.0.1:3000`.
SQLite data, configuration, backups, and application releases are kept
separate.

This guide deliberately keeps migrations explicit. Application startup never
applies migrations.

## Production layout

```text
/opt/timesince/
  releases/<git-sha>/
  current -> releases/<git-sha>

/var/lib/timesince/
  timesince.sqlite

/etc/timesince/
  timesince.env

/var/backups/timesince/
  daily/
  pre-migration/
  manual/
```

The SQLite `-wal` and `-shm` companions may appear beside the production
database while TimeSince is running. They are part of SQLite's normal WAL-mode
operation, not release artifacts.

## 1. Prepare a fresh host

Install or verify these host tools:

- Node.js 22 and its matching npm;
- `curl`, `rclone`, `tar`, OpenSSH, and systemd;
- Tailscale.

The repository does not prescribe a Node installer. Use a maintained package
source or verified official binary appropriate to the host. Confirm that both
root and the service account can run the selected Node binary:

```sh
node --version
npm --version
```

Node must report major version 22. If Node is outside systemd's normal search
path, set `PATH` in `timesince.env`. The deployment command also supports
explicit remote paths through `TIMESINCE_NODE_BINARY` and
`TIMESINCE_NPM_BINARY`.

Create the dedicated account and directories:

```sh
if ! id timesince >/dev/null 2>&1; then
  sudo useradd --system --home-dir /var/lib/timesince --shell /usr/sbin/nologin timesince
fi
sudo install -d -o root -g root -m 0755 /opt/timesince /opt/timesince/releases
sudo install -d -o timesince -g timesince -m 0750 /var/lib/timesince
sudo install -d -o timesince -g timesince -m 0750 /var/backups/timesince
sudo install -d -o root -g timesince -m 0750 /etc/timesince
```

Transfer the environment template and systemd units from the development
checkout to a temporary directory on the host:

```sh
scp deploy/timesince.env.example deploy/systemd/timesince* deployer@timesince-host:/tmp/
```

Then install the template as `/etc/timesince/timesince.env`, edit it, and
protect it:

```sh
if ! sudo test -e /etc/timesince/timesince.env; then
  sudo install -o root -g timesince -m 0640 /tmp/timesince.env.example /etc/timesince/timesince.env
fi
sudoedit /etc/timesince/timesince.env
```

Required application values are:

```text
NODE_ENV=production
TIME_ZONE=Europe/London
DATABASE_PATH=/var/lib/timesince/timesince.sqlite
PORT=3000
```

`DATABASE_PATH` must be absolute and outside `/opt/timesince`. Production
startup, migration, backup, and restore tooling all reject missing, relative,
or release-local database paths.

Install the service units:

```sh
sudo install -o root -g root -m 0644 /tmp/timesince.service /etc/systemd/system/timesince.service
sudo install -o root -g root -m 0644 /tmp/timesince-backup.service /etc/systemd/system/timesince-backup.service
sudo install -o root -g root -m 0644 /tmp/timesince-backup.timer /etc/systemd/system/timesince-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable timesince.service
```

Do not start the application until the first release has been deployed and its
migrations have succeeded.

## 2. Configure the off-host backup target

Daily backup is not considered fully configured until the `timesince` service
user can access the configured rclone Google Drive remote. Set:

```text
RCLONE_REMOTE=gdrive
RCLONE_BACKUP_PATH=TimeSince/backups
RCLONE_CONFIG=/var/lib/timesince/rclone/rclone.conf
```

`RCLONE_REMOTE` is the configured remote name without `:`. The backup path is a
relative path within that remote. `RCLONE_CONFIG` is optional when rclone can
find the correct configuration for the service account, but an explicit
service-owned configuration is more predictable for systemd and permits rclone
to persist refreshed Google Drive credentials:

```sh
sudo install -d -o timesince -g timesince -m 0700 /var/lib/timesince/rclone
sudo install -o timesince -g timesince -m 0600 /path/to/configured/rclone.conf /var/lib/timesince/rclone/rclone.conf
sudo -u timesince rclone --config /var/lib/timesince/rclone/rclone.conf listremotes
sudo -u timesince rclone --config /var/lib/timesince/rclone/rclone.conf lsd gdrive:
```

Replace `gdrive` with the actual configured remote. Do not place Google Drive
credentials in the Git repository or the environment file.

The sync uses `rclone copy /var/backups/timesince
gdrive:TimeSince/backups`. It deliberately does not use `rclone sync`, so local
retention cannot delete remote backups. A failed remote copy makes the backup
unit fail visibly in journald, but it does not remove the successfully verified
local backup. The next run retries all retained local files.

Local retention is controlled by `BACKUP_RETENTION_COUNT` and defaults to 30
files per backup label. Google Drive retention will normally be longer because
the copy command never deletes remote files. Remote cleanup is a separate
manual policy and is not part of this workflow.

## 3. Deploy the first release

On the development machine, use Node 22 and set the SSH destination:

```sh
nvm use
export TIMESINCE_DEPLOY_HOST=deployer@timesince-host
./scripts/deploy-production.sh
```

The command refuses a dirty worktree, selects the exact committed `HEAD`, runs
the full repository check, transfers a Git archive, builds it on the host,
applies migrations explicitly, switches `/opt/timesince/current` atomically,
starts the service, and polls the database-aware health endpoint.

The remote deployment user must be able to run the transferred host script
with `sudo`. If Node or npm are not discoverable in sudo's path:

```sh
export TIMESINCE_NODE_BINARY=/absolute/host/path/to/node
export TIMESINCE_NPM_BINARY=/absolute/host/path/to/npm
./scripts/deploy-production.sh
```

After the first successful deployment, enable the daily timer and prove the
local and off-host paths:

```sh
sudo systemctl enable --now timesince-backup.timer
sudo systemctl start timesince-backup.service
sudo systemctl status timesince-backup.service
sudo journalctl -u timesince-backup.service --since today
```

## 4. Configure Tailscale HTTPS

Install Tailscale using its current Ubuntu instructions, enable `tailscaled`,
and join the host to the private tailnet. Choose a stable machine name. Enable
MagicDNS and HTTPS certificates in the Tailscale admin console, then proxy the
loopback application:

```sh
sudo tailscale serve --bg http://127.0.0.1:3000
tailscale serve status
```

Do not enable Funnel. Do not open port 3000 in UFW, the router, or another
public firewall. Tailnet ACLs or grants should restrict the host to the intended
user and devices if the tailnet is not already single-user.

Verify the boundary:

```sh
ss -ltnp
tailscale serve status
tailscale funnel status
curl --fail http://127.0.0.1:3000/api/health
```

Node must appear only on `127.0.0.1:3000`. Test the HTTPS origin from intended
tailnet desktop and mobile devices, and confirm it is unreachable from a device
that is not connected to the tailnet.

## 5. Routine updates

The normal update remains one command:

```sh
export TIMESINCE_DEPLOY_HOST=deployer@timesince-host
./scripts/deploy-production.sh
```

For an existing installation, the host half performs this sequence:

1. build the new immutable release;
2. make and integrity-check a pre-migration SQLite backup;
3. sync retained backups off-host;
4. stop TimeSince;
5. run the new release's migration bundle against the absolute production DB;
6. atomically switch `current` to the new release;
7. start TimeSince and verify `/api/health`.

If migration fails, `current` remains unchanged and the service remains
stopped. Do not restart the previous release against a database that may have
been partially migrated. Inspect the migration output and restore the
pre-migration backup before restarting the previous release. Deployment writes
`/var/lib/timesince/deployment-in-progress` before migration; the systemd unit
will not start after a reboot while that marker exists.

If startup or health verification fails after migration, the new release
remains selected but the service is stopped. Fix forward if straightforward;
otherwise restore the pre-migration backup and then repoint `current` to the
previous release. Remove the deployment marker only after the chosen release
and restored/migrated schema are compatible. There are no automatic
down-migrations.

Old releases remain under `/opt/timesince/releases`. Remove them manually only
after the new release and its backups have been used successfully. Never remove
`/var/lib/timesince` as part of release cleanup.

## 6. Migrations

Development migration is explicitly development-scoped:

```sh
npm run db:migrate
```

The host deployment runs the compiled production migration command with
`--production`, `NODE_ENV=production`, and `/etc/timesince/timesince.env`.
For diagnosis, the equivalent host command is:

```sh
cd /opt/timesince/current
sudo -u timesince NODE_ENV=production /usr/bin/env node \
  --env-file=/etc/timesince/timesince.env \
  dist/server/migrate.js --production
```

Running it again is safe and reports that the database is already current.
Application startup never invokes this command.

## 7. Logs, restart, and health

```sh
sudo systemctl status timesince.service
sudo journalctl -u timesince.service
sudo journalctl -u timesince.service --since today
sudo systemctl restart timesince.service
sudo systemctl stop timesince.service
sudo systemctl start timesince.service
curl --fail http://127.0.0.1:3000/api/health
```

The health endpoint returns `status: ok` only when Express can read the core
migrated SQLite tables.

To validate supervision, terminate the Node process without stopping the unit
and confirm systemd restarts it. Reboot the host and confirm the application,
daily timer, Tailscale, and Tailscale Serve configuration all return.

## 8. Backups

The application uses SQLite's online backup API through `better-sqlite3`.
It does not copy a live WAL-mode database file. Each completed backup is:

- written through a temporary file and renamed only after success;
- checked with `PRAGMA integrity_check`;
- accompanied by a SHA-256 file;
- stored with restrictive permissions.

Inspect backup state with:

```sh
systemctl list-timers timesince-backup.timer
sudo systemctl start timesince-backup.service
sudo journalctl -u timesince-backup.service
sudo find /var/backups/timesince -maxdepth 2 -type f -print
```

A manual verified backup can be created with:

```sh
cd /opt/timesince/current
sudo -u timesince NODE_ENV=production /usr/bin/env node \
  --env-file=/etc/timesince/timesince.env \
  dist/server/backup.js --label manual
sudo -u timesince NODE_ENV=production /usr/bin/env node \
  --env-file=/etc/timesince/timesince.env \
  dist/server/sync-backups.js
sudo -u timesince rclone \
  --config /var/lib/timesince/rclone/rclone.conf \
  lsf gdrive:TimeSince/backups --recursive
```

The final command should list the timestamped `.sqlite` backup and its
`.sha256` sidecar on Google Drive. Replace the remote and path with the values
from `timesince.env`.

## 9. Restore

Restoration is deliberately manual. Select an absolute local backup path, then:

1. verify or retrieve it from the off-host destination;
2. stop TimeSince;
3. run the guarded restore command;
4. start TimeSince and verify health and known application records.

```sh
sudo systemctl stop timesince.service
cd /opt/timesince/current
sudo -u timesince NODE_ENV=production /usr/bin/env node \
  --env-file=/etc/timesince/timesince.env \
  dist/server/restore.js \
  --backup /absolute/path/to/timesince-daily-TIMESTAMP.sqlite \
  --confirm-database /var/lib/timesince/timesince.sqlite \
  --confirm-service-stopped
sudo systemctl start timesince.service
curl --fail http://127.0.0.1:3000/api/health
```

The restore verifies the checksum when present, runs SQLite integrity checks,
stages the restored database on the production filesystem, and moves the
previous database/WAL companions to timestamped `.pre-restore-*` files. Retain
those recovery files until the restored application has been checked.

After recovery from a failed migration, repoint `/opt/timesince/current` to the
release matching the restored schema before removing the deployment marker.
Use a temporary symlink and `mv -T` as in the deployment script; do not edit the
live symlink in several steps:

```sh
sudo ln -s /opt/timesince/releases/PREVIOUS_FULL_GIT_SHA /opt/timesince/.current-recovery
sudo mv -Tf /opt/timesince/.current-recovery /opt/timesince/current
```

Once the release/schema pair is correct:

```sh
sudo rm -f /var/lib/timesince/deployment-in-progress
sudo systemctl start timesince.service
```

### Required restore proof before real use

Before entering important data:

1. create a recognisable temporary task;
2. run a manual backup and confirm it is off-host;
3. change or archive that task;
4. restore the backup using the procedure above;
5. confirm the earlier task state through the HTTPS PWA;
6. deploy the same or a newer committed release and confirm the restored state
   survives.

This is the acceptance test that proves the backup is operational rather than
merely present.

## 10. Production PWA validation

Use the real Tailscale HTTPS origin on representative desktop and mobile
devices:

- confirm the manifest, standard/maskable icons, root scope, and installability;
- install and launch in standalone mode;
- inspect service-worker registration, active/waiting lifecycle, and caches;
- confirm Cache Storage contains shell/static assets and no `/api` responses;
- stop the backend and launch the installed shell;
- confirm backend-unavailable wording and failed-write rollback;
- confirm no mutation is queued or replayed after reconnecting;
- restart the backend and verify Retry/online recovery;
- deploy a genuinely changed client build, observe the update prompt, and
  confirm reload occurs only after accepting it;
- confirm direct navigation works for Ready, Browse, category management, and
  archived-task routes.

Record desktop/mobile device, browser, origin, and result in the Milestone 18
completion notes.

## 11. Final production acceptance

Milestone 18 is complete only after the real host demonstrates:

- successful application and host restarts;
- systemd failure restart;
- data persistence through at least one repeated deployment;
- deliberate migration and safe no-op rerun;
- a successful daily local and off-host backup;
- a successful restore of application state;
- private desktop/mobile access over Tailscale HTTPS;
- negative public exposure testing;
- production-origin PWA installation, update, offline-shell, and reconnect
  behaviour.
