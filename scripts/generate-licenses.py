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
        if not files:
            raise RuntimeError(f"Missing licence text for {p['name']} {p['version']}")
        sections.append(f"\n{'=' * 72}\n{p['name']} {p['version']}\nSPDX: {p['license']}\n"
                        f"Source: https://crates.io/crates/{p['name']}/{p['version']}\n")
        for file in files:
            sections.append(f"\n--- {file.name} ---\n{file.read_text()}\n")
    return "".join(sections)


browser = graph("wasm32-unknown-unknown", {"foregather-wasm"})
host = subprocess.check_output(["rustc", "-vV"], text=True, cwd=root).split("host: ")[1].splitlines()[0]
native = graph(host, {"foregather-kit", "foregather-server"})
native.update(graph("x86_64-unknown-linux-gnu", {"foregather-kit", "foregather-server"}))
all_packages = {**native, **browser}
(root / "THIRD_PARTY_LICENSES.txt").write_text(bundle(all_packages))
(root / "packages/browser/THIRD_PARTY_LICENSES.txt").write_text(bundle(browser))
for name in ["foregather-kit", "foregather-wasm", "foregather-server"]:
    (root / "crates" / name / "LICENSE").write_text((root / "LICENSE").read_text())
