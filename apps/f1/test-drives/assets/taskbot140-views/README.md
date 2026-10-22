# #140 evidence archive

The [criterion report](../../2026-10-22-taskbot140-views.md) explains scope,
commands, outcomes, source identities, deviations and limits.

| Path | Meaning |
| --- | --- |
| `f1/final` | Passing actual EdgeWorker/CLI mocked drive on production source `667cbffd`, including empty screenshots without capture. Complete commands/actions/comments/original human answers/digests and byte hashes. |
| `f1/pre-media-pass` | Historical pass before ViewAssets changed; not current backend evidence. |
| `f1/attempt1-*`, `f1/attempt2-*` | Original failed drive fixtures; request header and JSON-prototype comparison corrections. |
| `ui/final` | Current production renderer screenshots, actual interactions, two reconstructions, accessibility/360 audits, original executed driver, standalone observer, source/build/PNG hashes and cleanup. |
| `ui/attempt-1`, `ui/attempt-2` | Historical spacing and Ask-draft findings/screens, preserved separately. |
| `native` | Native ARM64 development binary identity; final attempt3 passes, attempts1/2 are retained driver failures. All worker responses/logs, exact driver copies and hashes. No native agent execution. |
| `gates/logs` | Complete original local command output, including preliminary failures and both stopped broad runs. Filenames ending `.log.txt` retain exact original log bytes. |
| `gates/production-inputs.json` | 1,377 tracked production/gate input hashes matched source `667cbffd`; actual embedded resources independently recomputed to the binary's resource digest. Documentation/evidence/drive fixtures are explicitly excluded. |

`packages.log.txt` is the superseded e4e9fe2c run stopped with exit130.
`packages-final.log.txt` is the first `667cbffd` run stopped with exit130 after the
existing CheckImpactRetention failure; the original unchanged isolated regression
then passed. `packages-serial-final.log.txt` is the complete final one-worker gate.
Only its actual final exit/counts in the criterion report represent the final gate.

JSON and PNG receipts remain byte-identical, with inventories adjacent to them.
The archive-only Biome configuration follows #139 and prevents rewriting data;
it contains no product modules or active tests. Executable drive fixtures live
outside this folder and receive the normal lint/syntax and actual execution checks.
No receipt is promoted to a newer source identity. Historical failure logs are
evidence, not unresolved claims of passing validation.
