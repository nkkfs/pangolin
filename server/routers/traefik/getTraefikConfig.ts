import { Request, Response } from "express";
import db from "@server/db";
import { and, eq } from "drizzle-orm";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import config from "@server/lib/config";
import { orgs, resources, sites, Target, targets } from "@server/db/schema";
import { sql } from "drizzle-orm";

export async function traefikConfigProvider(
    _: Request,
    res: Response
): Promise<any> {
    try {
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
                // Site fields
                site: {
                    siteId: sites.siteId,
                    type: sites.type,
                    subnet: sites.subnet
                },
                // Org fields
                org: {
                    orgId: orgs.orgId,
                    domain: orgs.domain
                },
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
            .innerJoin(sites, eq(sites.siteId, resources.siteId))
            .innerJoin(orgs, eq(resources.orgId, orgs.orgId))
            .leftJoin(
                targets,
                and(
                    eq(targets.resourceId, resources.resourceId),
                    eq(targets.enabled, true)
                )
            )
            .groupBy(resources.resourceId);

        if (!allResources.length) {
            return res.status(HttpCode.OK).json({});
        }

        const badgerMiddlewareName = "badger";
        const redirectHttpsMiddlewareName = "redirect-to-https";

        const config_output: any = {
            http: {
                middlewares: {
                    [badgerMiddlewareName]: {
                        plugin: {
                            [badgerMiddlewareName]: {
                                apiBaseUrl: new URL(
                                    "/api/v1",
                                    `http://${config.getRawConfig().server.internal_hostname}:${
                                        config.getRawConfig().server
                                            .internal_port
                                    }`
                                ).href,
                                userSessionCookieName:
                                    config.getRawConfig().server
                                        .session_cookie_name,
                                accessTokenQueryParam:
                                    config.getRawConfig().server
                                        .resource_access_token_param,
                                resourceSessionRequestParam:
                                    config.getRawConfig().server
                                        .resource_session_request_param
                            }
                        }
                    },
                    [redirectHttpsMiddlewareName]: {
                        redirectScheme: {
                            scheme: "https"
                        }
                    }
                }
            }
        };

        for (const resource of allResources) {
            const targets = JSON.parse(resource.targets);
            const site = resource.site;
            const org = resource.org;

            if (!org.domain) {
                continue;
            }

            const routerName = `${resource.resourceId}-router`;
            const serviceName = `${resource.resourceId}-service`;
            const fullDomain = `${resource.subdomain}.${org.domain}`;

            if (resource.http) {
                // HTTP configuration remains the same
                if (!resource.subdomain) {
                    continue;
                }

                if (
                    targets.filter(
                        (target: Target) => target.internalPort != null
                    ).length == 0
                ) {
                    continue;
                }

                // add routers and services empty objects if they don't exist
                if (!config_output.http.routers) {
                    config_output.http.routers = {};
                }

                if (!config_output.http.services) {
                    config_output.http.services = {};
                }

                const domainParts = fullDomain.split(".");
                let wildCard;
                if (domainParts.length <= 2) {
                    wildCard = `*.${domainParts.join(".")}`;
                } else {
                    wildCard = `*.${domainParts.slice(1).join(".")}`;
                }

                const tls = {
                    certResolver: config.getRawConfig().traefik.cert_resolver,
                    ...(config.getRawConfig().traefik.prefer_wildcard_cert
                        ? {
                              domains: [
                                  {
                                      main: wildCard
                                  }
                              ]
                          }
                        : {})
                };

                config_output.http.routers![routerName] = {
                    entryPoints: [
                        resource.ssl
                            ? config.getRawConfig().traefik.https_entrypoint
                            : config.getRawConfig().traefik.http_entrypoint
                    ],
                    middlewares: [badgerMiddlewareName],
                    service: serviceName,
                    rule: `Host(\`${fullDomain}\`)`,
                    ...(resource.ssl ? { tls } : {})
                };

                if (resource.ssl) {
                    config_output.http.routers![routerName + "-redirect"] = {
                        entryPoints: [
                            config.getRawConfig().traefik.http_entrypoint
                        ],
                        middlewares: [redirectHttpsMiddlewareName],
                        service: serviceName,
                        rule: `Host(\`${fullDomain}\`)`
                    };
                }

                config_output.http.services![serviceName] = {
                    loadBalancer: {
                        servers: targets
                            .filter(
                                (target: Target) => target.internalPort != null
                            )
                            .map((target: Target) => {
                                if (
                                    site.type === "local" ||
                                    site.type === "wireguard"
                                ) {
                                    return {
                                        url: `${target.method}://${target.ip}:${target.port}`
                                    };
                                } else if (site.type === "newt") {
                                    const ip = site.subnet.split("/")[0];
                                    return {
                                        url: `${target.method}://${ip}:${target.internalPort}`
                                    };
                                }
                            })
                    }
                };
            } else {
                // Non-HTTP (TCP/UDP) configuration
                const protocol = resource.protocol.toLowerCase();
                const port = resource.proxyPort;

                if (!port) {
                    continue;
                }

                if (
                    targets.filter(
                        (target: Target) => target.internalPort != null
                    ).length == 0
                ) {
                    continue;
                }

                if (!config_output[protocol]) {
                    config_output[protocol] = {
                        routers: {},
                        services: {}
                    };
                }

                config_output[protocol].routers[routerName] = {
                    entryPoints: [`${protocol}-${port}`],
                    service: serviceName,
                    ...(protocol === "tcp" ? { rule: "HostSNI(`*`)" } : {})
                };

                config_output[protocol].services[serviceName] = {
                    loadBalancer: {
                        servers: targets
                            .filter(
                                (target: Target) => target.internalPort != null
                            )
                            .map((target: Target) => {
                                if (
                                    site.type === "local" ||
                                    site.type === "wireguard"
                                ) {
                                    return {
                                        address: `${target.ip}:${target.port}`
                                    };
                                } else if (site.type === "newt") {
                                    const ip = site.subnet.split("/")[0];
                                    return {
                                        address: `${ip}:${target.internalPort}`
                                    };
                                }
                            })
                    }
                };
            }
        }
        return res.status(HttpCode.OK).json(config_output);
    } catch (e) {
        logger.error(`Failed to build traefik config: ${e}`);
        return res.status(HttpCode.INTERNAL_SERVER_ERROR).json({
            error: "Failed to build traefik config"
        });
    }
}
