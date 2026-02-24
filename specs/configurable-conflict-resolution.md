# Spec: Configurable Merge Conflict Resolution

## Overview

Replace the hardcoded conflict resolution in `solveMergeConflict()` (`src/integration-merge.js:186-209`) with a config-driven system. Rules are defined per-repository in a YAML file with two resolution levels: file-level and line-level.

## Config File

**Location:** `.github/conflict-resolution.yml` in the target repository.

Loaded at runtime after cloning. If absent, built-in defaults apply. If present with YAML syntax errors or invalid structure, the action **fails immediately** with a clear error message. Rules referencing non-existent files are not errors.

## Config Format

```yaml
"version.rb":
  resolve: file
  side: theirs

"db/schema.rb":
  resolve: file

"db/*.rb":
  resolve: file
  side: ours

"package.json":
  resolve: lines
  side: theirs
  ignore:
    - '"version"\s*:'
    - '"someField"\s*:'
```

**Every entry has the same structure:**

| Field           | Required              | Description                                             |
|-----------------|-----------------------|---------------------------------------------------------|
| key (top-level) | yes                   | Exact file path or glob pattern                         |
| `resolve`       | yes                   | `"file"` or `"lines"`                                   |
| `side`          | no                    | `"theirs"` or `"ours"`. Default: `"theirs"`             |
| `ignore`        | when `resolve: lines` | Array of regex patterns matching line content to ignore |

## Resolution Logic

**File-level (`resolve: file`):**
Runs `git checkout --{side} -- <file>` then `git add <file>`. Same as current behavior.

**Line-level (`resolve: lines`):**
1. Parse git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) in the conflicted file
2. For each conflict hunk, check if **all** changed lines (both sides) match at least one `ignore` regex
3. Matching hunks: resolve by accepting the file-wide `side`
4. Non-matching hunks: resolution fails for this file
5. All hunks resolved → write merged file and stage it
6. Any hunk unresolved → file resolution fails, PR is skipped

## Built-in Defaults

When **no config file** exists:

| File           | Resolve | Side   | Ignore          |
|----------------|---------|--------|-----------------|
| `version.rb`   | file    | theirs | —               |
| `db/schema.rb` | file    | theirs | —               |
| `package.json` | lines   | theirs | `"version"\s*:` |

When a config file **exists**, it **fully overrides** these defaults.

## Rule Matching

When a conflicted file matches multiple rules (e.g. exact path and a glob), the **first matching rule** wins (top-to-bottom order in YAML).

## Error Handling

| Condition                                      | Behavior                             |
|------------------------------------------------|--------------------------------------|
| Config file missing                            | Use built-in defaults                |
| YAML syntax error                              | Fail action immediately              |
| Invalid rule (bad `resolve`/`side`/`ignore`)   | Fail action immediately              |
| Rule references non-existent file              | Not an error                         |
| Line-level hunk has no matching ignore pattern | File resolution fails, PR is skipped |

## Files Changed

- **`src/integration-merge.js`** — Remove `solveMergeConflict()`; create resolver after clone; use `resolver.resolve()` in merge conflict loop
- **`src/conflict-resolution.js`** (new) — Config loading/validation, conflict marker parsing, line-level resolution logic
- **`action.yml`** — No changes (config lives in the target repo)
- **New dependencies** — `js-yaml` for YAML parsing, `minimatch` for glob pattern matching
