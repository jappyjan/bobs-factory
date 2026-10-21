# Validated source and a subsequent evidence-only HEAD

All runtime, F1, browser and complete binary checks in this packet identify production source `7106f734ca6fc4066448e2766495f5bacb4fa0d9`. A later PR commit may add this report/assets and update its named documentation/changelog entries. That evidence-only HEAD is not relabeled as the executed source, and no CI result is inferred for it.

After committing the reviewed staged evidence, the implementation agent runs the retained `verify-head-bridge.py.txt` script (or its `/tmp` original) with the exact final HEAD. It requires 7106 to be an ancestor, a clean checkout, changes restricted to the two new report/assets paths plus the explicitly listed documentation/changelog files, unchanged production/build/test inputs outside those documentation paths, and all 1,740 generated artifact hashes plus the exact file/directory sets still matching the clean manifest, with no extra dist/web build directories. The fresh clean-build manifest must identify the evidence HEAD and contain exactly the same artifact maps and unchanged non-documentation input maps as validated7106. Any source change invalidates this bridge and requires appropriate renewed validation.

```sh
python3 /tmp/ticket136-r2-final-staging/verify-head-bridge.py \
  --head FINAL_EVIDENCE_HEAD \
  --manifest /tmp/ticket136-r2-validation-7106f734/final-build-manifest.json.txt \
  --fresh-manifest /tmp/FINAL_EVIDENCE_HEAD_CLEAN_BUILD_MANIFEST.json.txt \
  --out /tmp/ticket136-r2-final-head-bridge.json.txt
```

The resulting exact-head proof is attached/linked by the implementation agent. Generating it outside the checkout avoids a self-referential commit SHA. Parent retains sole ownership of current CI notifications, independent review and merge decisions; this bridge does not assert reviewer approval or merge readiness.
