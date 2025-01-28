import db from "@server/db";
import { MessageHandler } from "../ws";
import {
    exitNodes,
    resources,
    sites,
    Target,
    targets
} from "@server/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { addPeer, deletePeer } from "../gerbil/peers";
import logger from "@server/logger";

export const handleRegisterMessage: MessageHandler = async (context) => {
    const { message, newt, sendToClient } = context;

    logger.info("Handling register message!");

    if (!newt) {
        logger.warn("Newt not found");
        return;
    }

    if (!newt.siteId) {
        logger.warn("Newt has no site!"); // TODO: Maybe we create the site here?
        return;
    }

    const siteId = newt.siteId;

    const { publicKey } = message.data;
    if (!publicKey) {
        logger.warn("Public key not provided");
        return;
    }

    const [site] = await db
        .select()
        .from(sites)
        .where(eq(sites.siteId, siteId))
        .limit(1);

    if (!site || !site.exitNodeId) {
        logger.warn("Site not found or does not have exit node");
        return;
    }

    await db
        .update(sites)
        .set({
            pubKey: publicKey
        })
        .where(eq(sites.siteId, siteId))
        .returning();

    const [exitNode] = await db
        .select()
        .from(exitNodes)
        .where(eq(exitNodes.exitNodeId, site.exitNodeId))
        .limit(1);

    if (site.pubKey && site.pubKey !== publicKey) {
        logger.info("Public key mismatch. Deleting old peer...");
        await deletePeer(site.exitNodeId, site.pubKey);
    }

    if (!site.subnet) {
        logger.warn("Site has no subnet");
        return;
    }

    // add the peer to the exit node
    await addPeer(site.exitNodeId, {
        publicKey: publicKey,
        allowedIps: [site.subnet]
    });

    const allResources = await db
        .select({
            // Resource fields
            resourceId: resources.resourceId,
            subdomain: resources.subdomain,
            fullDomain: resources.fullDomain,
            ssl: resources.ssl,
            blockAccess: resources.blockAccess,
            sso: resources.sso,
            emailWhitelistEnabled: resources.emailWhitelistEnabled,
            http: resources.http,
            proxyPort: resources.proxyPort,
            protocol: resources.protocol,
            // Targets as a subquery
            targets: sql<string>`json_group_array(json_object(
          'targetId', ${targets.targetId},
          'ip', ${targets.ip},
          'method', ${targets.method},
          'port', ${targets.port},
          'internalPort', ${targets.internalPort},
          'enabled', ${targets.enabled}
        ))`.as("targets")
        })
        .from(resources)
        .leftJoin(
            targets,
            and(
                eq(targets.resourceId, resources.resourceId),
                eq(targets.enabled, true)
            )
        )
        .groupBy(resources.resourceId);

    let tcpTargets: string[] = [];
    let udpTargets: string[] = [];

    for (const resource of allResources) {
        const targets = JSON.parse(resource.targets);
        if (!targets || targets.length === 0) {
            continue;
        }
        if (resource.protocol === "tcp") {
            tcpTargets = tcpTargets.concat(
                targets.map(
                    (target: Target) =>
                        `${
                            target.internalPort ? target.internalPort + ":" : ""
                        }${target.ip}:${target.port}`
                )
            );
        } else {
            udpTargets = tcpTargets.concat(
                targets.map(
                    (target: Target) =>
                        `${
                            target.internalPort ? target.internalPort + ":" : ""
                        }${target.ip}:${target.port}`
                )
            );
        }
    }

    return {
        message: {
            type: "newt/wg/connect",
            data: {
                endpoint: `${exitNode.endpoint}:${exitNode.listenPort}`,
                publicKey: exitNode.publicKey,
                serverIP: exitNode.address.split("/")[0],
                tunnelIP: site.subnet.split("/")[0],
                targets: {
                    udp: udpTargets,
                    tcp: tcpTargets
                }
            }
        },
        broadcast: false, // Send to all clients
        excludeSender: false // Include sender in broadcast
    };
};
