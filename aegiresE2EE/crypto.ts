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

    try {
        const iv = combined.slice(0, IV_BYTES);
        const ciphertext = combined.slice(IV_BYTES);
        const key = await deriveKey(password);
        return new Uint8Array(await crypto.subtle.decrypt(
            { name: "AES-GCM", iv, tagLength: TAG_BITS },
            key,
            ciphertext
        ));
    } catch {
        return null;
    }
}
