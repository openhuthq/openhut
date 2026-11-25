<div align="center">

<h1>OpenHut</h1>

<p><b>Build, manage & share agents with your team</b></p>

<p>Self-improving agents in Slack and WhatsApp, on your own server.</p>

<p><a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a></p>

</div>

## Install

On a Linux server with Docker:

```
curl -fsSL https://openhut.dev | sh
```

## Meet your team where they work

Each agent gets its own Slack app, Telegram bot and WhatsApp number.

## Agents that browse the web

Watch them work live in their own browser. Take over any time.

## Where your agents live

On your own Linux server, each agent in its own container (under gVisor where the machine allows it).

| | OpenHut | OpenClaw | DuskBot | Hermes Agent on its own |
|---|:-:|:-:|:-:|:-:|
| Each agent sealed in its own box | ✓ | ✗ | ✗ | ✗ |
| Data keys stay in a gateway | ✓ | ✗ | ✗ | ✗ |
| Slack, WhatsApp, Telegram | ✓ | ✓ | ✗ | ✓ |
| MIT open source | ✓ | ✓ | ✗ | ✓ |

<sub>OpenHut, OpenClaw, DuskBot and Hermes Agent on its own, as each ships by default. OpenHut runs Hermes Agent inside each sandbox.</sub>

## Free, open source

MIT licensed. Bring the Claude or ChatGPT plan you already pay for. See [CONTRIBUTING.md](CONTRIBUTING.md) to run it locally.
