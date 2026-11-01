import { argon2id } from "./vendor/argon2.umd.min";

/**
 * Aegires text wire-format compatibility layer.
 *
 * Format: § + Base64(12-byte random IV || AES-GCM ciphertext+tag), where the
 * plaintext is a one-byte flag (0 = raw UTF-8, 1 = raw DEFLATE) followed by
 * the payload. Key derivation matches Aegires Crypto.java.
 */

const PREFIX = "§";
const SALT = new TextEncoder().encode("pwc");
const ITERATIONS = 15_000;
const IV_BYTES = 12;
const TAG_BITS = 128;
const FLAG_RAW = 0;
const FLAG_DEFLATE = 1;

function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
    const binary = atob(value);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function deriveKey(password: string): Promise<CryptoKey> {
    if (!password) throw new Error("A passphrase is required");
    const material = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        "PBKDF2",
        false,
        ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: SALT, iterations: ITERATIONS, hash: "SHA-1" },
        material,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

// Older Android crypto providers treated PBEKeySpec password characters as
// PKCS#5 8-bit bytes. Newer Android providers use UTF-8. Accept both when
// decrypting files so images made by older Aegires installs still open.
async function deriveLegacyAndroidKey(password: string): Promise<CryptoKey> {
    if (!password) throw new Error("A passphrase is required");
    const passwordBytes = new Uint8Array(password.length);
    for (let i = 0; i < password.length; i++) passwordBytes[i] = password.charCodeAt(i) & 0xff;
    const material = await crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: SALT, iterations: ITERATIONS, hash: "SHA-1" },
        material,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

async function transform(data: Uint8Array, mode: "compress" | "decompress"): Promise<Uint8Array> {
    const format = mode === "compress" ? "deflate-raw" : "deflate-raw";
    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream(format as CompressionFormat));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function looksEncrypted(value: string): boolean {
    return value.startsWith(PREFIX);
}

export async function encryptText(plaintext: string, password: string): Promise<string> {
    const raw = new TextEncoder().encode(plaintext);
    let payload = raw;
    let flag = FLAG_RAW;

    // Java uses nowrap DEFLATE from 100 bytes onward, only keeping it when smaller.
    if (raw.byteLength >= 100 && typeof CompressionStream !== "undefined") {
        try {
            const compressed = await transform(raw, "compress");
            if (compressed.byteLength < raw.byteLength) {
                payload = compressed;
                flag = FLAG_DEFLATE;
            }
        } catch {
            // Some Chromium builds do not expose deflate-raw; uncompressed is compatible.
        }
    }

    const framed = new Uint8Array(payload.byteLength + 1);
    framed[0] = flag;
    framed.set(payload, 1);

    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await deriveKey(password);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: TAG_BITS }, key, framed));
    const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    combined.set(iv);
    combined.set(ciphertext, iv.byteLength);
    return PREFIX + bytesToBase64(combined);
}

export async function decryptText(wire: string, password: string): Promise<string | null> {
    if (!looksEncrypted(wire)) return null;

    try {
        const combined = base64ToBytes(wire.slice(PREFIX.length));
        if (combined.byteLength < IV_BYTES + TAG_BITS / 8) return null;
        const iv = combined.slice(0, IV_BYTES);
        const ciphertext = combined.slice(IV_BYTES);
        const key = await deriveKey(password);
        const framed = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, tagLength: TAG_BITS }, key, ciphertext));
        if (framed.byteLength < 1) return null;

        const payload = framed.slice(1);
        if (framed[0] === FLAG_RAW) return new TextDecoder().decode(payload);
        if (framed[0] === FLAG_DEFLATE && typeof DecompressionStream !== "undefined") {
            const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat));
            return new TextDecoder().decode(await new Response(stream).arrayBuffer());
        }
        return null;
    } catch {
        // Wrong passphrase, malformed ciphertext, or unsupported raw DEFLATE.
        return null;
    }
}

/** Aegires binary-file format: 12-byte random IV || AES-GCM ciphertext+tag. */
export async function encryptBytes(plaintext: Uint8Array, password: string): Promise<Uint8Array> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await deriveKey(password);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, tagLength: TAG_BITS },
        key,
        plaintext
    ));
    const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    combined.set(iv);
    combined.set(ciphertext, iv.byteLength);
    return combined;
}

