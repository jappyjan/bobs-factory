# Evidence-only finalization

The final gates ran on clean `f4fe779d15feda6050c0e6b560efe0b060e94f2b`.
This commit adds only this evidence directory and the F1 report. Production,
web, dependency, tooling and harness inputs remain unchanged. The full-source
diff after the gate is empty; all untracked additions were checked against those
two explicit report destinations before staging.

Scoped verification passed: Biome check over the evidence directory; twelve original
JSON gzip hashes plus parsed equality with readable formatted copies; eighteen
original PNG SHA-256 values; native smoke driver Python AST; every local report
link; git diff --check. Original binary/F1/UI byte bridges were rechecked after
all suites and remain in validation-index.json. No broader rebuild or drive was
repeated for these evidence-only additions.

Git hooks were disabled for commits with HUSKY=0 because the required manual
gates and scoped finalization checks are recorded explicitly. No hook execution
is claimed. A subsequent changelog-only commit will add the actual PR link.
