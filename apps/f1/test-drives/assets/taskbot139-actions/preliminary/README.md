# Preliminary evidence (not final passing gates)

Retained failures and exploratory receipts are separate from the ae847b35 final
validation. The interrupted broad run exposed a missing optional legacy
questions array; its unchanged fixture was reproduced red before the safe
projection fix. The restart failure was load-sensitive and passed unchanged
alone and in the same combined run. Compacting only that new fixture preserved
all outcomes and five-second waits. Other logs document new driver corrections
for RPC/admission, snapshot lookup, native request/status/index format and
CLI receiver/terminal-ticket accounting. No original outcome was removed or
timeout increased. Full details are in the test-drive report.

Earlier successful UI/F1/native receipts and native binaries remain retained
at their original /tmp paths; the final report and committed receipts identify
only the final frozen-source runs.
