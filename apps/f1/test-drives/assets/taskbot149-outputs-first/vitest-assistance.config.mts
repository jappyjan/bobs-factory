import { defineConfig } from "/Users/jappy/.t3/worktrees/bobs-factory/taskbot-149-outputs-first/packages/edge-worker/node_modules/vitest/dist/config.js";
export default defineConfig({
  "root": "/Users/jappy/.t3/worktrees/bobs-factory/taskbot-149-outputs-first/packages/edge-worker",
  "resolve": {
    "alias": {
      "bobs-factory-opencode-runner": "/Users/jappy/.t3/worktrees/bobs-factory/taskbot-149-outputs-first/packages/opencode-runner/src/index.ts",
      "bobs-factory-github-event-transport": "/Users/jappy/.t3/worktrees/bobs-factory/taskbot-149-outputs-first/packages/github-event-transport/src/index.ts",
      "bobs-factory-codex-runner": "/Users/jappy/.t3/worktrees/bobs-factory/taskbot-149-outputs-first/packages/codex-runner/src/index.ts",
      "bobs-factory-gitlab-event-transport": "/Users/jappy/.t3/worktrees/bobs-factory/taskbot-149-outputs-first/packages/gitlab-event-transport/src/index.ts",
      "bobs-factory-claude-runner": "/Users/jappy/.t3/worktrees/bobs-factory/taskbot-149-outputs-first/packages/claude-runner/src/index.ts",
      "bobs-factory-edge-worker": "/Users/jappy/.t3/worktrees/bobs-factory/taskbot-149-outputs-first/packages/edge-worker/src/index.ts",
      "bobs-factory-linear-event-transport": "/Users/jappy/.t3/worktrees/bobs-factory/taskbot-149-outputs-first/packages/linear-event-transport/src/index.ts",
      "bobs-factory-slack-event-transport": "/Users/jappy/.t3/worktrees/bobs-factory/taskbot-149-outputs-first/packages/slack-event-transport/src/index.ts",
      "bobs-factory-simple-agent-runner": "/Users/jappy/.t3/worktrees/bobs-factory/taskbot-149-outputs-first/packages/simple-agent-runner/src/index.ts",
      "bobs-factory-config-updater": "/Users/jappy/.t3/worktrees/bobs-factory/taskbot-149-outputs-first/packages/config-updater/src/index.ts",
      "bobs-factory-mcp-tools": "/Users/jappy/.t3/worktrees/bobs-factory/taskbot-149-outputs-first/packages/mcp-tools/src/index.ts",
      "bobs-factory-gemini-runner": "/Users/jappy/.t3/worktrees/bobs-factory/taskbot-149-outputs-first/packages/gemini-runner/src/index.ts",
      "bobs-factory-cloudflare-tunnel-client": "/Users/jappy/.t3/worktrees/bobs-factory/taskbot-149-outputs-first/packages/cloudflare-tunnel-client/src/index.ts",
      "bobs-factory-cursor-runner": "/Users/jappy/.t3/worktrees/bobs-factory/taskbot-149-outputs-first/packages/cursor-runner/src/index.ts",
      "bobs-factory-zulip-event-transport": "/Users/jappy/.t3/worktrees/bobs-factory/taskbot-149-outputs-first/packages/zulip-event-transport/src/index.ts"
    }
  },
  "test": {
    "globals": true,
    "environment": "node",
    "setupFiles": [
      "/Users/jappy/.t3/worktrees/bobs-factory/taskbot-149-outputs-first/packages/edge-worker/test/setup.ts"
    ],
    "include": [
      "test/OutputsFirstContext.test.ts",
      "test/OutputsFirstContextF1.test.ts",
      "test/FactoryRolePrompts.test.ts", "test/EdgeWorker.context-assistance.test.ts", "test/ReviewContextReferences.test.ts", "test/prompt-assembly.routing-context.test.ts"
    ],
    "testTimeout": 30000,
    "hookTimeout": 30000,
    "fileParallelism": false
  }
});
