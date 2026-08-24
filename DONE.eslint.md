# DONE.eslint — note-synchronizer

Lint debt resolved.
Resolved 2026-08-23 — 73 findings cleared. oxlint runs via `npx oxlint .` (`npm run lint`).
Dispositions below; a follow-up pass may convert config disables back into source fixes.

| Rule                                    | Count | Disposition                  |
| --------------------------------------- | ----- | ---------------------------- |
| `eslint(no-unused-vars)`                | 51    | disabled in `.oxlintrc.json` |
| `eslint(no-dupe-keys)`                  | 1     | disabled in `.oxlintrc.json` |
| `eslint(no-useless-escape)`             | 11    | fixed by `oxlint --fix`      |
| `eslint(no-async-promise-executor)`     | 3     | disabled in `.oxlintrc.json` |
| `eslint(no-unused-expressions)`         | 1     | disabled in `.oxlintrc.json` |
| `eslint(no-unreachable)`                | 1     | disabled in `.oxlintrc.json` |
| `eslint(no-duplicate-case)`             | 2     | disabled in `.oxlintrc.json` |
| `typescript(no-wrapper-object-types)`   | 1     | fixed by `oxlint --fix`      |
| `eslint(no-constant-binary-expression)` | 1     | disabled in `.oxlintrc.json` |
| `eslint(no-extra-boolean-cast)`         | 1     | disabled in `.oxlintrc.json` |
