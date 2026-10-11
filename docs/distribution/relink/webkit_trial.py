"""One genuine WTF translation-unit trial using the official cached build record."""

import difflib
import hashlib
import json
from pathlib import Path
import shlex
import shutil


def file_record(path):
    path = Path(path)
    return {"path": str(path), "size": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def archive_members(path):
    """Inventory GNU ar members, including long names, without extracting files."""
    records, names = [], b""
    with Path(path).open("rb") as archive:
        if archive.read(8) != b"!<arch>\n":
            raise RuntimeError("Expected a regular GNU archive, not a thin archive")
        while header := archive.read(60):
            if len(header) != 60 or header[58:] != b"`\n":
                raise RuntimeError("Invalid ar member header")
            size = int(header[48:58])
            data = archive.read(size)
            if len(data) != size:
                raise RuntimeError("Truncated ar member")
            if size % 2:
                archive.read(1)
            name = header[:16].decode("ascii").strip()
            if name == "//":
                names = data
                continue
            if name in ("/", "/SYM64/"):
                continue  # llvm-ar must regenerate these symbol indexes.
            if name.startswith("/"):
                offset = int(name[1:])
                end = names.find(b"/\n", offset)
                if end < 0:
                    raise RuntimeError("Unresolved GNU ar long name")
                name = names[offset:end].decode("utf-8")
            else:
                name = name.removesuffix("/")
            records.append({"member": name, "size": size,
                            "sha256": hashlib.sha256(data).hexdigest()})
    return records


def assert_single_replacement(before, after, member, replacement):
    if [r["member"] for r in before] != [r["member"] for r in after]:
        raise RuntimeError("Archive replacement changed member count or order")
    changed = [a["member"] for a, b in zip(before, after) if a != b]
    if changed != [member]:
        raise RuntimeError(f"Expected only {member} to change, observed {changed}")
    actual = next(r for r in after if r["member"] == member)
    if actual["sha256"] != replacement["sha256"] or actual["size"] != replacement["size"]:
        raise RuntimeError("Archive does not contain the compiled replacement bytes")


def modified_library_trial(task, manifest, files, bun_source, build, cache, sysroot):
    task.receipt["phase"] = "modified-library-inputs"
    task.save()
    if not task.receipt["exactBaseBytes"]:
        raise RuntimeError("Modified trial requires actual byte-identical unchanged output")
    trial = task.root / "webkit-trial"
    trial.mkdir()
    # These two unmodified source files were independently matched to exact Git
    # blobs in the complete retained WebKit tree before recording download pins.
    source = trial / "DateMath.cpp"
    shutil.copyfile(files["webkit-date-source"], source)
    shutil.copyfile(files["webkit-config-source"], trial / "config.h")
    shutil.copyfile(source, task.evidence / "DateMath-original.cpp.raw")
    shutil.copyfile(trial / "config.h", task.evidence / "WTF-config.h.raw")
    compile_db = cache / "compile_commands.json"
    if file_record(compile_db)["sha256"] != manifest["webkitCompileCommandsSha256"]:
        raise RuntimeError("Official cache compile_commands identity mismatch")
    matches = [r for r in json.loads(compile_db.read_text())
               if r["file"] == "/webkit/Source/WTF/wtf/DateMath.cpp"]
    if len(matches) != 1:
        raise RuntimeError("Missing unique DateMath.cpp compile command in verified official cache")
    original = matches[0]
    (task.evidence / "original-webkit-compile-command.json").write_text(json.dumps(original, indent=2) + "\n")
    original_args = shlex.split(original["command"])
    if original_args[0] != "/usr/bin/clang++-21" or "-flto=thin" not in original_args:
        raise RuntimeError("Unexpected original WebKit compiler/LTO configuration")
    # The installed cache exports original and generated headers in include/;
    # its build-host hmaps, build directories and PCH are not shipped. This TU
    # has no PCH. Replace only header lookup/path arguments, never ABI/defines/
    # optimization flags. Use the same verified Focal/GCC13 target closure.
    args = [str(task.root / "llvm/bin/clang++")]
    remaps = [{"original": original_args[0], "replacement": args[0]}]
    includes = [cache / "include", cache / "include/wtf", cache / "include/bmalloc", trial]
    it = iter(original_args[1:])
    for arg in it:
        if arg.startswith("-I"):
            remaps.append({"original": arg, "replacement": ["-I" + str(p) for p in includes]})
        elif arg in ("-o", "-c"):
            remaps.append({"original": [arg, next(it)], "replacement": "per-stage owned output/source"})
        elif arg.startswith("-ffile-prefix-map="):
            remaps.append({"original": arg, "replacement": "owned source/cache prefix mappings"})
        else:
            args.append(arg)
    args += ["-I" + str(p) for p in includes]
    args += ["--sysroot=" + str(sysroot), "--gcc-toolchain=" + str(sysroot / "usr"),
             "-ffile-prefix-map=" + str(trial) + "=vendor/WebKit/Source/WTF/wtf",
             "-ffile-prefix-map=" + str(cache / "include") + "=webkit-cache/include"]
    additions = args[-4:]
    recipe = {"original": original, "remaps": remaps, "addedTargetClosureAndPrefixFlags": additions,
              "headerStrategy": "official verified cache exported headers, including cmakeconfig.h; no invented generated header",
              "compileCommands": file_record(compile_db), "source": file_record(source),
              "config": file_record(trial / "config.h")}
    (task.evidence / "webkit-compile-remaps.json").write_text(json.dumps(recipe, indent=2) + "\n")
    library = cache / "lib/libWTF.a"
    original_lib = trial / "libWTF-original.a"
    shutil.copyfile(library, original_lib)
    before = archive_members(library)
    member = "DateMath.cpp.o"
    if sum(r["member"] == member for r in before) != 1:
        raise RuntimeError("No unique DateMath.cpp.o in actual WebKit archive")
    obj = trial / member
    # Extract through llvm-ar, preserving the genuine original member bytes.
    task.run(["sh", "-c", '"$1" p "$2" "$3" > "$4"', "owned-ar-extract",
              task.root / "llvm/bin/llvm-ar", library, member, trial / "DateMath-original.cpp.o"],
             "webkit-original-object")
    original_obj = trial / "DateMath-original.cpp.o"
    if file_record(original_obj)["sha256"] != next(r["sha256"] for r in before if r["member"] == member):
        raise RuntimeError("Original member extraction mismatch")
    shutil.copyfile(original_obj, task.evidence / "DateMath-original.cpp.o.raw")
    task.receipt["phase"] = "webkit-translation-unit-compile"
    task.save()
    for stage in ("unmodified", "modified"):
        if stage == "modified":
            text = source.read_text()
            start = "double parseES5Date(std::span<const Latin1Character> dateString, bool& isLocalTime)\n{\n    isLocalTime = false;"
            if text.count(start) != 1:
                raise RuntimeError("Pinned source function does not match trial patch precondition")
            changed = text.replace(start, start + "\n\n    // Taskbot116 isolated relink probe; never a production runtime.\n"
                                   "    static constexpr char relinkProbe[] = \"1970-01-02T00:00:00.000Z\";\n"
                                   "    if (dateString.size() == sizeof(relinkProbe) - 1\n"
                                   "        && std::equal(dateString.begin(), dateString.end(), relinkProbe))\n"
                                   "        return 116000000;", 1)
            source.write_text(changed)
            (task.evidence / "DateMath-trial.patch").write_text("".join(difflib.unified_diff(
                text.splitlines(True), changed.splitlines(True), fromfile="a/Source/WTF/wtf/DateMath.cpp",
                tofile="b/Source/WTF/wtf/DateMath.cpp")))
            shutil.copyfile(source, task.evidence / "DateMath-modified.cpp.raw")
        deps = trial / (stage + ".d")
        task.run(args + ["-MD", "-MF", str(deps), "-o", str(obj), "-c", str(source)],
                 "webkit-compile-" + stage, trial, timeout=5 * 60)
        if obj.read_bytes()[:4] != b"BC\xc0\xde":
            raise RuntimeError("Compiler did not emit genuine LLVM bitcode")
        shutil.copyfile(obj, trial / ("DateMath-" + stage + ".cpp.o"))
        shutil.copyfile(obj, task.evidence / ("DateMath-" + stage + ".cpp.o.raw"))
        shutil.copyfile(deps, task.evidence / ("webkit-" + stage + ".d"))
        paths = shlex.split(deps.read_text().replace("\\\n", " ").split(":", 1)[1])
        closure = []
        for name in sorted(set(paths)):
            path = Path(name) if Path(name).is_absolute() else trial / name
            resolved = path.resolve()
            if not resolved.is_relative_to(task.root):
                raise RuntimeError(f"Compilation used a header outside the owned closure: {resolved}")
            closure.append(file_record(resolved))
        (task.evidence / ("webkit-" + stage + "-compile-closure.json")).write_text(json.dumps(closure, indent=2) + "\n")
    task.receipt["phase"] = "webkit-single-member-replacement"
    task.save()
    task.run([task.root / "llvm/bin/llvm-ar", "rD", "--format=gnu", library, obj], "webkit-replace-member", trial)
    after = archive_members(library)
    assert_single_replacement(before, after, member, file_record(obj))
    identities = {"originalLibrary": file_record(original_lib), "modifiedLibrary": file_record(library),
                  "originalObject": file_record(original_obj),
                  "unmodifiedRecompiledObject": file_record(trial / "DateMath-unmodified.cpp.o"),
                  "modifiedObject": file_record(obj), "modifiedSource": file_record(source),
                  "beforeMembers": before, "afterMembers": after}
    # Every other genuine application/WebKit link input must be unchanged.
    for r in manifest["webkitLibraries"]:
        if r["file"] != "libWTF.a" and file_record(cache / "lib" / r["file"])["sha256"] != r["sha256"]:
            raise RuntimeError(f"Unexpected change to other WebKit input: {r['file']}")
    for r in manifest["downloads"]:
        if r["kind"] in ("cpp", "rust"):
            path = build / ("libbun-profile.a" if r["kind"] == "cpp" else "rust-target/x86_64-unknown-linux-gnu/release/libbun_runtime.a")
            if file_record(path)["sha256"] != r["expandedSha256"]:
                raise RuntimeError("Application archive changed during library trial")
    (task.evidence / "webkit-trial-identities.json").write_text(json.dumps(identities, indent=2) + "\n")
    task.receipt["modifiedLibrary"] = identities["modifiedLibrary"]
    task.receipt["phase"] = "modified-library-link"
    task.save()
    # The cached library is an explicit generated link input. Require the real
    # unchanged link/strip commands and force only their owned output rebuild.
    unchanged_binary = trial / "bun-unchanged"
    shutil.copyfile(build / "bun", unchanged_binary)
    for name in ("bun", "bun-profile"):
        (build / name).unlink()
    task.run(["ninja", "-C", build, "-f", "relink-only.ninja", "-v", "-d", "keeprsp", "-j1", "bun"],
             "modified-library-link", timeout=15 * 60)
    for name in ("bun-profile.rsp", "bun-profile.linker-map"):
        shutil.copyfile(build / name, task.evidence / ("modified-" + name))
    task.receipt["modifiedOutput"] = file_record(build / "bun")
    task.receipt["modifiedProfile"] = file_record(build / "bun-profile")
    if task.receipt["modifiedOutput"]["sha256"] == task.receipt["outputSha256"]:
        raise RuntimeError("Modified source library produced unchanged runtime bytes")
    task.receipt["modifiedLibraryRelink"] = True
    task.receipt["phase"] = "modified-library-native-smoke"
    task.save()
    task.native_smoke(build / "bun", bun_source, manifest, "modified", 116000000)
    # Recheck retained unmodified output against the same test after the trial.
    task.native_smoke(unchanged_binary, bun_source, manifest, "unchanged-recheck", 86400000)
    task.receipt["modifiedNativeSmoke"] = True
    task.receipt["phase"] = "modified-library-and-smoke-completed"
