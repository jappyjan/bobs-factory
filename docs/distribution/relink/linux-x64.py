"""Bounded engineering relink of genuine upstream archives, never release acceptance."""

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import subprocess
import tarfile
import time
import urllib.request
import zipfile

from webkit_trial import modified_library_trial

GIB = 1024**3


def validate_native_identity(version, revision, javascript_identity, manifest):
    """Pinned Bun CLI abbreviates to nine characters; JS exposes the full SHA.

    The short CLI identifier alone cannot distinguish different source revisions
    with a common prefix. Inputs and output hashes provide the other bindings.
    """
    expected = (manifest["bunVersion"] + "\n",
                manifest["bunVersion"] + "+" + manifest["bunRevision"][:9] + "\n",
                manifest["bunVersion"] + "+" + manifest["bunRevision"] + "\n")
    if (version, revision, javascript_identity) != expected:
        raise RuntimeError(f"Unexpected native identity: {(version, revision, javascript_identity)!r}")


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        while block := f.read(4 * 1024**2):
            h.update(block)
    return h.hexdigest()


def restricted_graph(text):
    """Retain verbatim only the generated link/strip rules and edges.

    In particular there is no regeneration, codegen, fetch, cargo, smoke or
    upload edge. Ninja itself creates the real response file at execution.
    Reject unknown syntax rather than rewriting flags or dependency paths.
    """
    blocks = re.split(r"(?=^[^\s#])", text, flags=re.M)
    kept = []
    counts = {"rule link": 0, "rule strip": 0, "edge link": 0, "edge strip": 0}
    for block in blocks:
        header = block.splitlines()[0] if block else ""
        key = None
        if header in ("rule link", "rule strip"):
            key = header
        elif header.startswith("build "):
            unfolded = re.sub(r"\$\n\s*", "", block)
            match = re.match(r"build .*?: (link|strip) ", unfolded)
            if match:
                key = "edge " + match[1]
        if key:
            counts[key] += 1
            kept.append(block)
    if any(value != 1 for value in counts.values()):
        raise RuntimeError(f"Expected exactly one link and strip rule/edge: {counts}")
    return "ninja_required_version = 1.9\n\n" + "".join(kept)


