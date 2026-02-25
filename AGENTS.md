## Project Overview

A GitHub Action that automatically integrates approved Pull Requests into a staging/integration branch via squash merges. It filters PRs by label, handles merge conflicts for known files, and tracks integration status through GitHub labels.

## Commands

- **Run locally:** `npm start` (runs `node src/main.js`, requires GitHub Action environment variables)
- **Install dependencies:** `npm install`
- **Manual test:** Trigger via GitHub Actions workflow dispatch (`.github/workflows/test_workflow.yml`)
- No test suite, linter, or build step is configured.

## Architecture

**Entry flow:** `entrypoint.js` → installs npm deps → dynamically imports `src/main.js`

**Source files (`src/`):**

- **main.js** — Reads GitHub Action inputs, creates Octokit client, calls `integrationMerge()`, sets `haveUpdates` output
- **integration-merge.js** — Core orchestration: fetches open PRs (max 25, oldest first), filters by approve label, clones repo into temp dir, resets integration branch to master, squash-merges each PR, delegates conflict resolution to `conflict-resolution.js`, writes integration data, pushes, and updates labels
- **conflict-resolution.js** — Configurable merge conflict resolver. Loads rules from `.github/conflict-resolution.yml` or uses built-in defaults. Supports file-level resolution (checkout theirs/ours) and line-level resolution (auto-resolve hunks matching ignore patterns)
- **git.js** — Thin wrapper spawning `git` subprocesses. Exports functions for clone, fetch PR, branch management, squash merge, push (force-with-lease), conflict listing/resolution, etc. Defines custom `ExitError` class
- **common.js** — `tmpdir(callback)` utility that creates a temp directory, runs the callback, then cleans up

**Key behaviors:**

- Conflict resolution is configurable via `.github/conflict-resolution.yml`. Without a config file, built-in defaults apply: `version.rb` and `db/schema.rb` use file-level "theirs", `package.json` uses line-level "theirs" for version-only conflicts. Unresolvable conflicts cause the PR to be skipped.
- Squash commit messages follow the format: `{PR title} (#{number}) (sha:{7-char-hash})`
- SHA signatures are compared to detect if PRs are already integrated, avoiding redundant work
- `package.json` version is stamped with `stage.0.{timestamp}` format on integration
- Uses ES modules (`"type": "module"` in package.json)

**Conflict resolution config format (`.github/conflict-resolution.yml`):**

```yaml
"version.rb":
  scope: file          # file-level: checkout entire file
  side: theirs           # theirs (default) or ours

"package.json":
  scope: lines         # line-level: resolve hunks matching ignore patterns
  side: theirs
  ignore:                # required for scope: lines
    - '"version"\s*:'    # regex patterns; all non-blank lines must match

"db/*.rb":               # glob patterns supported
  scope: file
  side: theirs
```

Built-in defaults (when no config file exists):

| Pattern        | Scope | Side   | Ignore          |
|----------------|-------|--------|-----------------|
| `version.rb`   | file  | theirs | —               |
| `db/schema.rb` | file  | theirs | —               |
| `package.json` | lines | theirs | `"version"\s*:` |

## Action Configuration

Inputs: `repository`, `github_token`, `token_with_workflow_scope`, `master_branch` (default: "master"), `integration_branch` (default: "stage"), `approve_label` (default: "Approved"), `integrated_label` (default: "Integrated")

Output: `haveUpdates` — "yes" or "no"

Runtime: node16 (per action.yml)


## Formatting

- all MD files should be readable in raw text, this includes:
    - table columns width alignment

- code files should be structured so that top level methods will be on top of the file and private, implementation specifics moved to the bottom of it.
    - e.g. humans read from top to bottom, and the file structure should reflect this
