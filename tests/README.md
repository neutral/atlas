# Tests

From the source repository root, install the locked dependencies and run:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm test:types
```

Use Node.js 22.23.2 or later, pnpm 11.9.0 and Python 3.

These commands run source tests and declaration checks.

Component tests live beside their implementations, including the
[runtime-bundle installer](../apps/installer/README.md). `qualification/` includes
MCP probes and agreement checks with a separately written Python reader on
representative valid and invalid records. Reader
agreement does not establish complete format coverage or semantic quality.

Coverage applies to the tested host and runtime. Service checks do not establish
interactive browser behavior.