export async function decryptBytes(combined: Uint8Array, password: string): Promise<Uint8Array | null> {
    if (combined.byteLength < IV_BYTES + TAG_BITS / 8) return null;

    const iv = combined.slice(0, IV_BYTES);
    const ciphertext = combined.slice(IV_BYTES);
    // WebCrypto UTF-8 is the current Aegires format. Retry the historical
    // Android PKCS#5 8-bit password conversion for older installations.
    for (const keyPromise of [deriveKey(password), deriveLegacyAndroidKey(password)]) {
        try {
            const key = await keyPromise;
            return new Uint8Array(await crypto.subtle.decrypt(
                { name: "AES-GCM", iv, tagLength: TAG_BITS },
                key,
                ciphertext
            ));
        } catch {
            // Try the other compatible password encoding.
        }
    }
    return null;
}
// Aegires v2/v3 format (2026-11 encryption rewrite).
export type AegiresPreset = "AES128" | "AES192" | "AES256";
const FILE_VERSION = 3;
const MESSAGE_VERSION = 2;
const FILE_CHUNK_BYTES = 64 * 1024;
const MASTER_KEY_SALT = new TextEncoder().encode("dcenc2|user-key|v1");
const presetInfo = {
    AES128: { index: 0, keyBytes: 16, tagBytes: 16, padBlock: 16 },
    AES192: { index: 1, keyBytes: 24, tagBytes: 14, padBlock: 32 },
    AES256: { index: 2, keyBytes: 32, tagBytes: 16, padBlock: 64 }
} as const;
const presetByIndex = ["AES128", "AES192", "AES256"] as const;
const masterKeys = new Map<string, Promise<Uint8Array>>();

function concatBytes(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return new Uint8Array(bytes).buffer as ArrayBuffer;
}

function putBe32(value: number): Uint8Array {
    return new Uint8Array([value >>> 24, value >>> 16, value >>> 8, value]);
}

function putBe16(value: number): Uint8Array {
    return new Uint8Array([value >>> 8, value]);
}

async function deriveMasterKey(password: string): Promise<Uint8Array> {
    if (!password) throw new Error("A passphrase is required");
    let promise = masterKeys.get(password);
    if (!promise) {
        promise = argon2id({
            password: new TextEncoder().encode(password.normalize("NFKC")),
            salt: MASTER_KEY_SALT,
            iterations: 3,
            parallelism: 1,
            memorySize: 64 * 1024,
            hashLength: 32,
            outputType: "binary"
        });
        masterKeys.clear();
        masterKeys.set(password, promise);
    }
    return promise;
}

function contextInfo(kind: "msg" | "file", presetIndex: number, channelId: string, senderId: string): Uint8Array {
    const label = new TextEncoder().encode(`dcenc2/${kind}`);
    const channel = new TextEncoder().encode(channelId);
    const sender = new TextEncoder().encode(senderId);
    if (channel.length > 0xffff || sender.length > 0xffff) throw new Error("Invalid Aegires context");
    return concatBytes(label, new Uint8Array([presetIndex]), putBe16(channel.length), channel, putBe16(sender.length), sender);
}

