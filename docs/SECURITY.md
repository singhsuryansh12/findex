# Isolated tool runtime security

## Trust boundaries

- Prompts, clarification answers, active tool source, generated source, provider responses, saved browser data, and iframe messages are untrusted.
- The Next.js host, deterministic finance engine, build policy, sandbox template, artifact signer, and capability broker are trusted.
- OpenAI, Twelve Data, and Vercel Sandbox are external service boundaries accessed only by server code.

## Build-time controls

- The host-selected GPT-5.6 builder receives only bounded file operations and a predefined policy/bundle check; it never receives arbitrary shell execution.
- Source is restricted to `src/**/*.ts`, `tsx`, and CSS, 80 files, 256 KB total, and pinned imports.
- AST and CSS checks reject path escapes, network and storage APIs, navigation, frames, unsafe HTML, runtime evaluation, workers, timers, imperative loops, credential patterns, and external resources.
- Production bundles are limited to 2 MB.
- Hosted builds run from a pinned Vercel snapshot with outbound networking denied.
- Host-authored Vitest and Playwright checks validate accessible planned inputs/outputs, material output changes, console errors, and desktop/mobile overflow.
- Verified publication requires a passing independent review; one targeted repair may escalate model or effort but safety policy cannot be lowered by prompt text. Draft tools may publish after preflight while background polish continues.
- Durable run access is signed against both anonymous session and run ID. Access tokens are sent only in authorization headers and removed from IndexedDB at terminal state.
- Structured model/workflow logs contain operational metadata only. Prompts, generated source, financial data, cookies, run tokens, capability grants, API keys, and credentials are never logged.

## Runtime controls

- The host verifies the bundle SHA-256 before rendering.
- Generated code runs in an opaque-origin iframe with only `sandbox="allow-scripts"`.
- CSP denies default resources, connections, objects, forms, navigation targets, media, and external fonts.
- A nonce-bound one-time global initialization transfers a `MessagePort`; continued global `postMessage` traffic is ignored.
- Every RPC message and capability-specific input is Zod-validated by the host and server.
- Server signatures bind capability grants to the anonymous session, artifact ID, bundle hash, and exact grants.
- Provider keys and signed grants never enter generated source, the build sandbox, or the iframe.
- Per-session quotas bound turns, builds, capability requests, and AI/research actions.

## Failure behavior

Missing credentials, provider errors, sandbox failures, timeouts, policy violations, and review failures remain explicit. Typed provider errors expose stable FinDex codes rather than raw provider output. Cached provider data retains its original timestamp and is labeled stale after a failed refresh. The active published artifact is never replaced by a sample or unrelated fallback.

## Known product limits

Anonymous browser storage is not an identity or multi-user authorization system. A person controlling the browser profile can inspect or delete its IndexedDB data. FinDex is not suitable for real personal financial data until authentication, server persistence, tenant isolation, audit logging, retention controls, and incident response are added.
