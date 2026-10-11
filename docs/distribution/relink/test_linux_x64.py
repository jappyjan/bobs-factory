"""Guard against unintended rebuild execution and unsafe archive extraction."""

import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
import sys

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("relink", Path(__file__).with_name("linux-x64.py"))
relink = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relink)


class SafetyTests(unittest.TestCase):
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
