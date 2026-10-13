# Deployment

Use a native resolver binary built from the intended source version, a dedicated
private database directory and a trusted application-owned HTTPS gateway. Keep
Authorization, bodies and invitation URLs out of gateway/request logs. Configure
connection/header/request limits at that gateway. The resolver provides no
identity policy or default CORS allowance; the app owns user grant issuance.

The systemd unit uses a non-login `foregather` account, private state directory
and root-owned mode-0600 `/etc/foregather/foregather.env`. Install the binary and
bundled licence texts under `/opt/foregather` and the unit under
`/etc/systemd/system`. Set a real CSPRNG creation token privately. Restart after
configuration changes; stop old versions before upgrading a shared database.

The container uses a **prebuilt Linux binary**, preserving one Cargo target
cache. Build on the corresponding Linux architecture with
`cargo build --locked --release -p foregather-server`, then build
`docker build -f deploy/Dockerfile -t foregather .`. A macOS binary cannot be used
in the Linux image. Copy `foregather.env.example` privately to `foregather.env`,
configure it, and run `docker compose -f deploy/compose.yaml up -d`.
Only the host's loopback interface is published; terminate HTTPS at your gateway.

Set `FOREGATHER_ENABLE_LIVE=1` only for explicit experimental adoption. Live PAKE
and its new transport/composition have not received independent review. Deployable
packaging, local runtime tests, hosted container tests and actual public service
operation are distinct gates. These examples deploy no domain automatically.
