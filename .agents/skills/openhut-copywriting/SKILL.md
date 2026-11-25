---
name: openhut-copywriting
description: Write or review any words people see in OpenHut (app screens, dialogs, errors, notifications, the site, docs headings). Plain words anyone understands, outcomes first, short.
---
Use this before writing or changing any text a person reads in the app or on openhut.dev, and when reviewing someone else's.

**The test:** would a non-technical person understand it at a glance? If not, rewrite it. Short is good; cryptic is not. "Private / Even from us" failed this test; "End-to-end encrypted / We can't read your data" passes.

**In the app**
- Titles, labels and benefits are short words or phrases ("Backups", "Teams"), not sentences. But a line someone reads to understand a consequence is a full, plain sentence a person would say out loud: "Your agents and chats stay on this computer. You can't undo this.", not "This Mac keeps its agents and chats. Can't be undone."
- One call to action per screen, a plain verb ("Enable cloud", "Add a computer", "Restart now"). The button says exactly what happens.
- Name things the way people know them: OpenHut Cloud, Cloud, agent, computer, team. Not internal words (record, relay, vault, key, hash, token, workspace key, PRF).
- Errors say what went wrong and what to do next, no apology, no codes.
- Keep the same word for the same thing everywhere (one name per feature, matching Settings and the docs).
- No faces in option rows; plain icons. Characters are for big pictures and for agents and people.

**One word for each thing** (use these, everywhere, errors included)
- Turning the cloud on: **Enable** ("Enable cloud", "Enable OpenHut Cloud…"). Not turn on, set up.
- What the cloud keeps: **agents, chats and settings**.
- Passing a team on: **Make someone else the owner** (not hand over).
- Call it a **team**, never a workspace, in anything people read ("Join Mo’s team", "Mo’s team"). Slack and Google Workspace keep their own word.
- Where an agent runs: **Cloud** (a computer we host) or **your own computer** (a Linux server, where it is **sealed in its own box**, gVisor).
- Agent states: **Running**, **Stopped**, **Stopped unexpectedly**, **Model not connected**. Tools an agent may not use: **Blocked**.
- What an agent may use: **can use** (not grant, call). The machine: **computer** (not server, runner, agentd).
- Say **computer**, not server or Mac: agents run on Cloud or on a Linux server you add; OpenHut itself is a web app.
- Errors carry no codes ("HTTP 500") and always end with what to do next ("Try again.", "OpenHut tries again.").

**On the site and in announcements**
- Say outcomes, not how it works: "Your agents on every computer", not "encrypted records sync through the cloud". The mechanism lives behind a "How it works" or "Security" link.
- Never overclaim. Check claims against the docs and code first. The known traps are in `private/brain/openhut-site.md` ("Showing OpenHut Cloud on the site"): no live cursors, removal doesn't change keys, restored agents don't start by themselves, the cloud does see emails, members, device names and timing.

**Write like Notion and Linear** (the owner's references; their home pages, 2026-11-22)
- Titles are 2 to 5 words: a noun phrase ("Planning and monitoring", "Changelog") or a verb and its object ("Capture knowledge", "Find answers").
- One line under a title, one idea. Never a second line that explains the first.
- Links are a verb and an object with an arrow: "Triage product feedback →". Buttons are two or three words: "Get started".
- Say what it is, not how it works. Calm and sure: no exclamation marks, no hype.

**Style**
- Active voice, present tense, second person ("your agents").
- Straight apostrophes on the site (that's what the page uses); match the surrounding file.
- No em-dash asides, no "not X but Y", no scare quotes, no stock phrases ("seamless", "powerful", "worth noting").

**Reviewing copy:** list each string with its file and line, say which rule it breaks, and give the exact replacement. A string that passes needs no comment.

Decisions behind this: `private/brain/decisions/app-copy-is-simple-words.md`, `private/brain/openhut-site.md`.
