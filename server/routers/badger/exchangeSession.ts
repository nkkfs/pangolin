import HttpCode from "@server/types/HttpCode";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import logger from "@server/logger";
import { resourceAccessToken, resources, sessions } from "@server/db/schema";
import db from "@server/db";
import { eq } from "drizzle-orm";
import {
    createResourceSession,
    serializeResourceSessionCookie,
    validateResourceSessionToken
} from "@server/auth/sessions/resource";
import { generateSessionToken } from "@server/auth";
import { SESSION_COOKIE_EXPIRES } from "@server/auth/sessions/app";
import { SESSION_COOKIE_EXPIRES as RESOURCE_SESSION_COOKIE_EXPIRES } from "@server/auth/sessions/resource";
import config from "@server/lib/config";
import { response } from "@server/lib";

const exchangeSessionBodySchema = z.object({
    requestToken: z.string(),
    host: z.string()
});

export type ExchangeSessionBodySchema = z.infer<
    typeof exchangeSessionBodySchema
>;

export type ExchangeSessionResponse = {
    valid: boolean;
    cookie?: string;
};

export async function exchangeSession(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    logger.debug("Exchange session: Badger sent", req.body);

    const parsedBody = exchangeSessionBodySchema.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    try {
        const { requestToken, host } = parsedBody.data;

        const [resource] = await db
            .select()
            .from(resources)
            .where(eq(resources.fullDomain, host))
            .limit(1);

        if (!resource) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with host ${host} not found`
                )
            );
        }

        const { resourceSession: requestSession } =
            await validateResourceSessionToken(
                requestToken,
                resource.resourceId
            );

        if (!requestSession) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Invalid request token")
            );
        }

        if (!requestSession.isRequestToken) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Invalid request token")
            );
        }

        await db.delete(sessions).where(eq(sessions.sessionId, requestToken));

        const token = generateSessionToken();

        if (requestSession.userSessionId) {
            const [res] = await db
                .select()
                .from(sessions)
                .where(eq(sessions.sessionId, requestSession.userSessionId))
                .limit(1);
            if (res) {
                await createResourceSession({
                    token,
                    resourceId: resource.resourceId,
                    isRequestToken: false,
                    userSessionId: requestSession.userSessionId,
                    doNotExtend: false,
                    expiresAt: res.expiresAt,
                    sessionLength: SESSION_COOKIE_EXPIRES
                });
            }
        } else if (requestSession.accessTokenId) {
            const [res] = await db
                .select()
                .from(resourceAccessToken)
                .where(
                    eq(
                        resourceAccessToken.accessTokenId,
                        requestSession.accessTokenId
                    )
                )
                .limit(1);
            if (res) {
                await createResourceSession({
                    token,
                    resourceId: resource.resourceId,
                    isRequestToken: false,
                    accessTokenId: requestSession.accessTokenId,
                    doNotExtend: true,
                    expiresAt: res.expiresAt,
                    sessionLength: res.sessionLength
                });
            }
        } else {
            await createResourceSession({
                token,
                resourceId: resource.resourceId,
                isRequestToken: false,
                passwordId: requestSession.passwordId,
                pincodeId: requestSession.pincodeId,
                userSessionId: requestSession.userSessionId,
                whitelistId: requestSession.whitelistId,
                accessTokenId: requestSession.accessTokenId,
                doNotExtend: false,
                expiresAt: new Date(
                    Date.now() + SESSION_COOKIE_EXPIRES
                ).getTime(),
                sessionLength: RESOURCE_SESSION_COOKIE_EXPIRES
            });
        }

        const cookieName = `${config.getRawConfig().server.session_cookie_name}`;
        const cookie = serializeResourceSessionCookie(
            cookieName,
            resource.fullDomain,
            token,
            !resource.ssl
        );

        logger.debug(JSON.stringify("Exchange cookie: " + cookie));
        return response<ExchangeSessionResponse>(res, {
            data: { valid: true, cookie },
            success: true,
            error: false,
            message: "Session exchanged successfully",
            status: HttpCode.OK
        });
    } catch (e) {
        console.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to exchange session"
            )
        );
    }
}
