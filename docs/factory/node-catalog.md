# Node catalog

Every example is a node fragment; referenced producers and configured integrations must exist.
Common routing, receipt, retry and freshness fields are documented in [nodes](nodes.md).

## agent

Configuration: `prompt`; `reads`; `output:{schema}` or `{format}`; `rules`; selector `verify`; `access`; `instructions`; runner/model settings; `session:fresh|resume`; optional `chat`.

Output: Validated authored JSON, or `{text}` for `json:false`. Resume retains the native identity at the structural step path, including after restart.

```json
{"id":"answer","name":"Answer","type":"agent","prompt":"Answer the request.","reads":{"request":"@source"},"output":{"schema":{"type":"object","required":["answer"]}},"session":"resume"}
```

## display

Configuration: Exactly one `document` or `from` pointer; optional `reads`, `bind`, `notifications:{push:private|view-text}`. Documents use bounded components.

Output: `action`, `values`, `items`, `itemsByAction`, `followUps`, `comments`, `documentDigest`, `bound`. Noninteractive documents continue; controls require explicit submission.

```json
{"id":"confirm","name":"Confirm","type":"display","bind":["answer"],"document":{"version":"view-v1","components":[{"id":"actions","type":"actions","data":{"literal":{"actions":[{"id":"accept","label":"Accept"}]}}}]}}
```

## check

Configuration: `reads`; `check:{results:{name:rules-v1},passed?:rules-v1}`. No evidence adapters or `checks` property.

Output: Named result values and `passed`; branches own routing.

```json
{"id":"ready","name":"Ready","type":"check","reads":{"data":"answer"},"check":{"results":{"ready":{"path":"/inputs/data/ready","equals":true}}}}
```

## transform

Configuration: `reads`; `transform` fields containing rules-v1 expressions, literals, lazy if/then/else, maps, find, merge and aggregates; optional output schema.

Output: A detached JSON object with the configured fields. Map item scopes support parent pointers and stable keys.

```json
{"id":"result","name":"Shape result","type":"transform","reads":{"data":"answer"},"transform":{"answer":{"select":"/inputs/data/answer"}},"revisionScope":"none"}
```

## converge

Configuration: `reads`; `watch` JSON Pointers; `maxCycles`. Previous state belongs to the exact structural path.

Output: `{stalled,cycles,changed}`. First observation counts one; changed values reset the count.

```json
{"id":"progress","name":"Observe progress","type":"converge","reads":{"data":"answer"},"watch":["/inputs/data"],"maxCycles":3}
```

## wait

Configuration: One registered read-only `body` node; `until` rule; `interval`, `timeout`, optional `maxErrors`.

Output: The last matching poll result. Deadline, next poll time and attempts survive restart; timeout fails.

```json
{"id":"wait","name":"Wait for CI","type":"wait","body":{"id":"status","name":"Status","type":"ci","op":"status"},"until":{"path":"/complete","equals":true},"interval":1000,"timeout":60000}
```

## workflow

Configuration: `workflow` ID; optional `bindings` to original producers, `inputMapping`, `inputFreshness:eager|on-read`. Target declares ports and outcomes.

Output: `{outcome,outputs}`. Repeated outcome-enabled calls retain their frame, sessions and receipts.

```json
{"id":"plan","name":"Plan","type":"workflow","workflow":"v2-clarify-plan","revisionScope":"none"}
```

## fanout

Configuration: `groups`: arrays of node graphs. Each branch has its own lexical outputs.

Output: An array of completed branch output objects, in authored group order. Failures cancel active siblings after cleanup.

```json
{"id":"parallel","name":"Parallel","type":"fanout","groups":[[{"id":"left","name":"Left","type":"transform","transform":{"value":1}}],[{"id":"right","name":"Right","type":"transform","transform":{"value":2}}]]}
```

## foreach

Configuration: `items:{from}` or `{values}`; stable `itemId` pointer; `body`; `concurrency`, `maxItems`; `failure:all-must-succeed|keep-successful`.

Output: Per-item outcome/output records and operational progress. Snapshot membership and item identities persist. Interactive Display is rejected inside concurrent bodies.

```json
{"id":"items","name":"For each","type":"foreach","items":{"values":[{"id":"a"}]},"itemId":"/id","body":[{"id":"result","name":"Result","type":"transform","reads":{"item":"@item"},"transform":{"item":{"select":"/inputs/item"}}}]}
```

## snapshot

Configuration: `snapshot` configuration; optional bounded source history.

Output: Pinned repository heads, source provenance and optional dated operational samples, used by read-only agents.

```json
{"id":"baseline","name":"Snapshot","type":"snapshot","snapshot":{}}
```

## file-issues

Configuration: `fileIssues` collection, item ID, destination, field mapping and bounds. See recipe-actions.

Output: Durable per-item created/reconciled ticket identities; backlog-only and unassigned.

```json
{"id":"file","name":"File issues","type":"file-issues","fileIssues":{"items":{"values":[]},"itemId":"/id","maxItems":100,"fields":{"title":"/title","body":"/body"}}}
```

## launch-runs

Configuration: `launchRuns` collection, stable item ID, target workflow, input mapping, dependency fields, bounds and `wait`.

Output: Durable child links and statuses; dependency waves retain identities through uncertain creation and restart.

```json
{"id":"launch","name":"Launch runs","type":"launch-runs","launchRuns":{"items":{"values":[]},"itemId":"/id","maxItems":100,"workflow":"factory","inputMapping":{"prompt":"/prompt"},"wait":true}}
```

## exec

Configuration: `command`, `args`, `access:read-only|workspace`, `timeout`, environment-name allowlist `env`, optional `json`.

Output: `{exitCode,stdout,stderr,json?}`. OS sandbox enforces workspace/read-only access; workspace effects retain an effect key.

```json
{"id":"status","name":"Inspect Git","type":"exec","command":"git","args":["status","--short"],"access":"read-only"}
```

## git

Configuration: `op:status|commit|push|rev-parse|diff`; refs; optional merge-base comparison and commit hooks. Commit reads `message`.

Output: `{repositories:[{id,head,...}]}` with operation-specific status, revision, diff or publication fields.

```json
{"id":"status","name":"Git status","type":"git","op":"status"}
```

## pr

Configuration: `op:ensure|read|comment|ready`; declared `pr` read when selecting a request; title/body reads for ensure, body for comment.

Output: Per-repository verified URLs, heads, request metadata and provider state. Ensure/comment/ready reconcile durable effects.

```json
{"id":"request","name":"Read request","type":"pr","op":"read"}
```

## ci

Configuration: `op:status|rerun`; request read; rerun selection through declared reads.

Output: Per-repository checks and summary including `complete:false` while pending or heads differ. Rerun returns provider receipts.

```json
{"id":"checks","name":"Check CI","type":"ci","op":"status","reads":{"pr":"request"}}
```

## merge

Configuration: `reads.pr`; optional `expectedRevision` producer, `bind`, `method`, `timeout`, `pollInterval`.

Output: `{repositories:[{repositoryId,merged,sha,url}]}` after provider confirmation; `headChanged` or `authorizationStale` returns require recipe routing.

```json
{"id":"merge","name":"Merge approved revision","type":"merge","expectedRevision":"approval","bind":["approval"],"reads":{"pr":"request"}}
```

## ticket

Configuration: `op:read|create|update|comment|set-status|link`; verified reference, fields/body/status/relationship configuration or declared reads.

Output: Provider snapshot for reads; durable `{ok,id,url}` effect receipts for mutations. The configured adapter validates identity and permissions.

```json
{"id":"ticket","name":"Read ticket","type":"ticket","op":"read"}
```

