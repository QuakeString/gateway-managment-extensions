# Security Policy

Sentient (operated by Invenia) takes the security of its products
seriously. This document describes how to report a security issue
in the Sentient platform, the Sentient Gateway, or the gateway
management extension, and what you can expect from us in return.

A human-readable version of this policy is also published at
<https://sentient.invenia.in/security>.

## Scope

This policy covers:

- **Sentient platform** (server, admin API, dashboards, authentication)
- **Sentient Gateway** (this repository,
  <https://github.com/QuakeString/Sentient-Gateway>) — the industrial
  protocol gateway and its connectors (S7, Modbus, OPC-UA, IEC 61850,
  EtherNet/IP, BACnet, MQTT, REST, and others shipped in the same
  image).
- **Gateway management extension**
  (<https://github.com/QuakeString/gateway-managment-extensions>) — the
  Angular module loaded into the Sentient dashboard.

If you are unsure whether something is in scope, report it anyway and
we will route it.

## How to report a vulnerability

**Email:** <security@invenia.in>

Please do **not** open a public GitHub issue, discuss on social media,
or disclose the issue anywhere else before we have had a chance to
investigate and remediate.

If you need to encrypt the report, request our PGP key in the initial
email and we will reply with it before you send sensitive details.

### What to include

A good report makes the difference between hours and weeks of triage.
If you can, please include:

- Product and version affected (release tag, commit hash, or Docker
  image digest).
- Deployment context (OS, network topology if relevant).
- A clear description of the issue and its impact.
- Step-by-step reproduction instructions or a proof-of-concept.
- Any known mitigations or workarounds.
- Whether the issue has been discussed or disclosed elsewhere.
- How you would like to be credited in the eventual advisory (name,
  handle, organisation) or whether you prefer to remain anonymous.

## What you can expect from us

| Stage | Our commitment |
|-------|----------------|
| Acknowledgement of receipt | Within **3 business days** |
| Initial triage and severity assessment | Within **10 business days** |
| Regular status updates | At least every **14 days** until the issue is resolved |
| Credit in the advisory | If you want it, and only with your permission |

We use the Common Vulnerability Scoring System (CVSS v3.1) for
severity, triaged by the product team and adjusted based on
exploitability in real deployments.

## Coordinated disclosure policy

We practice *coordinated vulnerability disclosure* following the
spirit of ISO/IEC 29147 and ISO/IEC 30111:

- We will work with the reporter to understand, reproduce, and
  remediate the issue.
- We aim to ship a fix and publish a CVE advisory within **120 days**
  of the initial report. Industrial control systems typically need
  longer patch cycles than consumer software; this window reflects
  that reality.
- If a fix will take longer than 120 days, we will explain why and
  propose an adjusted timeline.
- If a vulnerability is being actively exploited in the wild, the
  timeline accelerates accordingly.
- After a fix is released, we publish an advisory describing the
  issue, the affected versions, the remediation, and (with
  permission) the reporter's credit.

We kindly ask reporters not to disclose the details publicly before
our advisory is out. If you believe we are not making reasonable
progress, contact us first — escalation is always available at
<security@invenia.in>.

## Safe harbor

We consider security research and coordinated vulnerability
disclosure conducted in good faith to be authorised and protected.
If your research complies with this policy, we commit to:

- **Not initiate or support legal action against you** for any
  activity that is in good-faith compliance with this policy.
- **Not report you to law enforcement** for the same.
- **Work with you** to understand and resolve the issue quickly.

To be eligible for safe harbor, please:

- Only test against systems you own or have explicit permission to
  test.
- Avoid actions that could harm the reliability or integrity of our
  services or our customers' systems — in particular, **do not
  perform testing that could affect production industrial
  equipment**.
- Avoid accessing, modifying, or destroying data that is not your
  own. If you inadvertently encounter personal or customer data,
  stop, secure the data, notify us, and do not share it.
- Do not use social engineering, physical attacks, or denial-of-
  service attacks against our infrastructure or staff.
- Comply with all applicable laws.

Safe harbor is a commitment to reasonable researchers acting in good
faith — not blanket immunity for any action that happens to uncover
a flaw.

## Out of scope

The following are **not** considered vulnerabilities under this
policy:

- Reports from automated scanners without a demonstrated, reproducible
  security impact.
- Denial-of-service issues achievable only by sending overwhelming
  volumes of traffic (volumetric DoS).
- Social-engineering attacks against our staff or customers.
- Physical attacks on our infrastructure.
- Vulnerabilities in third-party dependencies that do not affect the
  Sentient products as shipped (though we still appreciate being
  told).
- Missing security hardening headers or TLS-configuration best-
  practice suggestions without a demonstrated exploit.
- Reports generated purely from scanner output with no analysis.

If you are unsure, report it anyway and we will classify on receipt.

## Hall of fame

Confirmed reports of security issues — at the reporter's option —
will be acknowledged on our security page at
<https://sentient.invenia.in/security#reporters>.

---

This policy will evolve as our processes mature. The current version
is tracked in the `SECURITY.md` files in each covered repository and
mirrored at <https://sentient.invenia.in/security>. Suggestions to
improve the policy itself are welcome at <security@invenia.in>.