async function deriveSubkey(master: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey("raw", arrayBuffer(master), "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: arrayBuffer(salt), info: arrayBuffer(info) }, key, length * 8));
}

async function cryptGcm(encrypt: boolean, keyBytes: Uint8Array, nonce: Uint8Array, tagBytes: number, aad: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey("raw", arrayBuffer(keyBytes), "AES-GCM", false, [encrypt ? "encrypt" : "decrypt"]);
    const algorithm = { name: "AES-GCM", iv: arrayBuffer(nonce), additionalData: arrayBuffer(aad), tagLength: tagBytes * 8 } as AesGcmParams;
    const result = encrypt
        ? await crypto.subtle.encrypt(algorithm, key, arrayBuffer(data))
        : await crypto.subtle.decrypt(algorithm, key, arrayBuffer(data));
    return new Uint8Array(result);
}

function makeAad(header: number, salt: Uint8Array, info: Uint8Array): Uint8Array {
    return concatBytes(new Uint8Array([header]), salt, info);
}

function makeFileNonce(prefix: Uint8Array, counter: number, last: boolean): Uint8Array {
    return concatBytes(prefix, putBe32(counter), new Uint8Array([last ? 1 : 0]));
}

export async function encryptAegiresText(plaintext: string, password: string, channelId: string, senderId: string, preset: AegiresPreset): Promise<string> {
    const p = presetInfo[preset];
    const plain = new TextEncoder().encode(plaintext);
    const padded = new Uint8Array(Math.ceil((plain.length + 1) / p.padBlock) * p.padBlock);
    padded.set(plain);
    padded[plain.length] = 0x80;

    const header = (MESSAGE_VERSION << 4) | p.index;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const info = contextInfo("msg", p.index, channelId, senderId);
    const master = await deriveMasterKey(password);
    const okm = await deriveSubkey(master, salt, info, p.keyBytes + 12);
    const encrypted = await cryptGcm(true, okm.slice(0, p.keyBytes), okm.slice(p.keyBytes), p.tagBytes, makeAad(header, salt, info), padded);
    return PREFIX + bytesToBase64(concatBytes(new Uint8Array([header]), salt, encrypted)).replace(/=+$/, "");
}

export async function decryptAegiresText(wire: string, password: string, channelId: string, senderId: string): Promise<string | null> {
    if (!looksEncrypted(wire)) return null;
    try {
        const raw = base64ToBytes(wire.slice(PREFIX.length));
        if (raw.length < 1 + 16 + 16 || (raw[0] >>> 4) !== MESSAGE_VERSION) return null;
        const preset = presetByIndex[raw[0] & 0x0f];
        if (!preset) return null;
        const p = presetInfo[preset];
        const salt = raw.slice(1, 17);
        const info = contextInfo("msg", p.index, channelId, senderId);
        const master = await deriveMasterKey(password);
        const okm = await deriveSubkey(master, salt, info, p.keyBytes + 12);
        const plain = await cryptGcm(false, okm.slice(0, p.keyBytes), okm.slice(p.keyBytes), p.tagBytes, makeAad(raw[0], salt, info), raw.slice(17));
        let end = plain.length;
        while (end > 0 && plain[end - 1] === 0) end--;
        if (end === 0 || plain[end - 1] !== 0x80) return null;
        return new TextDecoder().decode(plain.slice(0, end - 1));
    } catch {
        return null;
    }
}

export async function encryptAegiresFile(plaintext: Uint8Array, password: string, channelId: string, senderId: string, preset: AegiresPreset): Promise<Uint8Array> {
    const p = presetInfo[preset];
    const header = (FILE_VERSION << 4) | p.index;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const info = contextInfo("file", p.index, channelId, senderId);
    const master = await deriveMasterKey(password);
    const okm = await deriveSubkey(master, salt, info, p.keyBytes + 7);
    const aad = makeAad(header, salt, info);
    const chunks: Uint8Array[] = [new Uint8Array([header]), salt];
    const count = Math.max(1, Math.ceil(plaintext.length / FILE_CHUNK_BYTES));
    for (let i = 0; i < count; i++) {
        const chunk = plaintext.slice(i * FILE_CHUNK_BYTES, Math.min((i + 1) * FILE_CHUNK_BYTES, plaintext.length));
        chunks.push(await cryptGcm(true, okm.slice(0, p.keyBytes), makeFileNonce(okm.slice(p.keyBytes), i, i === count - 1), p.tagBytes, aad, chunk));
    }
    return concatBytes(...chunks);
}

export async function decryptAegiresFile(wire: Uint8Array, password: string, channelId: string, senderId: string): Promise<Uint8Array | null> {
    try {
        if (wire.length < 1 + 16 + 14 || (wire[0] >>> 4) !== FILE_VERSION) return null;
        const preset = presetByIndex[wire[0] & 0x0f];
        if (!preset) return null;
        const p = presetInfo[preset];
        const salt = wire.slice(1, 17);
        const info = contextInfo("file", p.index, channelId, senderId);
        const master = await deriveMasterKey(password);
        const okm = await deriveSubkey(master, salt, info, p.keyBytes + 7);
        const aad = makeAad(wire[0], salt, info);
        const chunkCipherBytes = FILE_CHUNK_BYTES + p.tagBytes;
        const chunks: Uint8Array[] = [];
        let offset = 17;
        let counter = 0;
        while (offset < wire.length) {
            const length = Math.min(chunkCipherBytes, wire.length - offset);
            if (length < p.tagBytes) return null;
            const last = offset + length === wire.length;
            chunks.push(await cryptGcm(false, okm.slice(0, p.keyBytes), makeFileNonce(okm.slice(p.keyBytes), counter, last), p.tagBytes, aad, wire.slice(offset, offset + length)));
            offset += length;
            counter++;
        }
        return concatBytes(...chunks);
    } catch {
        return null;
    }
}
