// ============================================
// AES-256-GCM Encryption at Rest
// ============================================

import crypto from "crypto";
import { env } from "./env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
    const hex = env.ENCRYPTION_KEY;
    if (hex.length !== 64) {
        throw new Error("ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
    }
    return Buffer.from(hex, "hex");
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns base64 string in format: iv:authTag:ciphertext
 */
export function encrypt(plaintext: string): string {
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
        iv.toString("base64"),
        authTag.toString("base64"),
        encrypted.toString("base64"),
    ].join(":");
}

/**
 * Decrypt a string produced by encrypt().
 */
export function decrypt(encrypted: string): string {
    const key = getKey();
    const parts = encrypted.split(":");

    if (parts.length !== 3) {
        throw new Error("Invalid encrypted data format");
    }

    const iv = Buffer.from(parts[0]!, "base64");
    const authTag = Buffer.from(parts[1]!, "base64");
    const ciphertext = Buffer.from(parts[2]!, "base64");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
    ]).toString("utf8");
}

/**
 * Check if a string looks like it was encrypted by this module.
 */
export function isEncrypted(value: string): boolean {
    const parts = value.split(":");
    return parts.length === 3 && parts.every((p) => p.length > 0);
}
