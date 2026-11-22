# OpenHut Cloud protocol (v1)

One page on how OpenHut Cloud keeps your data locked. The room (`cloud.openhut.dev`) stores bytes and checks signatures it can verify without any key. Everything it could read is listed under "What the room sees". Code: `packages/common/src/vault/vault.ts` (primitives), `packages/common/src/cloud/` (records, member lists), test vectors in `packages/common/test/vault/vectors.json`.

## Keys

| Key | Made where | What it does |
|---|---|---|
| Device key | each Mac, server and phone; 32 random bytes in the keychain (or a 0600 file) | One secret gives an Ed25519 signing key and an X25519 HPKE key. The public device key is both, 64 bytes, base64url. |
| Workspace key | the owner's Mac, 32 random bytes | Locks every record and file chunk of one workspace. Has a version (`keyVersion` on the member list). |
| Slot key | with the workspace key | Turns `kind/ref` into a record id, so ids don't leak agent ids or names. Stays the same when the workspace key changes. |
| Own key | per person, per workspace | Locks the inside of a Private agent's records a second time, so other members can't open them. |
| Account key | the first Mac, 32 random bytes | Locks the workspace box (workspace key, slot key, anchor) kept in the Account room, so another of your Macs can get back in. Its "account device" signs member lists that add your new Macs. |
| Kit key | 12 BIP39 words (128 bits), HKDF-SHA256 info `openhut/kit` | Locks the kit box that holds the account key. |

Keys change only on **Make a new kit** (account key, kit key, workspace key) and an admin's **Change keys** (workspace key). The new version is signed into the member list; old versions stay in the workspace box and letters so old records still open. Removing a person or a device does not change keys (the room refuses them instead).

## Envelope (suite 1)

Every locked value starts with a 6-byte header: format `1`, suite `1`, key version as uint32 big-endian. The header is part of the AEAD's additional data, with a bind string that says what the bytes are (`workspace/<id>/record/<id>`, `invite/<workspace>`, ...). A value locked for one place never opens in another.

- **lock**: AES-256-GCM. The key is HKDF-SHA256(workspace key, salt = 12-byte random nonce, info = `openhut/lock\0` + bind). Bytes: header, nonce, ciphertext and tag.
- **letter**: HPKE RFC 9180, auth mode, DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-256-GCM. The context is `openhut/letter\0`, header, sender key, recipient key, purpose and workspace (length-prefixed). Inside: an Ed25519 signature by the sender over context and plaintext, then the plaintext. Purposes: `workspace-key`, `account-key`, `connection-key`, `invite`, `pairing`. A reader only accepts senders it already trusts (on the member list, or the device it's pairing with).
- **signatures**: Ed25519 over a label and exact bytes: `openhut/member-list\0`, `openhut/record\0` + bind, `openhut/<proof>\0` + length-prefixed parts. Small-order keys and signatures are refused.

Readers open every shipped suite and lock with the newest. Suite 1 is the only one.

## Member list

A workspace's member list is a signed chain. Version 1 (genesis) names the owner and their devices. Version n+1 carries `previous` = SHA-256 of version n's bytes and is signed by a device on version n:

- the owner may change anything; an admin anything but the owner; a member only their own devices;
- a pending invite key may add exactly its invited email with one device (the join);
- a device younger than 3 days (`added`) can't drop an older one; `at` never goes back;
- a runtime (server) device can never sign;
- dropped devices go on `removed` for good.

Each client checks the whole chain from an anchor it got outside the room: the genesis hash, in the workspace box, a letter or the invite. So the room can refuse a list but can't forge or reorder one. The room keeps every version and accepts only a valid n+1 (409 for a stale one).

## Records

One locked record per thing: `{ id, ver, seq, deleted, body }`.

- `id` = HMAC-SHA256(HKDF(slot key, `openhut/slot`), `kind/ref`), base64url.
- `body` = lock(workspace key, bind `workspace/<ws>/record/<id>`, padded JSON of a signed body). The signed body is `{ change, kind, counter = ver, ref, value }`, signed by the writing device with bind `workspace/<ws>/record/<id>/<kind>`. Padding: up to 64 KiB, the next power of two (at least 1 KiB).
- Kinds are a closed list: `agent`, `setting`, `connection`, `message`, `memory`, `file`, `head`. Grants and sandboxes never sync. A connection's key travels as one `connection-key` letter per runtime device of the owner, inside the record.
- A Private agent's value is `{ hidden, owner }`: locked again with the owner's own key.
- A `PUT` with a stale `ver` is refused (409); the writer catches up and the newest edit wins quietly. `seq` is the room's order; `GET /records?after=0` is a full restore.
- Readers drop a record whose signer isn't on the member list, whose counter isn't its ver, or that a member may not write (settings and connections are admin-only; agent owner and Shared/Private come from an owner proof).
- Files: 1 MiB chunks, locked like records; a chunk's id is the SHA-256 of its locked bytes, checked by the room.

## What the room sees

Emails, roles, device keys and device names (the member list), workspace names, invite emails, record ids, sizes and times, who is online (Here messages are locked and padded to 512 bytes, but their timing shows), and IP addresses. Not agent names, instructions, chats, memory, files, connection keys or any key above.

## Export

`GET /v1/workspaces/{id}/export` (a listed device's session) returns every signed member list, every locked record and the file chunk ids, so a workspace can move: copy, then point the apps at the new base URL (`OPENHUT_CLOUD_URL`).
