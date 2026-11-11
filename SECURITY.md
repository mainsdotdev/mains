# Security Policy

## Supported Versions

Mains Desktop updates itself from the latest GitHub release. Security fixes ship in that release and in the Mains Server package built from the same version. An iPhone build is supported while it pairs with one of those backends. The production Bridge hub is supported at its current deployment.

| Version | Supported |
|---------|-----------|
| Latest Mains Desktop release | Yes |
| Mains Server package from that same release | Yes |
| iPhone apps paired with a supported backend | Yes |
| Bridge hub (`https://bridge.mains.dev`) | Yes |
| Older desktop and server releases, including 0.2.x | No |
| Windows desktop beta | No |

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, email **team@mains.dev** with:

- Description of the vulnerability
- Affected component and version
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You should receive a response within 48 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Scope

Reports against a supported version of the following are in scope:

- **Desktop and server.** The Electron app, the standalone `mains` server, and the browser UI that server serves. Authentication is required on every bind, including loopback.
- **Remote access.** Owner tokens, one-use browser logins, pairing codes, revocable device tokens, and the channel, command, and event allowlists a paired device is held to. A retried device command must not run a second time.
- **Credential storage.** Integration secrets in `connectionTokens` (Electron `safeStorage` on desktop, `MNS1` on the standalone server), device tokens stored only as hashes, remote-backend pairing material, and iPhone Keychain entries.
- **Local execution boundaries.** Path traversal or symlink escape through the file explorer, document viewer, or image proxy. Command injection through the terminal, shell, or git actions. A paired device reaching filesystem, git, terminal, or settings operations.
- **Renderer and browser UI.** Cross-site scripting in the desktop renderer or the server's browser UI.
- **Bridge.** The hub at `https://bridge.mains.dev` stores routing headers and ciphertext. Account keys and plaintext record bodies stay on the backends. In scope: reading or forging sealed records, accepting an unapproved, expired, or revoked credential, replaying a removed writer, and fetching a blob without a valid capability.

## Out of Scope

- Vulnerabilities that only affect a third-party dependency or an upstream agent (Claude Code, Codex, Copilot, Cursor, and their CLIs). Report those upstream. A bypass of a check Mains itself enforces is still in scope.
- Issues that require physical access to an unlocked machine, or an owner session that is already compromised.
- Social engineering.
- Publishing a server on the open internet without the documented TLS proxy. Missing authentication on a supported bind — loopback, `--lan`, Tailscale, or SSH — is in scope.
- Development-only Bridge configuration that a production or release build refuses.
- Denial of service against your own desktop or server process. Cross-account availability issues on the Bridge hub are in scope.

## Disclosure

We follow coordinated disclosure. After a fix is released, we will credit reporters (unless they prefer to remain anonymous) in the release notes.
