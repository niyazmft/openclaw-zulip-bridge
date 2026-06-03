# Security Policy

## Supported Versions

The following versions of OpenClaw Zulip Bridge are currently supported with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 2026.5.x | :white_check_mark: |
| < 2026.5.0 | :x:                |

---

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please **do not** open a public issue or discussion.

### How to Report

1. **Contact the maintainer directly** through GitHub (private message or security advisory)
2. **Or email** the maintainer with details of the vulnerability
3. Include:
   - A description of the vulnerability
   - Steps to reproduce (if applicable)
   - Potential impact
   - Suggested fix (if you have one)

### What to Expect

- **Acknowledgment**: You will receive an acknowledgment within 48 hours
- **Assessment**: We will assess the vulnerability and determine its severity
- **Fix timeline**: We aim to fix critical vulnerabilities within 7 days, high severity within 14 days
- **Disclosure**: Once fixed, we will coordinate with you on public disclosure and credit you (if desired)

### Security Best Practices for Users

- Keep your OpenClaw installation updated
- Use strong, unique API keys for your Zulip bots
- Store credentials securely using environment variables (never commit them)
- Review your `plugins.allow` configuration regularly
- Monitor your Zulip bot's activity for unusual behavior

---

## Security Considerations

This plugin handles sensitive credentials (Zulip API keys, bot emails). Key security features:

- Credentials are read from environment variables, not configuration files
- The plugin requests specific security exemptions for environment variable access (documented in `package.json`)
- All network communication uses HTTPS
- No production npm dependencies (reduces supply chain attack surface)

If you have concerns about any of these aspects, please reach out.
