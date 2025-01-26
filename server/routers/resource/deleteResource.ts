import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { newts, resources, sites, targets } from "@server/db/schema";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { addPeer } from "../gerbil/peers";
import { removeTargets } from "../newt/targets";

// Define Zod schema for request parameters validation
const deleteResourceSchema = z
    .object({
        resourceId: z
            .string()
            .transform(Number)
            .pipe(z.number().int().positive())
    })
    .strict();

export async function deleteResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = deleteResourceSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { resourceId } = parsedParams.data;

        const targetsToBeRemoved = await db
            .select()
            .from(targets)
            .where(eq(targets.resourceId, resourceId));

        const [deletedResource] = await db
            .delete(resources)
            .where(eq(resources.resourceId, resourceId))
            .returning();

        if (!deletedResource) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with ID ${resourceId} not found`
                )
            );
        }

        const [site] = await db
            .select()
            .from(sites)
            .where(eq(sites.siteId, deletedResource.siteId!))
            .limit(1);

        if (!site) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Site with ID ${deletedResource.siteId} not found`
                )
            );
        }

        if (site.pubKey) {
            if (site.type == "wireguard") {
                // TODO: is this all inefficient?
                // Fetch resources for this site
                const resourcesRes = await db.query.resources.findMany({
                    where: eq(resources.siteId, site.siteId)
                });

                // Fetch targets for all resources of this site
                const targetIps = await Promise.all(
                    resourcesRes.map(async (resource) => {
                        const targetsRes = await db.query.targets.findMany({
                            where: eq(targets.resourceId, resource.resourceId)
                        });
                        return targetsRes.map((target) => `${target.ip}/32`);
                    })
                );

                await addPeer(site.exitNodeId!, {
                    publicKey: site.pubKey,
                    allowedIps: targetIps.flat()
                });
            } else if (site.type == "newt") {
                // get the newt on the site by querying the newt table for siteId
                const [newt] = await db
                    .select()
                    .from(newts)
                    .where(eq(newts.siteId, site.siteId))
                    .limit(1);

                removeTargets(newt.newtId, targetsToBeRemoved, deletedResource.protocol);
            }
        }

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Resource deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
