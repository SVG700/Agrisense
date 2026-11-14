# Security policy

## Supported versions

Only the `main` branch gets security fixes. There are no maintained release branches yet.
Tagged releases are snapshots of `main`.

| Version | Supported |
|---|---|
| `main` (latest) | ✅ |
| Older commits and tags | ❌ (upgrade to `main`) |

## Reporting a vulnerability

**Please do not report security problems in public issues, discussions or pull requests.**

Report them privately through GitHub:

1. Open the repository's **Security** tab.
2. Click **Report a vulnerability** (GitHub private vulnerability reporting).
3. Describe the problem, how to reproduce it, and what an attacker could do with it.

Only the maintainer, Samhith V Gupta ([@SVG700](https://github.com/SVG700)), can see the
report. There is no email contact. If the form isn't available, use the contact options on
the maintainer's GitHub profile to ask for a private channel, without including any details.

This is a small volunteer project, so there is no bug bounty. We aim to acknowledge reports
within 7 days and will credit you in the fix unless you prefer not to be named.

## What counts

Examples of what we want to hear about:

- **Leaked secrets**: an API key, Supabase service-role key, Telegram bot token, Roboflow
  key, device or admin key, or a `.env` file committed anywhere in the repository or its
  history, or exposed by the running app (for example in the frontend bundle or logs).
- **Authentication or authorisation bypass on the API**, for example:
  - writing telemetry without a valid device key
  - a device key submitting data for another device
  - calling admin endpoints without the admin key
  - using a battery-portal session anywhere except `/api/battery-admin/*`
- **Unsafe advice injection into the LLM advisor**: input (trap data, photo content, device
  names, Telegram messages, etc.) that makes Gemini or Claude produce harmful or misleading
  farming advice. Examples: wrong pesticide or dose, ignoring the server's SPRAY / BIOCONTROL
  / WAIT decision, or removing the safety wording.
- Reading another farm's private images or data in a way the README does not document. Note
  that the read endpoints are public by design: see "Security considerations" in the README.
- Injection, path traversal, server-side request forgery, or denial of service with a small
  request.
- Vulnerable dependencies that are actually reachable in this app. The known kepler.gl
  `npm audit` findings and their mitigations are documented in `DECISIONS.md` (D12).

## Out of scope

- Missing keys in demo mode (`DEMO_MODE=true`): demo mode is unauthenticated by design and
  must not be exposed to the internet.
- Problems only in third-party services (Gemini, Claude, Roboflow, Supabase, Telegram,
  Open-Meteo). Report those to the service.
- Model accuracy (missed or wrong insect counts). Please open a normal issue or field report.

## If you find a leaked key

Tell us privately as above. Don't use the key. The maintainer will revoke and rotate it
first, then clean up.
