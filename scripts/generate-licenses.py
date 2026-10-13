"""Bundle the actual dependency licence texts; no third-party API required."""
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent.parent


def graph(target, names):
    data = json.loads(subprocess.check_output(
        ["cargo", "metadata", "--locked", "--format-version", "1", "--filter-platform", target], cwd=root))
    packages = {p["id"]: p for p in data["packages"]}
    nodes = {n["id"]: n for n in data["resolve"]["nodes"]}
    pending = [p["id"] for p in data["packages"] if p["source"] is None and p["name"] in names]
    seen = set()
    while pending:
        pid = pending.pop()
        if pid in seen:
            continue
        seen.add(pid)
        pending.extend(d["pkg"] for d in nodes[pid]["deps"])
    return {pid: packages[pid] for pid in seen if packages[pid]["source"] is not None}


def bundle(packages):
    sections = ["Foregather dependency licences\n\n"
                "Foregather: MIT, Copyright (c) 2026 TheCryptoDonkey.\n"
                "Dependency code retains the following notices and licences.\n"
                "For an OR expression, MIT is selected when available, otherwise Apache-2.0.\n"
                "Conjunctive BSD/Unicode requirements are retained.\n"]
    for p in sorted(packages.values(), key=lambda p: (p["name"], p["version"])):
        directory = Path(p["manifest_path"]).parent
        files = sorted(f for f in directory.iterdir() if f.is_file() and
                       (f.name.upper().startswith(("LICENSE", "LICENCE", "COPYING", "UNLICENSE")) or f.name.upper() == "NOTICE"))
        if not files and p['name'] in {"uniffi", "uniffi_core", "uniffi_internal_macros", "uniffi_macros", "uniffi_meta", "uniffi_pipeline"} and p['version'] == '0.32.2':
            # The published crates reference the upstream repository's MPL text
            # without including that file. Keep the exact tagged source text.
            files = [root / "packages/native/licenses/uniffi-MPL-2.0.txt"]
        if not files:
            raise RuntimeError(f"Missing licence text for {p['name']} {p['version']}")
        sections.append(f"\n{'=' * 72}\n{p['name']} {p['version']}\nSPDX: {p['license']}\n"
                        f"Source: https://crates.io/crates/{p['name']}/{p['version']}\n")
        for file in files:
            text = "\n".join(line.rstrip() for line in file.read_text().splitlines())
            sections.append(f"\n--- {file.name} ---\n{text}\n")
    return "".join(sections).rstrip() + "\n"


qr_source = (root / "packages/browser/src/vendor/qrcodegen.ts").read_text()
qr_notice = "\n".join(line.rstrip() for line in qr_source[:qr_source.index('*/') + 2].splitlines())
js_notice = (root / "node_modules/jsqr/LICENSE").read_text().rstrip() + "\n"
qr_licences = "\n\nQR presentation dependencies\n\nProject Nayuki QR-Code-generator\nPinned commit: 3c6d0b3cefb4e049dc337e82237c9644399716a8\n" + qr_notice + "\n\njsQR 1.4.0, Copyright (c) Cosmo Wolfe and contributors\nSource: https://github.com/cozmo/jsQR\n" + js_notice
browser = graph("wasm32-unknown-unknown", {"foregather-wasm"})
host = subprocess.check_output(["rustc", "-vV"], text=True, cwd=root).split("host: ")[1].splitlines()[0]
native = graph(host, {"foregather-kit", "foregather-server", "foregather-ffi"})
native.update(graph("x86_64-unknown-linux-gnu", {"foregather-kit", "foregather-server", "foregather-ffi"}))
all_packages = {**native, **browser}
jna_licence = "\n\nJNA 5.19.1; Apache-2.0 selected. Source: https://github.com/java-native-access/jna/tree/5.19.1\n" + (root / "packages/native/licenses/jna-Apache-2.0.txt").read_text()
(root / "THIRD_PARTY_LICENSES.txt").write_text((bundle(all_packages) + qr_licences + jna_licence).rstrip() + "\n")
(root / "packages/browser/THIRD_PARTY_LICENSES.txt").write_text((bundle(browser) + qr_licences).rstrip() + "\n")
for name in ["foregather-kit", "foregather-wasm", "foregather-server", "foregather-ffi"]:
    (root / "crates" / name / "LICENSE").write_text((root / "LICENSE").read_text())
