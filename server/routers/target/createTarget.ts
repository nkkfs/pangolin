import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { newts, resources, sites, Target, targets } from "@server/db/schema";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { addPeer } from "../gerbil/peers";
import { isIpInCidr } from "@server/lib/ip";
import { fromError } from "zod-validation-error";
import { addTargets } from "../newt/targets";
import { eq } from "drizzle-orm";
import { pickPort } from "./ports";

// Regular expressions for validation
const DOMAIN_REGEX =
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const IPV4_REGEX =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const IPV6_REGEX = /^(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}$/i;

// Schema for domain names and IP addresses
const domainSchema = z
    .string()
    .min(1, "Domain cannot be empty")
    .max(255, "Domain name too long")
    .refine(
        (value) => {
            // Check if it's a valid IP address (v4 or v6)
            if (IPV4_REGEX.test(value) || IPV6_REGEX.test(value)) {
                return true;
            }

            // Check if it's a valid domain name
            return DOMAIN_REGEX.test(value);
        },
        {
            message: "Invalid domain name or IP address format",
            path: ["domain"]
        }
    );

const createTargetParamsSchema = z
    .object({
        resourceId: z
            .string()
            .transform(Number)
            .pipe(z.number().int().positive())
    })
    .strict();

const createTargetSchema = z
    .object({
        ip: domainSchema,
        method: z.string().optional().nullable(),
        port: z.number().int().min(1).max(65535),
        enabled: z.boolean().default(true)
    })
    .strict();

export type CreateTargetResponse = Target;

export async function createTarget(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = createTargetSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const targetData = parsedBody.data;

        const parsedParams = createTargetParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { resourceId } = parsedParams.data;

        // get the resource
        const [resource] = await db
            .select()
            .from(resources)
            .where(eq(resources.resourceId, resourceId));

        if (!resource) {
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

        let newTarget: Target[] = [];
        if (site.type == "local") {
            newTarget = await db
                .insert(targets)
                .values({
                    resourceId,
                    ...targetData
                })
                .returning();
        } else {
            // make sure the target is within the site subnet
            if (
                site.type == "wireguard" &&
                !isIpInCidr(targetData.ip, site.subnet!)
            ) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        `Target IP is not within the site subnet`
                    )
                );
            }

            const { internalPort, targetIps } = await pickPort(site.siteId!);

            if (!internalPort) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        `No available internal port`
                    )
                );
            }

            newTarget = await db
                .insert(targets)
                .values({
                    resourceId,
                    internalPort,
                    ...targetData
                })
                .returning();

            // add the new target to the targetIps array
            targetIps.push(`${targetData.ip}/32`);

            if (site.pubKey) {
                if (site.type == "wireguard") {
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

                    addTargets(newt.newtId, newTarget, resource.protocol);
                }
            }
        }

        return response<CreateTargetResponse>(res, {
            data: newTarget[0],
            success: true,
            error: false,
            message: "Target created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
