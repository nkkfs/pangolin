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
import logger from "@server/logger";

const createResourceParamsSchema = z
    .object({
        siteId: z.string().transform(stoi).pipe(z.number().int().positive()),
        orgId: z.string()
    })
    .strict();

const createResourceSchema = z
    .object({
        subdomain: z
            .union([
                z
                    .string()
                    .regex(
                        /^(?!:\/\/)([a-zA-Z0-9-_]+\.)*[a-zA-Z0-9-_]+$/,
                        "Invalid subdomain format"
                    )
                    .min(1, "Subdomain must be at least 1 character long")
                    .transform((val) => val.toLowerCase()),
                z.string().optional()
            ])
            .optional(),
        name: z.string().min(1).max(255),
        http: z.boolean(),
        protocol: z.string(),
        proxyPort: z.number().int().min(1).max(65535).optional(),
    }).refine(
        (data) => {
            if (data.http === true) {
                return true;
            }
            return !!data.proxyPort;
        },
        {
            message: "Port number is required for non-HTTP resources",
            path: ["proxyPort"]
        }
    );
    
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

        let { name, subdomain, protocol, proxyPort, http } = parsedBody.data;

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
        // if http is false check to see if there is already a resource with the same port and protocol
        if (!http) {
            const existingResource = await db
                .select()
                .from(resources)
                .where(
                    and(
                        eq(resources.protocol, protocol),
                        eq(resources.proxyPort, proxyPort!)
                    )
                );

            if (existingResource.length > 0) {
                return next(
                    createHttpError(
                        HttpCode.CONFLICT,
                        "Resource with that protocol and port already exists"
                    )
                );
            }
        } else {

            if (proxyPort === 443 || proxyPort === 80) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Port 80 and 443 are reserved for https resources"
                    )
                );
            }

            // make sure the full domain is unique
            const existingResource = await db
                .select()
                .from(resources)
                .where(eq(resources.fullDomain, fullDomain));
            
            if (existingResource.length > 0) {
                return next(
                    createHttpError(
                        HttpCode.CONFLICT,
                        "Resource with that domain already exists"
                    )
                );
            }
        }

        await db.transaction(async (trx) => {
            const newResource = await trx
                .insert(resources)
                .values({
                    siteId,
                    fullDomain: http? fullDomain : null,
                    orgId,
                    name,
                    subdomain,
                    http,
                    protocol,
                    proxyPort,
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
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
