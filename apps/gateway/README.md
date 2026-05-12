# @oculisecurity/cli

Security layer for AI coding agents. Visibility, policy enforcement, and audit trails for Claude Code, Cursor, and Windsurf.

## Install

```bash
npm install -g @oculisecurity/cli
```

## Quick start

```bash
oculi --help
```

## Gateway Configuration

Starting the gateway server requires `JWT_SECRET` — a shared secret matching your upstream token issuer, at least 32 characters of high-entropy data. Generate with `openssl rand -hex 32`. CLI subcommands (`init`, `install`, `tail`, `report`, `emit`) do not require it. See https://docs.oculisecurity.com/gateway/configuration for the full reference.

## Documentation

Full documentation, configuration reference, and integration guides: [oculisecurity.com](https://oculisecurity.com)

## License

Proprietary. See [LICENSE.txt](./LICENSE.txt). © Oculi Security LLC.
