Fix Node.js 20 deprecation warning in GitHub Actions CI

Problem
-------
GitHub Actions shows a deprecation warning because `actions/checkout@v4` runs on Node.js 20. GitHub will force Node.js 24 by default starting June 16, 2026.

Fix
---
Add the environment variable `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` to the CI workflow so actions run on Node.js 24 immediately and the warning disappears.

Change
------
In `.github/workflows/ci.yml`, add an `env:` block at the job level:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    env:
      FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true
    steps:
      ...
```

This is a one-line fix with no risk — it only tells the runner to use Node.js 24 for JavaScript-based actions.