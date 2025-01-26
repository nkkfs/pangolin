import {
    encodeBase32LowerCaseNoPadding,
    encodeHexLowerCase
} from "@oslojs/encoding";
import { sha256 } from "@oslojs/crypto/sha2";
import {
    resourceSessions,
    Session,
    sessions,
    User,
    users
} from "@server/db/schema";
import db from "@server/db";
import { eq } from "drizzle-orm";
import config from "@server/lib/config";
import type { RandomReader } from "@oslojs/crypto/random";
import { generateRandomString } from "@oslojs/crypto/random";
import logger from "@server/logger";

export const SESSION_COOKIE_NAME =
    config.getRawConfig().server.session_cookie_name;
export const SESSION_COOKIE_EXPIRES =
    1000 *
    60 *
    60 *
    config.getRawConfig().server.dashboard_session_length_hours;
export const SECURE_COOKIES = config.getRawConfig().server.secure_cookies;
export const COOKIE_DOMAIN =
    "." + new URL(config.getRawConfig().app.dashboard_url).hostname;

export function generateSessionToken(): string {
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    const token = encodeBase32LowerCaseNoPadding(bytes);
    return token;
}

export async function createSession(
    token: string,
    userId: string
): Promise<Session> {
    const sessionId = encodeHexLowerCase(
        sha256(new TextEncoder().encode(token))
    );
    const session: Session = {
        sessionId: sessionId,
        userId,
        expiresAt: new Date(Date.now() + SESSION_COOKIE_EXPIRES).getTime()
    };
    await db.insert(sessions).values(session);
    return session;
}

export async function validateSessionToken(
    token: string
): Promise<SessionValidationResult> {
    const sessionId = encodeHexLowerCase(
        sha256(new TextEncoder().encode(token))
    );
    const result = await db
        .select({ user: users, session: sessions })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.userId))
        .where(eq(sessions.sessionId, sessionId));
    if (result.length < 1) {
        return { session: null, user: null };
    }
    const { user, session } = result[0];
    if (Date.now() >= session.expiresAt) {
        await db
            .delete(sessions)
            .where(eq(sessions.sessionId, session.sessionId));
        return { session: null, user: null };
    }
    if (Date.now() >= session.expiresAt - SESSION_COOKIE_EXPIRES / 2) {
        session.expiresAt = new Date(
            Date.now() + SESSION_COOKIE_EXPIRES
        ).getTime();
        await db.transaction(async (trx) => {
            await trx
                .update(sessions)
                .set({
                    expiresAt: session.expiresAt
                })
                .where(eq(sessions.sessionId, session.sessionId));

            await trx
                .update(resourceSessions)
                .set({
                    expiresAt: session.expiresAt
                })
                .where(eq(resourceSessions.userSessionId, session.sessionId));
        });
    }
    return { session, user };
}

export async function invalidateSession(sessionId: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.sessionId, sessionId));
}

export async function invalidateAllSessions(userId: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.userId, userId));
}

export function serializeSessionCookie(
    token: string,
    isSecure: boolean
): string {
    if (isSecure) {
        logger.debug("Setting cookie for secure origin");
        if (SECURE_COOKIES) {
            return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_COOKIE_EXPIRES / 1000}; Path=/; Secure; Domain=${COOKIE_DOMAIN}`;
        } else {
            return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_COOKIE_EXPIRES / 1000}; Path=/; Domain=${COOKIE_DOMAIN}`;
        }
    } else {
        return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Max-Age=${SESSION_COOKIE_EXPIRES}; Path=/;`;
    }
}

export function createBlankSessionTokenCookie(isSecure: boolean): string {
    if (isSecure) {
        if (SECURE_COOKIES) {
            return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/; Secure; Domain=${COOKIE_DOMAIN}`;
        } else {
            return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/; Domain=${COOKIE_DOMAIN}`;
        }
    } else {
        return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/;`;
    }
}

const random: RandomReader = {
    read(bytes: Uint8Array): void {
        crypto.getRandomValues(bytes);
    }
};

export function generateId(length: number): string {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    return generateRandomString(random, alphabet, length);
}

export function generateIdFromEntropySize(size: number): string {
    const buffer = crypto.getRandomValues(new Uint8Array(size));
    return encodeBase32LowerCaseNoPadding(buffer);
}

export type SessionValidationResult =
    | { session: Session; user: User }
    | { session: null; user: null };
