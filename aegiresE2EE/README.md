# Aegires E2EE for Vencord

This is a local Vencord plugin implementation of Aegires' current versioned encryption format. It derives the master key with Argon2id, derives per-message and per-file keys with HKDF-SHA256 bound to channel and sender IDs, and uses AES-GCM. The `§` + Base64 envelope is retained for text; files use the current versioned chunked binary format.

## Current behavior

- Encrypts outgoing messages and edits while the composer toggle is on.
- Adds a lock toggle beside the message composer buttons. It stays enabled until clicked again and resets off when Vencord restarts.
- Shows only a lock icon beside the sender name to distinguish Aegires-encrypted messages from unencrypted messages. Hover it for the status text.
- Encrypts image attachments using Aegires' version 3 chunked file format and uses the `.enc` filename marker. Matching encrypted images are decrypted locally and displayed inline.
- Reads both the current Aegires v2/v3 formats and the previous PBKDF2/AES-GCM text and image formats.
- Uses Aegires' AES-128, AES-192, or AES-256 preset selection (AES-256 by default).
- With encryption enabled, non-image attachments and images larger than 50 MiB are blocked rather than uploaded in plaintext.
- Leaves already-prefixed messages alone.
- Cancels the send if the passphrase is missing, encryption fails, or ciphertext would exceed Discord's message limit. It does not fall back to sending plaintext.
- Decrypts new and updated messages locally and scans the currently open channel when the plugin starts or the passphrase changes.
- Adds message context-menu actions to decrypt a message manually or restore its ciphertext locally.

Copy this directory to `src/userplugins/aegiresE2EE` in a Vencord checkout, then build Vencord using its current developer instructions. The code uses Vencord's ChatBarButton, message upload and attachment rendering patches, MessageEvents, MessageUpdater, context menu, message decoration/accessory and Flux APIs. Plugin APIs can change, so build it against the exact Vencord revision being used before relying on it.

Credits shown in the plugin settings: **Jhon444 (@ojhon444)**. The compatible wire format is based on the Aegires project's published behavior: [Curione23/Aegires](https://github.com/Curione23/Aegires). Argon2id is provided by [hash-wasm](https://github.com/Daninet/hash-wasm), distributed under MIT; its license is included in `vendor/HASH-WASM-LICENSE`.

## Security notes

New messages and files use Aegires' current versioned protocol. The plugin can still read the previous version, but sending in the new format requires an updated Aegires client. Image files are processed in memory and capped at 50 MiB. Use a long, unique passphrase and share it through a separate trusted channel. Discord receives ciphertext, while each modified client sees plaintext before encryption or after decryption. This is client-side encryption, not protection from a compromised device or plugin.

This repository licenses the Vencord plugin implementation under the MIT License. It does not include Aegires' Android application or copy its Java source. Aegires itself currently has no declared license; this project credits it as the source of the compatible format and does not claim to relicense its code.
