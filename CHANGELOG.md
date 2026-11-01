# Changelog

## 0.2.0 - 2026-11-01

- Use Aegires' current v2 text and v3 chunked file formats with Argon2id, HKDF-SHA256, and channel/sender binding.
- Keep local decryption compatibility with the previous PBKDF2/AES-GCM format.
- Support AES-128, AES-192, and AES-256 presets (AES-256 by default).
- Prevent Discord's image handling from modifying encrypted file bytes before upload.
- Show only an encryption lock icon beside each message's sender name.

## 0.1.0

- Initial public release of the Aegires-compatible Vencord text encryption plugin.
- Add a composer lock toggle and per-message encryption status.
- Decrypt compatible messages locally and keep edits encrypted.
