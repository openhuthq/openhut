---
status: accepted
---
# OpenHut is open source under MIT

## Decision
Owner, 2026-11-15: github.com/openhuthq/openhut is public and licensed MIT (`LICENSE`, copyright "OpenHut"). The site links to it in the nav, under the hero, beside the closing install command and in the footer.

## Context
The site was to point visitors at the code. Until then the repo was private and had no license, so every link would have been a 404 and "open source" wasn't true.

## Why
The product runs on the customer's own server, and readable source is the strongest proof of the security claims (agents in gVisor sandboxes, keys held only by the gateway). MIT is the simplest permissive license and was the owner's pick over Apache-2.0.

## Consequences
- Every commit, including the `brain/` notes, is public. Before going public, the full history (163 commits) was scanned with patterns for tokens, private keys, `.env` files and real credentials, and nothing was found. That was not a dedicated scanner like gitleaks. Keep secrets, server addresses and personal details out of commits and `brain/`.
- Making the repo private again doesn't take back what was already public or forked, so treat this as one-way.
