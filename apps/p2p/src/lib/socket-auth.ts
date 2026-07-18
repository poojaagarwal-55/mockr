import type { Socket } from "socket.io";
import { verifyAccessToken } from "./supabase.js";

export type AuthenticatedSocket = Socket & {
    data: Socket["data"] & {
        user: {
            id: string;
            email: string;
        };
    };
};

export async function authenticateSocket(socket: Socket): Promise<{ id: string; email: string } | null> {
    const token = socket.handshake.auth?.token;

    if (typeof token !== "string" || token.length < 10) {
        return null;
    }

    return verifyAccessToken(token);
}
