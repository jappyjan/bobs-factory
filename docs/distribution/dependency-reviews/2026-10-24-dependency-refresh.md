# Dependency refresh source review

Reviewed by Claude release work on 2026-10-24. The review is independent of the
Codex dependency refresh in #173 and of the Recipes additions it supersedes. The
source delta runs from accepted baseline `84433882` to main `402768a4`. The exact
machine-readable review is
[`dependency-refresh-2026-10.json`](../../../distribution/dependency-reviews/dependency-refresh-2026-10.json)
(schema 3).

The delta covers:

- 22 changed dependency inputs: package manifests (dependency policy only),
  `pnpm-lock.yaml` and `pnpm-workspace.yaml`. #173 removed workspace overrides
  that the refreshed resolution no longer needs.
- 81 added or changed lockfile packages, and 57 removed packages.

**Shipped packages (22).** These were measured as the packages that the CLI
binary's Bun bundle and the web build's `frontend-packages.json` actually
include: the Recipes UI packages (`@xyflow/*`, `@dagrejs/dagre`, `d3-*`,
`zustand` and others), `hono`, `@hono/node-server`,
`@modelcontextprotocol/sdk@1.32.1`, `@sentry/node-core` and
`@sentry/opentelemetry@10.65.0`, `ajv-formats` and `iconv-lite`. Each official
npm archive matched the lockfile's SHA-512, and its SHA-256 and size are
retained. Package metadata and complete license texts were checked without
extracting or executing package code. There is no native code and there are no
install hooks. Licenses are MIT, ISC and BSD-3-Clause. The existing pinned
`react-remove-scroll-bar` notice is carried forward.

**Tooling packages (59).** These are vitest 4.1.12, vite 8 and rolldown with its
platform native bindings, the express and body-parser stack, babel parser types
and similar. They are pinned by lockfile integrity, which matches the npm
registry metadata, and declare MIT (56), ISC, BSD-3-Clause or Apache-2.0. None
ships. The binary build refuses to bundle any reviewed tooling package; a
darwin-arm64 build passed with that guard.

Verification:

- `verifyDependencyBaseline` accepts the candidate. All 103 protected inputs are
  checked, and the 22 changed inputs are covered by this review.
- `retainReviewedJavascriptSources` downloaded and inspected all 22 shipped
  archives and the pinned supplemental notice.

This is a distribution source and license review, not a legal opinion, and
claims no native relink. `pnpm audit` currently reports 16 advisories (5 high).
They are in `zod`, `fastify` and `fast-uri`, which ship, in the `express` and
`body-parser` tooling, and in Electron and `undici`. They are newly published
against versions already on main and are tracked separately. The Electron
update needs a fresh native baseline.
