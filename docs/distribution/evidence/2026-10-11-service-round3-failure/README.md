# Historical round 3 service evidence

[Run 38134094340 / job 114454292980](https://github.com/jappyjan/bobs-factory/actions/runs/38134094340/job/114454292980)
used harness `db93374eb480aa7d252f233bf543c97097a70560` and unchanged production
runtime `b82c37c4fb9a3e18d1cb222c6d56d3fef852096f`, `.21` candidate digest
`ca323a599f606523965d996ff871eeee784d7f5a419ce9158675077b3e4e43ec`.

Main acceptance succeeded, initial-install and healthy-unit SIGINT/SIGTERM cases
passed cleanup checks, and both manager-mutation cases failed at the disabled-state
assertion before interruption. The complete cancellation matrix failed. The
independent reviewer also reproduced an outer-timeout nested-group escape.
These are historical harness results and do not establish a production defect or
acceptance of the subsequent round 4 harness.

`failed-artifact.zip` is original artifact `11700237374`, 162,828 bytes, SHA-256
`eef72aa87802ffac3ad5ec1fe8197638dd73c0a4bbd7b0a92f4a57f879e7b75e`;
its digest was compared with the official GitHub API before copying. The original
85 artifact files, including all seven receipts, the matrix and manager diagnostics,
are byte-preserved under `.raw` names and indexed with sizes/hashes in
[index.json](index.json). No original receipt or diagnostic was reformatted or
relabeled. The original API metadata is retained as `artifact.json.raw`.
