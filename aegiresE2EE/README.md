# Aegires E2EE for Vencord

This is a local Vencord plugin port for the Aegires **text-message wire format**. It uses Web Crypto (PBKDF2-HMAC-SHA1, 15,000 iterations, fixed `pwc` salt, AES-256-GCM) and the `§` + Base64 envelope, so messages can interoperate with Aegires when both clients use the same passphrase.

## Current behavior

- Encrypts outgoing messages and edits while the composer toggle is on.
- Adds a lock toggle beside the message composer buttons. It stays enabled until clicked again and resets off when Vencord restarts.
- Shows only a lock icon beside the sender name to distinguish Aegires-encrypted messages from unencrypted messages. Hover it for the status text.
- Encrypts image attachments using Aegires' binary format (12-byte IV followed by AES-GCM ciphertext) and uses the `.enc` filename marker. Matching encrypted images are decrypted locally and displayed inline.
- With encryption enabled, non-image attachments and images larger than 50 MiB are blocked rather than uploaded in plaintext.
- Leaves already-prefixed messages alone.
- Cancels the send if the passphrase is missing, encryption fails, or ciphertext would exceed Discord's message limit. It does not fall back to sending plaintext.
- Decrypts new and updated messages locally and scans the currently open channel when the plugin starts or the passphrase changes.
- Adds message context-menu actions to decrypt a message manually or restore its ciphertext locally.
- Attachment/stream encryption from Aegires is not included.

Copy this directory to `src/userplugins/aegiresE2EE` in a Vencord checkout, then build Vencord using its current developer instructions. The code uses Vencord's ChatBarButton, message upload and attachment rendering patches, MessageEvents, MessageUpdater, context menu, message decoration/accessory and Flux APIs. Plugin APIs can change, so build it against the exact Vencord revision being used before relying on it.

Credits shown in the plugin settings: **Jhon444 (@ojhon444)**. The compatible wire format is based on the Aegires project's published behavior: [Curione23/Aegires](https://github.com/Curione23/Aegires).

## Security notes

This preserves Aegires' existing format for compatibility. Its fixed salt and low PBKDF2 work factor are legacy choices; a stronger protocol needs a versioned format and coordinated changes in both clients. Image attachments are processed in memory and capped at 50 MiB. Use a long, unique passphrase and share it through a separate trusted channel. Discord receives ciphertext, while each modified client sees plaintext before encryption or after decryption. This is client-side encryption, not protection from a compromised device or plugin.

This repository licenses the Vencord plugin implementation under the MIT License. It does not include Aegires' Android application or copy its Java source. Aegires itself currently has no declared license; this project credits it as the source of the compatible format and does not claim to relicense its code.
