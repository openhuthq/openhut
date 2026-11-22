---
name: openhut-copywriting
description: Write or review any words people see in OpenHut (app screens, dialogs, errors, notifications, the site, docs headings). Plain words anyone understands, outcomes first, short.
---
Use this before writing or changing any text a person reads in the app or on openhut.dev, and when reviewing someone else's.

**The test:** would a non-technical person understand it at a glance? If not, rewrite it. Short is good; cryptic is not. "Private / Even from us" failed this test; "End-to-end encrypted / We can't read your data" passes.

**In the app**
- Titles, labels and benefits are short words or phrases ("Backups", "Every Mac", "Teams"), not sentences. A sentence only where a word can't carry it: a confirmation that lists what gets deleted, an error that says how to fix it.
- One call to action per screen, a plain verb ("Enable cloud", "Save kit", "Restart now"). The button says exactly what happens.
- Name things the way people know them: OpenHut Cloud, recovery kit, Touch ID, agent, Mac, phone. Not internal words (record, relay, vault, key, hash, token, workspace key, PRF).
- Errors say what went wrong and what to do next, no apology, no codes.
- Keep the same word for the same thing everywhere (one name per feature, matching Settings and the docs).
- No faces in option rows; plain icons. Characters are for big pictures and for agents and people.

**One word for each thing** (use these, everywhere, errors included)
- Turning the cloud on: **Enable** ("Enable cloud", "Enable OpenHut Cloud…"). Not turn on, set up.
- What the cloud keeps: **agents, chats and settings**.
- Getting them back on a new Mac: **restore** ("Restoring your agents…"). Not bring back.
- Privacy: **End-to-end encrypted / We can't read your data.**
- Unlocking with a fingerprint: **Touch ID** (never "passkey" in user text).
- New encryption for a workspace: **Reset encryption** (not change keys).
- Passing a workspace on: **Make someone else the owner** (not hand over).
- The 12 words and their file: **recovery kit** (not recovery words).
- Use `${HERE}` for this computer, so Linux doesn't read "Mac".
- Errors carry no codes ("HTTP 500") and always end with what to do next ("Try again.", "OpenHut tries again.").

**On the site and in announcements**
- Say outcomes, not how it works: "Your agents on every Mac", not "encrypted records sync through the cloud". The mechanism lives behind a "How it works" or "Security" link.
- Never overclaim. Check claims against the docs and code first. The known traps are in `private/brain/openhut-site.md` ("Showing OpenHut Cloud on the site"): the phone never reads cloud data, no live cursors, removal doesn't change keys, restored agents don't start by themselves, the cloud does see emails, members, device names and timing.

**Style**
- Active voice, present tense, second person ("your agents").
- Straight apostrophes on the site (that's what the page uses); match the surrounding file.
- No em-dash asides, no "not X but Y", no scare quotes, no stock phrases ("seamless", "powerful", "worth noting").

**Reviewing copy:** list each string with its file and line, say which rule it breaks, and give the exact replacement. A string that passes needs no comment.

Decisions behind this: `private/brain/decisions/app-copy-is-simple-words.md`, `private/brain/openhut-site.md`.
