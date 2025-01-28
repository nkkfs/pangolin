import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { resources, resourceWhitelist } from "@server/db/schema";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { and, eq } from "drizzle-orm";

const setResourceWhitelistBodySchema = z
    .object({
        emails: z
            .array(
                z
                    .string()
                    .email()
                    .or(
                        z.string().regex(/^\*@[\w.-]+\.[a-zA-Z]{2,}$/, {
                            message:
                                "Invalid email address. Wildcard (*) must be the entire local part."
                        })
                    )
            )
            .max(50)
            .transform((v) => v.map((e) => e.toLowerCase()))
    })
    .strict();

const setResourceWhitelistParamsSchema = z
    .object({
        resourceId: z
            .string()
            .transform(Number)
            .pipe(z.number().int().positive())
    })
    .strict();

export async function setResourceWhitelist(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = setResourceWhitelistBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { emails } = parsedBody.data;

        const parsedParams = setResourceWhitelistParamsSchema.safeParse(
            req.params
        );
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { resourceId } = parsedParams.data;

        const [resource] = await db
            .select()
            .from(resources)
            .where(eq(resources.resourceId, resourceId));

        if (!resource) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Resource not found")
            );
        }

        if (!resource.emailWhitelistEnabled) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Email whitelist is not enabled for this resource"
                )
            );
        }

        const whitelist = await db
            .select()
            .from(resourceWhitelist)
            .where(eq(resourceWhitelist.resourceId, resourceId));

        await db.transaction(async (trx) => {
            // diff the emails
            const existingEmails = whitelist.map((w) => w.email);

            const emailsToAdd = emails.filter(
                (e) => !existingEmails.includes(e)
            );
            const emailsToRemove = existingEmails.filter(
                (e) => !emails.includes(e)
            );

            for (const email of emailsToAdd) {
                await trx.insert(resourceWhitelist).values({
                    email,
                    resourceId
                });
            }

            for (const email of emailsToRemove) {
                await trx
                    .delete(resourceWhitelist)
                    .where(
                        and(
                            eq(resourceWhitelist.resourceId, resourceId),
                            eq(resourceWhitelist.email, email)
                        )
                    );
            }

            return response(res, {
                data: {},
                success: true,
                error: false,
                message: "Whitelist set for resource successfully",
                status: HttpCode.CREATED
            });
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
