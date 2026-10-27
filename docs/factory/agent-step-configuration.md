# Agent configuration

An Agent has a prompt, named reads, output JSON Schema or registered format,
declarative rules, selector-based verification, access, shared instructions,
runner/model preferences and `session:fresh|resume`. Its output is data. Human
interaction belongs to a separate Display node and a recipe-owned loop.

```json
{"id":"write","name":"Write","type":"agent","session":"resume","reads":{"request":"@source"},"prompt":"Return the requested result.","output":{"schema":{"type":"object","required":["summary"]}},"verify":[{"check":"files-exist","path":"/files/*"}],"access":"workspace"}
```

The generic checks are `files-exist`, `media-valid`, `code-refs-valid` and
`ids-resolve`. Selectors are JSON Pointers with wildcard entries. File/code checks
honor repository boundaries; media checks require same-run evidence containment
and verified bytes. `ids-resolve` selects IDs from a named source read.
Invalid output receives precise bounded correction attempts in the same native
session. Verification never establishes human consent.

Agent fields do not select domain adapters. Saved graphs using removed flags,
tools or step types remain read-only. No implicit ID-based presets are applied.
See [node execution and receipts](nodes.md) and [the catalog](node-catalog.md).
