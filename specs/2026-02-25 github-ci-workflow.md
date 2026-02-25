# GitHub CI Workflow Specification

## Overview

A CI workflow that runs tests on pull requests and creates version tags on successful merges to main.

## File Location

`.github/workflows/ci-and-release.yml`

## Triggers

| Event             | Condition                          | Behavior            |
|-------------------|------------------------------------|---------------------|
| `pull_request`    | targeting `main`, types: opened, synchronize, reopened | Run tests only      |
| `push`            | to `main` branch                   | Run tests + release |
| `workflow_dispatch` | manual trigger                   | Run tests only      |

## Concurrency

- Group: `${{ github.workflow }}-${{ github.head_ref || github.ref }}`
- Cancel in-progress: `true`
- Effect: New pushes to same PR/branch cancel previous runs

## Job Structure

Single job named `test-and-release` with conditional steps.

## Steps

### 1. Checkout

```yaml
- uses: actions/checkout@v4
```

### 2. Check Version Tag (all triggers)

**Condition:** Always runs (no `if`)

```bash
VERSION=$(node -p "require('./package.json').version")
if git ls-remote --tags origin | grep -q "refs/tags/v${VERSION}$"; then
  echo "::error::Tag v${VERSION} already exists. Bump version in package.json first."
  exit 1
fi
echo "VERSION=${VERSION}" >> $GITHUB_ENV
```

**Purpose:** Fail early if the version tag already exists. Catches version conflicts at PR time rather than merge time.

### 3. Setup Node.js

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '20'
    cache: 'npm'
```

### 4. Install Dependencies

```bash
npm ci
```

### 5. Run Tests

```bash
npm test
```

### 6. Create Version Tags (main push only)

**Condition:** `github.event_name == 'push' && github.ref == 'refs/heads/main'`

```bash
VERSION="${{ env.VERSION }}"
MAJOR=$(echo "$VERSION" | cut -d. -f1)

# Create exact version tag
git tag "v${VERSION}"

# Force-move major version tag
git push origin --delete "v${MAJOR}" 2>/dev/null || true
git tag -f "v${MAJOR}"

# Push both tags
git push origin "v${VERSION}" "v${MAJOR}"
```

**Tag Details:**
- Type: Lightweight (no annotation)
- Exact version: `v4.0.4` (new tag, fails if exists)
- Major version: `v4` (force-moved to latest release)

### 7. Write Job Summary (main push only)

**Condition:** `github.event_name == 'push' && github.ref == 'refs/heads/main'`

```bash
VERSION="${{ env.VERSION }}"
MAJOR=$(echo "$VERSION" | cut -d. -f1)
SHA="${{ github.sha }}"

cat >> $GITHUB_STEP_SUMMARY << EOF
## Release Summary

| Item           | Value                                |
|----------------|--------------------------------------|
| Version        | \`${VERSION}\`                       |
| Commit         | \`${SHA:0:7}\`                       |
| Tags Created   | \`v${VERSION}\`, \`v${MAJOR}\`       |

Users can pin to:
- \`uses: boldtrail/pr-integration-action@v${VERSION}\` - exact version
- \`uses: boldtrail/pr-integration-action@v${MAJOR}\` - latest v${MAJOR}.x.x
EOF
```

## Permissions

```yaml
permissions:
  contents: write  # Required for pushing tags
```

## Token

Uses default `GITHUB_TOKEN` - no PAT required.

## Environment Variables

| Variable  | Source                                 | Used In                    |
|-----------|----------------------------------------|----------------------------|
| `VERSION` | Extracted from `package.json`          | Tag creation, job summary  |

## Error Handling

| Scenario                     | Behavior                                      |
|------------------------------|-----------------------------------------------|
| Version tag already exists   | Fail immediately (on any trigger, including PRs) |
| Tests fail                   | Job fails, no tags created                    |
| Tag push fails               | Job fails (should not happen with proper permissions) |

## Pre-release Versions

Handled identically to regular releases:
- `4.0.5-beta.1` creates `v4.0.5-beta.1` and moves `v4`

## Complete Workflow

```yaml
name: CI and Release

on:
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened]
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: ${{ github.workflow }}-${{ github.head_ref || github.ref }}
  cancel-in-progress: true

permissions:
  contents: write

jobs:
  test-and-release:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Check version tag does not exist
        run: |
          VERSION=$(node -p "require('./package.json').version")
          if git ls-remote --tags origin | grep -q "refs/tags/v${VERSION}$"; then
            echo "::error::Tag v${VERSION} already exists. Bump version in package.json first."
            exit 1
          fi
          echo "VERSION=${VERSION}" >> $GITHUB_ENV

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Create version tags
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        run: |
          VERSION="${{ env.VERSION }}"
          MAJOR=$(echo "$VERSION" | cut -d. -f1)

          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

          git tag "v${VERSION}"
          git push origin --delete "v${MAJOR}" 2>/dev/null || true
          git tag -f "v${MAJOR}"
          git push origin "v${VERSION}" "v${MAJOR}"

      - name: Write job summary
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        run: |
          VERSION="${{ env.VERSION }}"
          MAJOR=$(echo "$VERSION" | cut -d. -f1)
          SHA="${{ github.sha }}"

          cat >> $GITHUB_STEP_SUMMARY << EOF
          ## Release Summary

          | Item           | Value                                |
          |----------------|--------------------------------------|
          | Version        | \`${VERSION}\`                       |
          | Commit         | \`${SHA:0:7}\`                       |
          | Tags Created   | \`v${VERSION}\`, \`v${MAJOR}\`       |

          Users can pin to:
          - \`uses: boldtrail/pr-integration-action@v${VERSION}\` - exact version
          - \`uses: boldtrail/pr-integration-action@v${MAJOR}\` - latest v${MAJOR}.x.x
          EOF
```

## Test Matrix

| Trigger                   | Tests Run | Tags Created | Version Check |
|---------------------------|-----------|--------------|---------------|
| PR opened                 | Yes       | No           | Yes           |
| PR updated (new commits)  | Yes       | No           | Yes           |
| Push to main              | Yes       | Yes          | Yes           |
| Manual dispatch           | Yes       | No           | Yes           |

## Edge Cases

| Scenario                                  | Expected Behavior                              |
|-------------------------------------------|------------------------------------------------|
| PR with same version as existing tag      | Fail immediately with clear error              |
| Main push with existing version tag       | Fail before tests with clear error             |
| Tests fail on main push                   | No tags created, job fails                     |
| Major tag `v4` doesn't exist yet          | Creates both `v4.0.4` and `v4` successfully    |
| Network error during tag push             | Job fails, manual retry needed                 |
| workflow_dispatch (any branch)            | Tests run, no tags created                     |
| Two PRs with same new version             | Both pass initially; after first merges, second's CI is stale (would fail on re-run or merge) |
