# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.9.x | ✅ |

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately via [GitHub private vulnerability reporting](../../security/advisories/new) (Security → Report a vulnerability). You'll get an acknowledgement within a few days.

## Design notes relevant to security

- The dashboard binds **`127.0.0.1` only** and enforces a same-origin guard with Host-header pinning (mitigates CORS simple-request and DNS-rebinding attacks against localhost).
- The CI composite action passes all inputs through **`env:` variables**, never `${{ }}` interpolation inside `run:` blocks (shell-injection hardening), and pins third-party actions and `npx` packages to exact versions/SHAs.
- Secrets live in a gitignored `.env`; they are read by notifier skills at send time and are never echoed into responses, logs, or tickets (only secret *names* and HTTP status codes are logged).
- The deploy gate and verdict path make **zero model calls** — no prompt-injection surface in CI.
