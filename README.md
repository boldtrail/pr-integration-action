# pr-integration-action

GitHub Action that automatically integrates approved Pull Requests into a staging branch via squash merges.

## How it works

1. Fetches open PRs with the specified approval label
2. Resets integration (stage) branch to master/main
3. Squash-merges each PR in creation order
4. Auto-resolves known merge conflicts (configurable)
5. Pushes integration branch and reflects integration status with PR labels

## Inputs

| Input                      | Required | Default              | Description                                      |
|----------------------------|----------|----------------------|--------------------------------------------------|
| `repository`               | no       | `github.repository`  | Repository name with owner (e.g. `my-org/repo`)  |
| `github_token`             | no       | `github.token`       | GitHub token for API access                      |
| `token_with_workflow_scope`| no       | —                    | PAT with workflow scope for workflow file changes|
| `master_branch`            | no       | `master`             | Name of the main branch                          |
| `integration_branch`       | no       | `stage`              | Target branch for integrated PRs                 |
| `approve_label`            | no       | `Approved`           | Label that marks PRs ready for integration       |
| `integrated_label`         | no       | `Integrated`         | Label applied to successfully integrated PRs     |

## Outputs

| Output        | Description                                              |
|---------------|----------------------------------------------------------|
| `haveUpdates` | `"yes"` if any PRs were integrated, `"no"` otherwise     |

## Usage

```yaml
name: Stage deployment of approved PR

on:
  # trigger when master branch modified
  push:
    branches: [ master ]
  # trigger on new PRs or when label set/reset from PR
  pull_request:
    branches: [ master ]
    types:
      - labeled
      - unlabeled
      - synchronize
      - reopened
  # manual trigger
  workflow_dispatch:

jobs:
  integrate:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v3
        with:
          fetch-depth: 0

      - name: Integrate PRs
        uses: boldtrail/pr-integration-action@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          token_with_workflow_scope: ${{ secrets.GHUB_TOKEN_WITH_WORKFLOW_SCOPE }}
          # optional params below
          master_branch: main
          integration_branch: stage
          approve_label: Approved
          integrated_label: Integrated

      - name: Deploy
        if: contains(steps.integration.outputs.haveUpdates, 'yes')
        run: echo Deploy 'stage' branch to stage environment
```

## Conflict Resolution

By default, the action auto-resolves conflicts in `version.rb`, `db/schema.rb`, and `package.json`.

To customize, create `.github/conflict-resolution.yml` in your repository:

```yaml
"version.rb":
  scope: file
  side: theirs

"db/schema.rb":
  scope: file
  side: theirs

"package.json":
  scope: lines
  side: theirs
  ignore:
    - '"version"\s*:'

"config/*.yml":
  scope: file
  side: ours
```

| Field    | Required            | Values            | Description                        |
|----------|---------------------|-------------------|------------------------------------|
| `scope`  | yes                 | `file` / `lines`  | Resolution strategy                |
| `side`   | no                  | `theirs` / `ours` | Which side wins (default: `theirs`)|
| `ignore` | when `scope: lines` | array of regex    | Patterns for auto-resolvable lines |

- **`scope: file`** — accepts entire file from chosen side
- **`scope: lines`** — resolves only if all conflicting lines match `ignore` patterns

PRs with unresolvable conflicts are skipped, and not labeled with Integrated label
