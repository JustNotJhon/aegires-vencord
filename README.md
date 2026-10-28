# Aegires Vencord

A Vencord user plugin for encrypting Discord text messages with a format compatible with Aegires.

## Features

- AES-256-GCM message encryption compatible with Aegires text messages.
- Composer lock toggle for turning encryption on and off before sending.
- Small lock icon beside the sender name showing whether the message is encrypted.
- Automatic local decryption of incoming messages, plus context-menu actions to decrypt or restore ciphertext.
- Encrypted edits remain encrypted even if the composer toggle is off.

## Install

Custom plugins require a Vencord build from source. Follow [Vencord's custom plugin guide](https://docs.vencord.dev/installing/custom-plugins/).

Copy the `aegiresE2EE` folder into `Vencord/src/userplugins/`, then run these commands from the Vencord repository root. In Windows PowerShell, use the `.cmd` forms below; on other shells, omit `.cmd`:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd build
pnpm.cmd inject
```

Restart Discord and enable **AegiresE2EE** under **User Settings → Vencord → Plugins**. Set the same passphrase as the other participants. The composer lock button starts off; click it to encrypt outgoing messages and click it again to turn encryption off.

## Credits and compatibility

Plugin developer credit: **Jhon444 (@ojhon444)**.

The wire format is based on the published behavior of [Curione23/Aegires](https://github.com/Curione23/Aegires). This repository contains a new TypeScript implementation and does not include or copy Aegires' Android application source.

## Security

This plugin preserves Aegires' legacy text format (PBKDF2-HMAC-SHA1 with 15,000 iterations and a fixed salt, followed by AES-256-GCM). Use a long, unique passphrase and share it over a separate trusted channel. Discord still sees message metadata. The passphrase is stored in Vencord plugin settings, so anyone with access to that local profile may be able to retrieve it. This does not encrypt attachments or protect a compromised device.

Only the plugin implementation in this repository is licensed under MIT. The Aegires project does not declare a license; no Aegires Java source is included here.