class Diagnostic:
    def __init__(self, root, evidence):
        # This task owns a fresh directory. Never clean or reuse foreign state.
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=False)
        self.evidence = evidence.resolve()
        self.evidence.mkdir(parents=True, exist_ok=True)
        self.start = time.monotonic()
        self.deadline = self.start + 42 * 60
        self.records = []
        self.commands = []
        self.reserved = 0
        self.budget_checked = 0
        self.env = dict(os.environ)
        for key in list(self.env):
            if key in ("CI", "BUILDKITE", "GITHUB_ACTIONS", "GITHUB_TOKEN", "GH_TOKEN") or "TOKEN" in key:
                self.env.pop(key)
        self.receipt = {"purpose": "engineering diagnostic; no release/license acceptance",
                        "status": "pending", "unchangedNativeSmoke": False,
                        "modifiedNativeSmoke": False,
                        "unchangedRelink": False, "modifiedLibraryRelink": False,
                        "nativeSmoke": False, "exactBaseBytes": False,
                        "phase": "initializing", "host": platform.uname()._asdict()}

    def save(self):
        for name, value in [("result.json", self.receipt), ("downloads.json", self.records),
                            ("commands.json", self.commands)]:
            (self.evidence / name).write_text(json.dumps(value, indent=2) + "\n")

    def guard(self, additional=0):
        if time.monotonic() > self.deadline:
            raise RuntimeError("42-minute task deadline exceeded")
        if shutil.disk_usage(self.root).free - additional < 10 * GIB:
            raise RuntimeError("10 GiB free-space reserve would be violated")
        # Incremental reservations bound extraction/downloads before every write.
        # Periodic inventories also capture output growth by owned subprocesses.
        if time.monotonic() - self.budget_checked >= 10:
            self.reserved = 0
            for folder in (self.root, self.evidence):
                for p in folder.rglob("*"):
                    try:
                        if not p.is_symlink():
                            self.reserved += p.lstat().st_size
                    except FileNotFoundError:
                        pass  # Owned linker temporaries can disappear during inventory.
            self.budget_checked = time.monotonic()
        if self.reserved + additional > 25 * GIB:
            raise RuntimeError("25 GiB owned task budget would be exceeded")
        self.reserved += additional

    def run(self, argv, name, cwd=None, timeout=900):
        self.guard()
        record = {"argv": [str(a) for a in argv], "cwd": str(cwd or self.root), "log": name + ".log"}
        self.commands.append(record)
        self.save()
        print(name, flush=True)
        with (self.evidence / record["log"]).open("wb") as log:
            proc = subprocess.Popen(record["argv"], cwd=record["cwd"], env=self.env,
                                    stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                # Monitor this owned subprocess's resource bounds, not remote CI.
                until = min(self.deadline, time.monotonic() + timeout)
                while proc.poll() is None:
                    self.guard()
                    if time.monotonic() > until:
                        raise RuntimeError(f"{name}: command deadline exceeded")
                    time.sleep(2)
            except BaseException:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                proc.wait()
                raise
        record["exitCode"] = proc.returncode
        self.save()
        if proc.returncode:
            raise RuntimeError(f"{name}: exit {proc.returncode}; see {record['log']}")
        return (self.evidence / record["log"]).read_text(errors="replace")

    def download(self, record):
        target = self.root / "downloads" / record["file"]
        target.parent.mkdir(exist_ok=True)
        limit = record.get("size", record.get("maxBytes", GIB))
        self.guard()
        if limit > 25 * GIB - self.reserved or shutil.disk_usage(self.root).free - limit < 10 * GIB:
            raise RuntimeError(f"Download cannot fit task bounds: {record['file']}")
        h = hashlib.sha256()
        count = 0
        start = time.monotonic()
        req = urllib.request.Request(record["url"], headers={"User-Agent": "Taskbot116-relink-diagnostic"})
        with urllib.request.urlopen(req, timeout=60) as response, target.open("xb") as out:
            while block := response.read(4 * 1024**2):
                count += len(block)
                if count > limit or time.monotonic() - start > 12 * 60:
                    raise RuntimeError(f"Download bound exceeded: {record['file']}")
                self.guard(len(block))
                h.update(block)
                out.write(block)
        actual = {**record, "actualSize": count, "actualSha256": h.hexdigest()}
        self.records.append(actual)
        self.save()
        if h.hexdigest() != record["sha256"] or ("size" in record and count != record["size"]):
            raise RuntimeError(f"Download identity mismatch: {record['file']}")
        return target

    def extract(self, archive, dest, strip=0, select=None):
        dest.mkdir(parents=True, exist_ok=True)
        # Streaming limits precede each write; no full huge archive in memory.
        with tarfile.open(archive, "r|*") as tar:
            count = 0
            for member in tar:
                count += 1
                if count > 500000 or member.size > 4 * GIB:
                    raise RuntimeError("Archive member/header bound exceeded")
                parts = Path(member.name).parts
                if strip and len(parts) <= strip:
                    continue
                member.name = str(Path(*parts[strip:]))
                if select is not None and not select(member.name):
                    continue
                if member.islnk():
                    member.linkname = str(Path(*Path(member.linkname).parts[strip:]))
                if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                    raise RuntimeError(f"Unsupported archive entry: {member.name}")
                self.guard(member.size)
                tar.extract(member, dest, filter="data")

    def inventory(self, directory, filename):
        with (self.evidence / filename).open("w") as out:
            for path in sorted(directory.rglob("*")):
                if path.is_symlink():
                    r = {"path": str(path.relative_to(directory)), "symlink": os.readlink(path)}
                elif path.is_file():
                    r = {"path": str(path.relative_to(directory)), "size": path.stat().st_size,
                         "sha256": sha256(path)}
                else:
                    continue
                out.write(json.dumps(r) + "\n")

    def execute(self, manifest, here, mode):
        self.receipt["requestedMode"] = mode
        self.receipt["harnessSha256"] = sha256(here / "linux-x64.py")
        self.receipt["trialHarnessSha256"] = sha256(here / "webkit_trial.py")
        self.receipt["inputManifestSha256"] = sha256(here / "linux-x64-inputs.json")
        self.receipt["phase"] = "acquisition"
        self.receipt["pins"] = manifest
        self.save()
        files = {r["kind"]: self.download(r) for r in manifest["downloads"]
                 if r["kind"] not in ("sysroot-deb", "sysroot-index")}
        sysroot_debs = [(r, self.download(r)) for r in manifest["downloads"] if r["kind"] == "sysroot-deb"]
        # Index hashes document the selection. Linking uses only pinned package files;
        # a future mutable Packages.gz is not read to select different packages.
        self.receipt["phase"] = "toolchain-and-input-staging"
        source, build, cache, sysroot = [self.root / n for n in ("bun-source", "build", "cache", "sysroot")]
        self.extract(files["bun-source"], source, 1)
        # Keep the official binaries, runtime headers/libraries and shared
        # libraries; unrelated static development libraries need not occupy CI.
        self.extract(files["llvm"], self.root / "llvm", 1,
                     select=lambda name: name.startswith(("bin/", "lib/clang/")) or
                     (name.startswith("lib/") and (name.endswith(".so") or ".so." in name)))
        self.extract(files["node"], self.root / "node", 1)
        for kind in ("rustc", "cargo"):
            dest = self.root / (kind + "-installer")
            self.extract(files[kind], dest, 1)
            self.run(["sh", dest / "install.sh", "--prefix=" + str(self.root / "rust-toolchain"),
                      "--disable-ldconfig"], "install-" + kind)
        for directory in ("llvm", "rust-toolchain", "node"):
            self.inventory(self.root / directory, directory + "-files.jsonl")
        sysroot.mkdir()
        for r, deb in sysroot_debs:
            self.run(["dpkg-deb", "-x", deb, sysroot], "extract-" + r["package"])
        self.extract(files["gcc13"], self.root / "gcc13")
        for deb in sorted((self.root / "gcc13").glob("*.deb")):
            self.run(["dpkg-deb", "-x", deb, sysroot], "extract-gcc13-" + deb.stem)
        for path in sysroot.rglob("*"):
            if path.is_symlink() and os.readlink(path).startswith("/"):
                target = sysroot / os.readlink(path).lstrip("/")
                path.unlink()
                path.symlink_to(target)
        self.inventory(sysroot, "sysroot-files.jsonl")
        build.mkdir()
        for kind, relative in [("cpp", "libbun-profile.a"),
                               ("rust", "rust-target/x86_64-unknown-linux-gnu/release/libbun_runtime.a")]:
            out = build / relative
            out.parent.mkdir(parents=True, exist_ok=True)
            r = next(r for r in manifest["downloads"] if r["kind"] == kind)
            self.guard(r["expandedSize"])
            with gzip.open(files[kind]) as src, out.open("xb") as dst:
                size = 0
                while block := src.read(4 * 1024**2):
                    size += len(block)
                    if size > r["expandedSize"]:
                        raise RuntimeError(f"Expanded object bound exceeded: {kind}")
                    dst.write(block)
            if out.stat().st_size != r["expandedSize"] or sha256(out) != r["expandedSha256"]:
                raise RuntimeError(f"Expanded object identity mismatch: {kind}")
        webkit = cache / "webkit-2e2aa2290fac856d-lto"
        self.extract(files["webkit-cache"], webkit, 1)
        for r in manifest["webkitLibraries"]:
            path = webkit / "lib" / r["file"]
            if path.stat().st_size != r["size"] or sha256(path) != r["sha256"]:
                raise RuntimeError(f"WebKit library identity mismatch: {path}")
        self.inventory(webkit, "webkit-cache-files.jsonl")
        shutil.copyfile(files["order"], build / "linker.order")
        self.env.update(BUN_TOOLCHAIN_LLVM=str(self.root / "llvm"),
                        BUN_TOOLCHAIN_RUST=str(self.root / "rust-toolchain"),
                        CARGO_HOME=str(self.root / "cargo-home"), RUSTUP_HOME=str(self.root / "rustup-home"),
                        BUILDKITE_COMMIT=manifest["bunRevision"],
                        PATH=str(self.root / "node/bin") + ":" + str(self.root / "llvm/bin") + ":" + self.env["PATH"])
        # The published runtime is available only as the host tool for configure;
        # a generated relink output is the ONLY runtime used by the later smoke.
        base = self.root / "published-bun"
        base.mkdir()
        with zipfile.ZipFile(files["base-runtime"]) as z:
            entry = z.getinfo("bun-linux-x64/bun")
            if entry.file_size > GIB:
                raise RuntimeError("Published runtime expansion bound exceeded")
            self.guard(entry.file_size)
            with z.open(entry) as src, (base / "bun").open("xb") as dst:
                shutil.copyfileobj(src, dst)
        (base / "bun").chmod(0o755)
        if sha256(base / "bun") != manifest["expectedBaseRuntimeSha256"]:
            raise RuntimeError("Published base runtime identity mismatch")
        self.env["PATH"] = str(base) + ":" + self.env["PATH"]
        self.receipt["phase"] = "configure"
        self.save()
        argv = [self.root / "node/bin/node", "--experimental-strip-types", "scripts/build.ts",
                "--profile=ci-link-only", "--os=linux", "--arch=x64", "--abi=gnu",
                "--canary=off", "--buildkite=off", "--configure-only", "--build-dir=" + str(build),
                "--cache-dir=" + str(cache), "--linux-sysroot=" + str(sysroot)]
        self.run(argv, "configure-cli", source)
        self.run([self.root / "node/bin/node", here / "capture-config.mjs", source, build,
                  self.evidence / "resolved-config.json"], "capture-config", source)
        for path in (build / "build.ninja", build / "configure.json", build / "linker.order",
                     source / "src/symbols.dyn", source / "src/linker.lds", source / "rust-toolchain.toml"):
            shutil.copyfile(path, self.evidence / path.name)
        self.inventory(source / "scripts/build", "generator-files.jsonl")
        cfg = json.loads((self.evidence / "resolved-config.json").read_text())["cfg"]
        if sha256(cfg["bun"]) != manifest["expectedBaseRuntimeSha256"]:
            raise RuntimeError("Configure discovered an unexpected host Bun")
        tools = {"node": str(self.root / "node/bin/node"),
                 "llvm-objcopy": str(self.root / "llvm/bin/llvm-objcopy")}
        tools.update({k: cfg[k] for k in ("cc", "cxx", "ar", "ranlib", "ld", "strip", "cargo") if cfg.get(k)})
        tools["rustc"] = str(self.root / "rust-toolchain/bin/rustc")
        tools.update({name: shutil.which(name, path=self.env["PATH"])
                      for name in ("ninja", "cmake", "readelf")})
        identities = []
        for name, path in tools.items():
            version = self.run([path, "-vV" if name == "rustc" else "--version"], "version-" + name, source)
            identities.append({"name": name, "path": path, "resolvedPath": str(Path(path).resolve()),
                               "sha256": sha256(path), "version": version})
        (self.evidence / "tool-identities.json").write_text(json.dumps(identities, indent=2) + "\n")
        if "21.1.8" not in next(x["version"] for x in identities if x["name"] == "cc"):
            raise RuntimeError("LLVM 21.1.8 identity check failed")
        original = self.run(["ninja", "-C", build, "-t", "commands", "bun"], "original-ninja-commands")
        graph = restricted_graph((build / "build.ninja").read_text())
        (build / "relink-only.ninja").write_text(graph)
        shutil.copyfile(build / "relink-only.ninja", self.evidence / "relink-only.ninja")
        restricted = self.run(["ninja", "-C", build, "-f", "relink-only.ninja", "-t", "commands", "bun"],
                              "restricted-ninja-commands")
        if restricted != original or len(restricted.splitlines()) != 2:
            raise RuntimeError("Restricted graph changed generated link/strip commands")
        self.run(["ninja", "-C", build, "-f", "relink-only.ninja", "-n", "-v", "bun"], "link-dry-run")
        self.receipt["configure"] = True
        self.receipt["phase"] = "configured" if mode == "configure" else "unchanged-link"
        self.save()
        if mode == "configure":
            return
        self.inventory(build, "prelink-files.jsonl")
        try:
            self.run(["ninja", "-C", build, "-f", "relink-only.ninja", "-v", "-d", "keeprsp", "-j1", "bun"],
                     "unchanged-link", timeout=20 * 60)
        finally:
            # A failed linker still leaves its genuine Ninja-created response file.
            for path in (build / "bun-profile.rsp", build / "bun-profile.linker-map"):
                if path.exists():
                    shutil.copyfile(path, self.evidence / path.name)
        self.receipt["unchangedRelink"] = True
        self.receipt["outputSha256"] = sha256(build / "bun")
        self.receipt["profileSha256"] = sha256(build / "bun-profile")
        self.receipt["outputSize"] = (build / "bun").stat().st_size
        self.receipt["profileSize"] = (build / "bun-profile").stat().st_size
        self.receipt["exactBaseBytes"] = self.receipt["outputSha256"] == manifest["expectedBaseRuntimeSha256"]
        self.run(["readelf", "-aW", build / "bun"], "relinked-elf")
        self.run(["readelf", "-aW", base / "bun"], "published-elf")
        # This evidence records differences, never silently normalizes/masks them.
        self.receipt["residualAnalysis"] = "byte-identical" if self.receipt["exactBaseBytes"] else "UNPROVEN: inspect ELF reports/maps and tool/sysroot identities"
        shutil.copyfile(build / "bun-profile.linker-map", self.evidence / "unchanged-bun-profile.linker-map")
        self.native_smoke(build / "bun", source, manifest, "unchanged", 86400000)
        test_js = self.root / "standalone-smoke.js"
        test_js.write_text("console.log('taskbot116-relink-injection')\n")
        standalone = self.root / "standalone-smoke"
        self.run([build / "bun", "build", test_js, "--compile", "--outfile", standalone], "injection-compile", source)
        if self.run([standalone], "injection-native", source, timeout=60).strip() != "taskbot116-relink-injection":
            raise RuntimeError("Standalone injection smoke failed")
        self.receipt["unchangedNativeSmoke"] = True
        self.receipt["phase"] = "unchanged-link-and-smoke-completed"
        self.save()
        if mode == "modified":
            modified_library_trial(self, manifest, files, source, build, webkit, sysroot)
        self.receipt["nativeSmoke"] = True

    def native_smoke(self, binary, source, manifest, prefix, expected_date):
        version = self.run([binary, "--version"], prefix + "-native-version", source, timeout=60)
        revision = self.run([binary, "--revision"], prefix + "-native-revision", source, timeout=60)
        identity = self.run([binary, "-e", "console.log(Bun.version + '+' + Bun.revision)"],
                            prefix + "-native-full-identity", source, timeout=60)
        validate_native_identity(version, revision, identity, manifest)
        hello = self.run([binary, "-e", "console.log('taskbot116-relink-hello')"],
                         prefix + "-native-hello", source, timeout=60)
        if hello != "taskbot116-relink-hello\n":
            raise RuntimeError(f"Unexpected native hello: {hello!r}")
        # The same JS runs against both outputs. The trial modifies only the
        # first date; the second date and ordinary startup must remain usable.
        script = ("console.log(JSON.stringify([Date.parse('1970-01-02T00:00:00.000Z'),"
                  "Date.parse('1970-01-03T00:00:00.000Z'), 6*7]))")
        output = self.run([binary, "-e", script], prefix + "-native-library-behavior", source, timeout=60)
        if output != f"[{expected_date},172800000,42]\n":
            raise RuntimeError(f"Unexpected native library behavior: {output!r}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument("--mode", choices=("configure", "unchanged", "modified"), default="configure")
    args = parser.parse_args()
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        parser.error("Requires an isolated native Linux x64 host")
    here = Path(__file__).resolve().parent
    manifest = json.loads((here / "linux-x64-inputs.json").read_text())
    task = Diagnostic(args.root, args.evidence)
    try:
        task.execute(manifest, here, args.mode)
        if args.mode != "configure" and not task.receipt["nativeSmoke"]:
            raise RuntimeError("Required native smoke did not complete")
        if args.mode == "modified" and not (task.receipt["exactBaseBytes"] and
                                           task.receipt["modifiedLibraryRelink"] and
                                           task.receipt["modifiedNativeSmoke"]):
            raise RuntimeError("Required unchanged equivalence/modified library proof did not complete")
        task.receipt["status"] = "passed"
        task.receipt["phase"] = "PASS"
    except BaseException as error:
        task.receipt["error"] = str(error)
        task.receipt["failedPhase"] = task.receipt["phase"]
        task.receipt["phase"] = "FAIL"
        task.receipt["status"] = "failed"
        raise
    finally:
        for name in ("build.ninja", "configure.json", "linker.order", "bun-profile.rsp", "bun-profile.linker-map"):
            path = task.root / "build" / name
            if path.is_file():
                shutil.copyfile(path, task.evidence / name)
        task.receipt["elapsedSeconds"] = round(time.monotonic() - task.start, 3)
        task.save()


if __name__ == "__main__":
    main()
