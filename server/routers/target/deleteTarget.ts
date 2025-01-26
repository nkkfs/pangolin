import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { newts, resources, sites, targets } from "@server/db/schema";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { addPeer } from "../gerbil/peers";
import { fromError } from "zod-validation-error";
import { removeTargets } from "../newt/targets";

const deleteTargetSchema = z
    .object({
        targetId: z.string().transform(Number).pipe(z.number().int().positive())
    })
    .strict();

export async function deleteTarget(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = deleteTargetSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { targetId } = parsedParams.data;

        const [deletedTarget] = await db
            .delete(targets)
            .where(eq(targets.targetId, targetId))
            .returning();

        if (!deletedTarget) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Target with ID ${targetId} not found`
                )
            );
        }
        // get the resource
        const [resource] = await db
            .select()
            .from(resources)
            .where(eq(resources.resourceId, deletedTarget.resourceId!));

        if (!resource) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with ID ${deletedTarget.resourceId} not found`
                )
            );
        }

        const [site] = await db
            .select()
            .from(sites)
            .where(eq(sites.siteId, resource.siteId!))
            .limit(1);

        if (!site) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Site with ID ${resource.siteId} not found`
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

                removeTargets(newt.newtId, [deletedTarget], resource.protocol);
            }
        }

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Target deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
