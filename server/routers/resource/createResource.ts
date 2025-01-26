import { SqliteError } from "better-sqlite3";
import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import {
    orgs,
    Resource,
    resources,
    roleResources,
    roles,
    userResources
} from "@server/db/schema";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { eq, and } from "drizzle-orm";
import stoi from "@server/lib/stoi";
import { fromError } from "zod-validation-error";
import { subdomainSchema } from "@server/schemas/subdomainSchema";
import logger from "@server/logger";

const createResourceParamsSchema = z
    .object({
        siteId: z.string().transform(stoi).pipe(z.number().int().positive()),
        orgId: z.string()
    })
    .strict();

const createResourceSchema = z
    .object({
        name: z.string().min(1).max(255),
        subdomain: subdomainSchema,
        proxyPort: z.number().int().min(1).max(65535).optional(),
    })
    .strict();

export type CreateResourceResponse = Resource;

export async function createResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = createResourceSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        let { name, subdomain } = parsedBody.data;

        // Validate request params
        const parsedParams = createResourceParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { siteId, orgId } = parsedParams.data;

        if (!req.userOrgRoleId) {
            return next(
                createHttpError(HttpCode.FORBIDDEN, "User does not have a role")
            );
        }

        // get the org
        const org = await db
            .select()
            .from(orgs)
            .where(eq(orgs.orgId, orgId))
            .limit(1);

        if (org.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Organization with ID ${orgId} not found`
                )
            );
        }

        const fullDomain = `${subdomain}.${org[0].domain}`;
        await db.transaction(async (trx) => {
            const newResource = await trx
                .insert(resources)
                .values({
                    siteId,
                    fullDomain,
                    orgId,
                    name,
                    subdomain,
                    ssl: true
                })
                .returning();

            const adminRole = await db
                .select()
                .from(roles)
                .where(and(eq(roles.isAdmin, true), eq(roles.orgId, orgId)))
                .limit(1);

            if (adminRole.length === 0) {
                return next(
                    createHttpError(HttpCode.NOT_FOUND, `Admin role not found`)
                );
            }

            await trx.insert(roleResources).values({
                roleId: adminRole[0].roleId,
                resourceId: newResource[0].resourceId
            });

            if (req.userOrgRoleId != adminRole[0].roleId) {
                // make sure the user can access the resource
                await trx.insert(userResources).values({
                    userId: req.user?.userId!,
                    resourceId: newResource[0].resourceId
                });
            }
            response<CreateResourceResponse>(res, {
                data: newResource[0],
                success: true,
                error: false,
                message: "Resource created successfully",
                status: HttpCode.CREATED
            });
        });
    } catch (error) {
        if (
            error instanceof SqliteError &&
            error.code === "SQLITE_CONSTRAINT_UNIQUE"
        ) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    "Resource with that subdomain already exists"
                )
            );
        }

        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
