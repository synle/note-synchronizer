# TODO.eslint — note-synchronizer

Lint debt inventory for a follow-up agent.
Generated with `npx oxlint` on 2026-08-23 (read-only scan; oxlint not installed in this repo).
Total findings: **73** across **10** rules.

Recommended disposition per rule: fix at the source where cheap; disable via `.oxlintrc.json` where the pattern is intentional or generated code is involved.

| Rule | Count |
|---|---|
| `eslint(no-unused-vars)` | 51 |
| `eslint(no-useless-escape)` | 11 |
| `eslint(no-async-promise-executor)` | 3 |
| `eslint(no-duplicate-case)` | 2 |
| `eslint(no-constant-binary-expression)` | 1 |
| `eslint(no-extra-boolean-cast)` | 1 |
| `eslint(no-dupe-keys)` | 1 |
| `typescript(no-wrapper-object-types)` | 1 |
| `eslint(no-unused-expressions)` | 1 |
| `eslint(no-unreachable)` | 1 |

## Details per rule

### `eslint(no-unused-vars)` (51)
- e.g. `note-synchronizer/src/worker_children.ts — Identifier 'logger' is imported but never used.`

### `eslint(no-useless-escape)` (11)
- e.g. `note-synchronizer/src/crawler/commonUtils.ts — Unnecessary escape character '['`

### `eslint(no-async-promise-executor)` (3)
- e.g. `note-synchronizer/src/models/modelsFactory.ts — Promise executor functions should not be `async`.`

### `eslint(no-duplicate-case)` (2)
- e.g. `note-synchronizer/src/crawler/dataUtils.ts — Duplicate case label`

### `eslint(no-constant-binary-expression)` (1)
- e.g. `note-synchronizer/src/models/modelsFactory.ts — Unexpected constant truthiness on the left-hand side of a "||" expression`

### `eslint(no-extra-boolean-cast)` (1)
- e.g. `note-synchronizer/src/models/modelsFactory.ts — Redundant double negation`

### `eslint(no-dupe-keys)` (1)
- e.g. `note-synchronizer/src/models/modelsSchema.ts — Duplicate key 'allowNull'`

### `typescript(no-wrapper-object-types)` (1)
- e.g. `note-synchronizer/src/crawler/dataUtils.ts — Do not use wrapper object types.`

### `eslint(no-unused-expressions)` (1)
- e.g. `note-synchronizer/src/crawler/googleApiUtils.ts — Expected expression to be used`

### `eslint(no-unreachable)` (1)
- e.g. `note-synchronizer/src/crawler/gdriveCrawler.ts — Unreachable code.`
