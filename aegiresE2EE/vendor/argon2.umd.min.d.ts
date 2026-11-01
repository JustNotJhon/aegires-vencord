export function argon2id(options: {
    password: Uint8Array;
    salt: Uint8Array;
    iterations: number;
    parallelism: number;
    memorySize: number;
    hashLength: number;
    outputType: "binary";
}): Promise<Uint8Array>;
