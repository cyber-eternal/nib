# Security policy

## Supported versions

Only the [latest release](https://github.com/cyber-eternal/nib/releases/latest)
receives security fixes. Please update before reporting.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Older releases | No |

## Reporting a vulnerability

Please do not report security issues in public issues, discussions or pull
requests.

Report them privately through GitHub's security advisories:
[open a private report](https://github.com/cyber-eternal/nib/security/advisories/new)
for `cyber-eternal/nib`.

Include what you can of:

- the affected version and platform (macOS, Linux or web),
- the steps or a file that reproduces the issue,
- the impact you expect (for example, script execution from an opened
  `.nibd`, `.excalidraw` or pasted content).

You should get an acknowledgement within a week. Once the issue is confirmed,
a fix is prepared in a private advisory and released, and you are credited in
the advisory unless you prefer otherwise.

## Scope

Nib runs locally and has no server or accounts. The most relevant areas are
opening untrusted files and clipboard data (scene parsing, SVG and image
handling, links and embeds), the web build's content security policy, and the
desktop shell's file system and IPC permissions.
