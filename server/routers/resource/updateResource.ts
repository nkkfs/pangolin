import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { orgs, resources, sites } from "@server/db/schema";
import { eq, or } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { subdomainSchema } from "@server/schemas/subdomainSchema";

const updateResourceParamsSchema = z
    .object({
        resourceId: z
            .string()
            .transform(Number)
            .pipe(z.number().int().positive())
    })
    .strict();

const updateResourceBodySchema = z
    .object({
        name: z.string().min(1).max(255).optional(),
        subdomain: subdomainSchema.optional(),
        ssl: z.boolean().optional(),
        sso: z.boolean().optional(),
        blockAccess: z.boolean().optional(),
        proxyPort: z.number().int().min(1).max(65535).optional(),
        emailWhitelistEnabled: z.boolean().optional()
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
        message: "At least one field must be provided for update"
    });

export async function updateResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = updateResourceParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = updateResourceBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { resourceId } = parsedParams.data;
        const updateData = parsedBody.data;

        const resource = await db
            .select()
            .from(resources)
            .where(eq(resources.resourceId, resourceId))
            .leftJoin(orgs, eq(resources.orgId, orgs.orgId));

        if (resource.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with ID ${resourceId} not found`
                )
            );
        }

        if (!resource[0].orgs?.domain) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Resource does not have a domain"
                )
            );
        }

        const fullDomain = updateData.subdomain
            ? `${updateData.subdomain}.${resource[0].orgs.domain}`
            : undefined;

        const updatePayload = {
            ...updateData,
            ...(fullDomain && { fullDomain })
        };

        const updatedResource = await db
            .update(resources)
            .set(updatePayload)
            .where(eq(resources.resourceId, resourceId))
            .returning();

        if (updatedResource.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with ID ${resourceId} not found`
                )
            );
        }

        if (resource[0].resources.ssl !== updatedResource[0].ssl) {
            // invalidate all sessions?
        }

        return response(res, {
            data: updatedResource[0],
            success: true,
            error: false,
            message: "Resource updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
