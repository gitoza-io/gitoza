# Security Policy

## Supported versions

Security fixes are applied to the latest stable release published on [GitHub Releases](https://github.com/gitoza-io/gitoza/releases) and [gitoza.com](https://gitoza.com).

Older releases and release-candidate (RC) builds may not receive backported fixes.

## Reporting a vulnerability

**Please do not open a public GitHub Issue for security vulnerabilities.**

Report privately using one of these channels:

1. **Preferred:** [GitHub private vulnerability reporting](https://github.com/gitoza-io/gitoza/security/advisories/new) for this repository
2. **Email:** [support@gitoza.com](mailto:security@gitoza.com)

Include as much of the following as you can:

- Description of the issue and potential impact
- Steps to reproduce, or a proof of concept
- Affected version (app version / commit / installer) and OS
- Whether the issue is already public elsewhere

We aim to acknowledge reports within **7 days** and to keep you updated on status. After a fix is available, we may publish a GitHub Security Advisory and credit reporters who want to be named.

## Scope

In scope examples:

- Remote or local privilege escalation in the Gitoza desktop app
- Path traversal, arbitrary file write/read outside intended workspace paths
- Secrets leaked by the app or build/release pipeline (tokens, signing keys, credentials)
- Supply-chain issues in our published installers or release artifacts
- Unsafe handling of repository / `.gitoza` content that leads to code execution or data loss beyond the connected project

Out of scope examples:

- Vulnerabilities only in third-party dependencies that already have a public CVE and no practical impact on Gitoza (report upstream; we track via Dependabot)
- Issues that require physical access, a fully compromised machine, or unrealistic social engineering
- Denial of service that requires the attacker to already control the local user’s environment with no security boundary bypass
- Missing security headers or similar findings on marketing sites that do not affect the desktop app or release integrity



## Safe harbor

We consider good-faith security research that follows this policy to be authorized. We will not pursue legal action against researchers who:

- Report privately and give us a reasonable time to fix before public disclosure
- Avoid accessing data that is not their own, and avoid degrading service for other users
- Do not exploit the issue beyond what is needed to demonstrate it



## Non-security bugs

For crashes, UX bugs, and feature requests, use [GitHub Issues](https://github.com/gitoza-io/gitoza/issues).