import crypto from "crypto";
import { prisma } from "../lib/prisma.js";

/**
 * Generate a secure random device token
 * 32 bytes = 256 bits of entropy
 */
export function generateDeviceToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Check if a device token exists and is valid for a user
 * Returns userId if valid, null otherwise
 */
export async function validateDeviceToken(deviceToken: string): Promise<string | null> {
  if (!deviceToken) return null;

  try {
    const user = await prisma.user.findFirst({
      where: {
        deviceToken,
        // Token should be less than 30 days old
        deviceTokenCreatedAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
      select: { id: true },
    });

    return user?.id || null;
  } catch (error) {
    console.error("[DeviceToken] Validation error:", error);
    return null;
  }
}

/**
 * Store device token for a user
 */
export async function storeDeviceToken(userId: string, deviceToken: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      deviceToken,
      deviceTokenCreatedAt: new Date(),
    },
  });
}

/**
 * Clear device token for a user (on logout or security event)
 */
export async function clearDeviceToken(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      deviceToken: null,
      deviceTokenCreatedAt: null,
    },
  });
}
