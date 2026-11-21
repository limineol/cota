# Security

Cota sits between its owner's coding clients and their providers, and keeps every conversation, so a flaw in it can spend someone's subscription or show their work to someone else. Please report one privately.

## Reporting

Use GitHub's private vulnerability reporting: this repository's **Security** tab, then **Report a vulnerability**. Do not open a public issue or pull request for it. Say what is affected (the hub, `cota`, the connect script, the deployment's files), the commit, how to reproduce it, and what it lets someone do. Use constructed data: never send a real login, key or conversation.

There is no release yet, so a fix lands on `main`. Cota has one maintainer: expect a reply and a fix as soon as they can, not a schedule.

## In scope

- **The hub**: a request reaching a pool its hub key's scope does not open; a held key, a kept login or a client's login leaving the hub other than to its own provider; a request diverted that should not be; the API answering a caller it should not (the sign-in spec's table of who may call what); the setup code, the owner password, passkeys and sign-ins; SQL that escapes read-only or its database; the hub store or the archive made readable by others.
- **`cota`**: a hub key, a reader key or a machine login printed, passed in an argument, or written where others can read it; a launch that sends a login to the wrong place.
- **The connect script**: a quota login or the owner password printed, logged, or left on the machine.
- **The scrubber**: a secret left in a recorded exchange committed to this repository.
- **The deployment's files**: a secret in a container's environment, a port published beyond what `.env` says, the hub running as root.

## Not in scope

These are how Cota is built, and its docs say so:

- The request log and the archive hold every conversation in the clear, and the hub store holds quota logins unencrypted ([ADR-0017](docs/adr/ADR-0017-quota-logins.md)). Whoever can read the hub directory, ClickHouse's volume, the owner password or a reader key can read them.
- Plain `http` between machines, which the owner accepts with `--allow-plain-http`.
- What is the owner's: their reverse proxy, network, firewall, Docker engine and machines ([`docs/recipes`](docs/recipes/README.md)), and the providers' own services.
