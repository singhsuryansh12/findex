# Contributing to FinDex

## Development workflow

1. Use Node.js 22 (`nvm use`) and install with `npm ci`.
2. Create a focused branch from `main`.
3. Keep product code within its feature boundary: routes in `app`, UI in `components`, domain logic in `lib`, hosted build assets in `infrastructure`, and tests in the matching test suite.
4. Add or update tests with every behavior change.
5. Run `npm run verify:local` before requesting review.

External provider checks are intentionally opt-in because they consume credentials and may incur cost. See [Testing](docs/TESTING.md).

## Design rules

- Preserve integer-cent monetary calculations and ISO date-only ledger values.
- Never introduce a canned generated-workspace fallback.
- Generated source must remain inside the policy, bundle-size, CSP, and capability boundaries.
- Keep credentials server-only and out of prompts, generated files, browser storage, and iframe messages.
- Treat active workspace files, prompts, RPC payloads, and provider responses as untrusted input.
- Update architecture, security, testing, and runbook documentation when their contracts change.

## Commits

Use imperative, scoped commit subjects such as:

- `feat(workspaces): add signed capability grants`
- `refactor(repo): organize sandbox infrastructure`
- `test(workspaces): cover malformed iframe RPC`
- `docs: document hosted validation`

Prefer a small sequence of reviewable commits where each commit has one purpose and leaves the repository coherent.
