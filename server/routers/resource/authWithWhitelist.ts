import { generateSessionToken } from "@server/auth/sessions/app";
import db from "@server/db";
import {
    orgs,
    resourceOtp,
    resources,
    resourceWhitelist
} from "@server/db/schema";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import { eq, and } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import {
    createResourceSession,
} from "@server/auth/sessions/resource";
import { isValidOtp, sendResourceOtpEmail } from "@server/auth/resourceOtp";
import logger from "@server/logger";

const authWithWhitelistBodySchema = z
    .object({
        email: z
            .string()
            .email()
            .transform((v) => v.toLowerCase()),
        otp: z.string().optional()
    })
    .strict();

const authWithWhitelistParamsSchema = z
    .object({
        resourceId: z
            .string()
            .transform(Number)
            .pipe(z.number().int().positive())
    })
    .strict();

export type AuthWithWhitelistResponse = {
    otpSent?: boolean;
    session?: string;
};

export async function authWithWhitelist(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedBody = authWithWhitelistBodySchema.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const parsedParams = authWithWhitelistParamsSchema.safeParse(req.params);

    if (!parsedParams.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedParams.error).toString()
            )
        );
    }

    const { resourceId } = parsedParams.data;
    const { email, otp } = parsedBody.data;

    try {
        const [result] = await db
            .select()
            .from(resourceWhitelist)
            .where(
                and(
                    eq(resourceWhitelist.resourceId, resourceId),
                    eq(resourceWhitelist.email, email)
                )
            )
            .leftJoin(
                resources,
                eq(resources.resourceId, resourceWhitelist.resourceId)
            )
            .leftJoin(orgs, eq(orgs.orgId, resources.orgId))
            .limit(1);

        const resource = result?.resources;
        const org = result?.orgs;
        const whitelistedEmail = result?.resourceWhitelist;

        if (!whitelistedEmail) {
            return next(
                createHttpError(
                    HttpCode.UNAUTHORIZED,
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Email is not whitelisted"
                    )
                )
            );
        }

        if (!org) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Resource does not exist")
            );
        }

        if (!resource) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Resource does not exist")
            );
        }

        if (otp && email) {
            const isValidCode = await isValidOtp(
                email,
                resource.resourceId,
                otp
            );
            if (!isValidCode) {
                return next(
                    createHttpError(HttpCode.UNAUTHORIZED, "Incorrect OTP")
                );
            }

            await db
                .delete(resourceOtp)
                .where(
                    and(
                        eq(resourceOtp.email, email),
                        eq(resourceOtp.resourceId, resource.resourceId)
                    )
                );
        } else if (email) {
            try {
                await sendResourceOtpEmail(
                    email,
                    resource.resourceId,
                    resource.name,
                    org.name
                );
                return response<AuthWithWhitelistResponse>(res, {
                    data: { otpSent: true },
                    success: true,
                    error: false,
                    message: "Sent one-time otp to email address",
                    status: HttpCode.ACCEPTED
                });
            } catch (e) {
                logger.error(e);
                return next(
                    createHttpError(
                        HttpCode.INTERNAL_SERVER_ERROR,
                        "Failed to send one-time otp. Make sure the email address is correct and try again."
                    )
                );
            }
        } else {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Email is required for whitelist authentication"
                )
            );
        }

        const token = generateSessionToken();
        await createResourceSession({
            resourceId,
            token,
            whitelistId: whitelistedEmail.whitelistId,
            isRequestToken: true,
            expiresAt: Date.now() + 1000 * 30, // 30 seconds
            sessionLength: 1000 * 30,
            doNotExtend: true
        });

        return response<AuthWithWhitelistResponse>(res, {
            data: {
                session: token
            },
            success: true,
            error: false,
            message: "Authenticated with resource successfully",
            status: HttpCode.OK
        });
    } catch (e) {
        logger.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to authenticate with resource"
            )
        );
    }
}
