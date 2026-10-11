"""Guard against unintended rebuild execution and unsafe archive extraction."""

import importlib.util
import io
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

spec = importlib.util.spec_from_file_location("relink", Path(__file__).with_name("linux-x64.py"))
relink = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relink)
from webkit_trial import assert_single_replacement, archive_members, copy_executable


class SafetyTests(unittest.TestCase):
    def test_copied_cached_runtime_remains_directly_executable(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "cached-runtime"
            copied = root / "unchanged-runtime"
            source.write_text("#!/bin/sh\nprintf 'native runtime ran\\n'\n")
            source.chmod(0o755)

            copy_executable(source, copied)
            result = subprocess.run([copied], check=True, capture_output=True, text=True)
            self.assertEqual(result.stdout, "native runtime ran\n")

    def test_modified_effect_cannot_pass_with_baseline_or_broken_control(self):
        relink.validate_native_library_behavior("[86400000,172800000,42]\n", 86400000)
        relink.validate_native_library_behavior("[116000000,172800000,42]\n", 116000000)
        for output in ("[86400000,172800000,42]\n", "[116000000,116000000,42]\n",
                       "[116000000,172800000,0]\n", "[116000000,172800000,42]"):
            with self.assertRaises(RuntimeError):
                relink.validate_native_library_behavior(output, 116000000)

    def test_gnu_archive_inventory_and_single_compiled_member_replacement(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "library.a"
            data = b"!<arch>\n"
            for name, content in [("DateMath.cpp.o/", b"BC\xc0\xdeoriginal"), ("other.cpp.o/", b"BC\xc0\xdeother")]:
                header = f"{name:<16}{0:<12}{0:<6}{0:<6}{'644':<8}{len(content):<10}`\n".encode()
                data += header + content + (b"\n" if len(content) % 2 else b"")
            path.write_bytes(data)
            before = archive_members(path)
            self.assertEqual([r["member"] for r in before], ["DateMath.cpp.o", "other.cpp.o"])
            after = [{**before[0], "size": 100, "sha256": "compiled-object-sha"}, before[1]]
            assert_single_replacement(before, after, "DateMath.cpp.o", {"size": 100, "sha256": "compiled-object-sha"})

    def test_extra_member_change_or_wrong_replacement_is_rejected(self):
        before = [{"member": "DateMath.cpp.o", "size": 10, "sha256": "original"},
                  {"member": "other.cpp.o", "size": 20, "sha256": "other"}]
        replacement = {"size": 11, "sha256": "compiled"}
        after = [{"member": "DateMath.cpp.o", **replacement}, before[1]]
        for invalid in [before, after[::-1], after + [before[1]],
                        [after[0], {**before[1], "sha256": "also-changed"}],
                        [{**after[0], "sha256": "wrong-object"}, before[1]]]:
            with self.assertRaises(RuntimeError):
                assert_single_replacement(before, invalid, "DateMath.cpp.o", replacement)

    def test_actual_pinned_native_identity_format(self):
        manifest = {"bunVersion": "1.4.2", "bunRevision": "744846f844374847c902b5e7fd59b4342a51ef99"}
        relink.validate_native_identity("1.4.2\n", "1.4.2+744846f84\n",
                                        "1.4.2+744846f844374847c902b5e7fd59b4342a51ef99\n", manifest)

    def test_wrong_revision_or_same_short_prefix_does_not_pass(self):
        manifest = {"bunVersion": "1.4.2", "bunRevision": "744846f844374847c902b5e7fd59b4342a51ef99"}
        for version, short, full in [
            ("1.4.2\n", "1.4.2+744846f844\n", "1.4.2+744846f844374847c902b5e7fd59b4342a51ef99\n"),
            ("1.4.2\n", "1.4.2+744846f85\n", "1.4.2+744846f844374847c902b5e7fd59b4342a51ef99\n"),
            ("1.4.2\n", "1.4.2+744846f84\n", "1.4.2+744846f844374847c902b5e7fd59b4342a51ef90\n"),
            ("1.4.3\n", "1.4.2+744846f84\n", "1.4.2+744846f844374847c902b5e7fd59b4342a51ef99\n"),
        ]:
            with self.assertRaises(RuntimeError):
                relink.validate_native_identity(version, short, full, manifest)

    def test_restricted_graph_preserves_commands_and_removes_rebuild_edges(self):
        link = "rule link\n  command = clang++ @$out.rsp $ldflags -o $out\n  rspfile = $out.rsp\n  rspfile_content = $in_newline\n\n"
        strip = "rule strip\n  command = strip $in -o $out\n\n"
        edges = "build bun-profile | bun-profile.linker-map: link libbun.a $\n    rust.a webkit.a | linker.lds\n  ldflags = -flto=thin\n\nbuild bun: strip bun-profile\n\n"
        original = ("rule regen\n  command = rebuild-everything\n\n" + link + strip +
                    "build build.ninja: regen scripts/build.ts\n\n" + edges +
                    "rule upload\n  command = buildkite upload\n\nbuild upload: upload bun\n")
        selected = relink.restricted_graph(original)
        self.assertEqual(selected, "ninja_required_version = 1.9\n\n" + link + strip + edges)

    def test_missing_or_duplicate_link_edge_fails_closed(self):
        for graph in ["rule link\nrule strip\nbuild bun: strip bun-profile\n",
                      "rule link\nrule strip\nbuild a: link x\nbuild b: link y\nbuild bun: strip a\n"]:
            with self.assertRaises(RuntimeError):
                relink.restricted_graph(graph)

    def test_archive_cannot_write_outside_owned_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            archive = parent / "hostile.tar"
            with tarfile.open(archive, "w") as tar:
                member = tarfile.TarInfo("../foreign-file")
                member.size = 1
                tar.addfile(member, io.BytesIO(b"x"))
            task = relink.Diagnostic(parent / "task", parent / "evidence")
            with self.assertRaises(tarfile.FilterError):
                task.extract(archive, task.root / "extract")
            self.assertFalse((task.root / "foreign-file").exists())


if __name__ == "__main__":
    unittest.main()
