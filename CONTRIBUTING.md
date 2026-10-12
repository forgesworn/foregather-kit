# Contributing

MIT. Copyright (c) 2026 TheCryptoDonkey. Contributions use the same licence;
preserve third-party notices and attribution.

Start with [the documentation index](docs/README.md) and [AGENTS.md](AGENTS.md).
Foregather transfers invitations; each application retains identity, consent,
replay policy and admission authority. Use synthetic data in tests and reports.
Report suspected vulnerabilities privately through [SECURITY.md](SECURITY.md).

Use Node 24, Rust 1.94.1, the wasm32-unknown-unknown target and wasm-bindgen
0.2.129. Run `npm ci`, `npx playwright install chromium`, then `npm run check`.
Rust builds use this checkout's `target/`; do not allocate a fresh target per task.
Run `node scripts/check-package.mjs` to install and compile an isolated consumer
of the actual browser tarball, including TypeScript positive and negative cases.
Run `cargo package --locked -p foregather-kit --all-features --allow-dirty`,
`cargo audit`, `cargo deny check licenses sources` and `npm audit`.
The independent Python reference command is in [the live protocol](docs/live-protocol.md).

Include the problem, changed behaviour and checks run in your pull request.
Changes to protocol bytes require a distinct version/profile, frozen vectors,
interoperability checks and documentation. Existing v1 vectors must remain intact.
Do not weaken validation, attempt budgets or authority boundaries to make a test
pass. Avoid new hosted service requirements or external JavaScript runtime packages.

Core public Rust APIs require Rustdoc. Keep examples executable and descriptions
explicit about clocks, randomness, secret handling and caller responsibilities.
Update the validation record without treating local tests, CI, publication,
physical device acceptance or independent security review as interchangeable.
