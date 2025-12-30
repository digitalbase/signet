/**
 * Simple hex encoding/decoding utilities.
 */

const HEX_REGEX = /^[0-9a-fA-F]*$/;

export function hexToBytes(hex: string): Uint8Array {
    if (hex.length % 2 !== 0) {
        throw new Error('Invalid hex string: odd length');
    }
    if (!HEX_REGEX.test(hex)) {
        throw new Error('Invalid hex string: contains non-hex characters');
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
