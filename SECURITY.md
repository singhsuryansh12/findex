# Security policy

FinDex is an anonymous demonstration product. It does not provide authentication, bank connections, trading, money movement, or production storage of personal financial data.

## Reporting a vulnerability

Do not open a public issue containing secrets, exploit payloads, or private financial information. Report vulnerabilities privately to the repository owner with the affected commit, reproduction steps, impact, and any suggested mitigation.

## Supported code

Security fixes target the current `main` branch. Generated workspace artifacts are considered untrusted code and must pass the source policy, isolated validation, content-integrity, iframe, RPC, and signed-capability controls documented in [the security architecture](docs/SECURITY.md).

Never include real provider keys in reports or fixtures. Revoke any credential that may have been exposed.
