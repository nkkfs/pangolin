import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import {
    resources,
    sites,
    userResources,
    roleResources,
    resourcePassword,
    resourcePincode
} from "@server/db/schema";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { sql, eq, or, inArray, and, count } from "drizzle-orm";
import logger from "@server/logger";
import stoi from "@server/lib/stoi";

const listResourcesParamsSchema = z
    .object({
        siteId: z
            .string()
            .optional()
            .transform(stoi)
            .pipe(z.number().int().positive().optional()),
        orgId: z.string().optional()
    })
    .strict()
    .refine((data) => !!data.siteId !== !!data.orgId, {
        message: "Either siteId or orgId must be provided, but not both"
    });

const listResourcesSchema = z.object({
    limit: z
        .string()
        .optional()
        .default("1000")
        .transform(Number)
        .pipe(z.number().int().nonnegative()),

    offset: z
        .string()
        .optional()
        .default("0")
        .transform(Number)
        .pipe(z.number().int().nonnegative())
});

function queryResources(
    accessibleResourceIds: number[],
    siteId?: number,
    orgId?: string
) {
    if (siteId) {
        return db
            .select({
                resourceId: resources.resourceId,
                name: resources.name,
                fullDomain: resources.fullDomain,
                ssl: resources.ssl,
                siteName: sites.name,
                siteId: sites.niceId,
                passwordId: resourcePassword.passwordId,
                pincodeId: resourcePincode.pincodeId,
                sso: resources.sso,
                whitelist: resources.emailWhitelistEnabled,
                http: resources.http,
                protocol: resources.protocol,
                proxyPort: resources.proxyPort
            })
            .from(resources)
            .leftJoin(sites, eq(resources.siteId, sites.siteId))
            .leftJoin(
                resourcePassword,
                eq(resourcePassword.resourceId, resources.resourceId)
            )
            .leftJoin(
                resourcePincode,
                eq(resourcePincode.resourceId, resources.resourceId)
            )
            .where(
                and(
                    inArray(resources.resourceId, accessibleResourceIds),
                    eq(resources.siteId, siteId)
                )
            );
    } else if (orgId) {
        return db
            .select({
                resourceId: resources.resourceId,
                name: resources.name,
                ssl: resources.ssl,
                fullDomain: resources.fullDomain,
                siteName: sites.name,
                siteId: sites.niceId,
                passwordId: resourcePassword.passwordId,
                sso: resources.sso,
                pincodeId: resourcePincode.pincodeId,
                whitelist: resources.emailWhitelistEnabled,
                http: resources.http,
                protocol: resources.protocol,
                proxyPort: resources.proxyPort
            })
            .from(resources)
            .leftJoin(sites, eq(resources.siteId, sites.siteId))
            .leftJoin(
                resourcePassword,
                eq(resourcePassword.resourceId, resources.resourceId)
            )
            .leftJoin(
                resourcePincode,
                eq(resourcePincode.resourceId, resources.resourceId)
            )
            .where(
                and(
                    inArray(resources.resourceId, accessibleResourceIds),
                    eq(resources.orgId, orgId)
                )
            );
    }
}

export type ListResourcesResponse = {
    resources: NonNullable<Awaited<ReturnType<typeof queryResources>>>;
    pagination: { total: number; limit: number; offset: number };
};

export async function listResources(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = listResourcesSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    parsedQuery.error.errors.map((e) => e.message).join(", ")
                )
            );
        }
        const { limit, offset } = parsedQuery.data;

        const parsedParams = listResourcesParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    parsedParams.error.errors.map((e) => e.message).join(", ")
                )
            );
        }
        const { siteId, orgId } = parsedParams.data;

        if (orgId && orgId !== req.userOrgId) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this organization"
                )
            );
        }

        const accessibleResources = await db
            .select({
                resourceId: sql<number>`COALESCE(${userResources.resourceId}, ${roleResources.resourceId})`
            })
            .from(userResources)
            .fullJoin(
                roleResources,
                eq(userResources.resourceId, roleResources.resourceId)
            )
            .where(
                or(
                    eq(userResources.userId, req.user!.userId),
                    eq(roleResources.roleId, req.userOrgRoleId!)
                )
            );

        const accessibleResourceIds = accessibleResources.map(
            (resource) => resource.resourceId
        );

        let countQuery: any = db
            .select({ count: count() })
            .from(resources)
            .where(inArray(resources.resourceId, accessibleResourceIds));

        const baseQuery = queryResources(accessibleResourceIds, siteId, orgId);

        const resourcesList = await baseQuery!.limit(limit).offset(offset);
        const totalCountResult = await countQuery;
        const totalCount = totalCountResult[0].count;

        return response<ListResourcesResponse>(res, {
            data: {
                resources: resourcesList,
                pagination: {
                    total: totalCount,
                    limit,
                    offset
                }
            },
            success: true,
            error: false,
            message: "Resources retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
