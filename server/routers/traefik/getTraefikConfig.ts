import { Request, Response } from "express";
import db from "@server/db";
import * as schema from "@server/db/schema";
import { and, eq } from "drizzle-orm";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import config from "@server/lib/config";
import { Target } from "@server/db/schema";
import { sql } from "drizzle-orm";

export async function traefikConfigProvider(
    _: Request,
    res: Response
): Promise<any> {
    try {
        const allResources = await db
            .select({
                // Resource fields
                resourceId: schema.resources.resourceId,
                subdomain: schema.resources.subdomain,
                fullDomain: schema.resources.fullDomain,
                ssl: schema.resources.ssl,
                blockAccess: schema.resources.blockAccess,
                sso: schema.resources.sso,
                emailWhitelistEnabled: schema.resources.emailWhitelistEnabled,
                http: schema.resources.http,
                proxyPort: schema.resources.proxyPort,
                protocol: schema.resources.protocol,
                // Site fields
                site: {
                    siteId: schema.sites.siteId,
                    type: schema.sites.type,
                    subnet: schema.sites.subnet
                },
                // Org fields
                org: {
                    orgId: schema.orgs.orgId,
                    domain: schema.orgs.domain
                },
                // Targets as a subquery
                targets: sql<string>`json_group_array(json_object(
              'targetId', ${schema.targets.targetId},
              'ip', ${schema.targets.ip},
              'method', ${schema.targets.method},
              'port', ${schema.targets.port},
              'internalPort', ${schema.targets.internalPort},
              'enabled', ${schema.targets.enabled}
            ))`.as("targets")
            })
            .from(schema.resources)
            .innerJoin(
                schema.sites,
                eq(schema.sites.siteId, schema.resources.siteId)
            )
            .innerJoin(
                schema.orgs,
                eq(schema.resources.orgId, schema.orgs.orgId)
            )
            .leftJoin(
                schema.targets,
                and(
                    eq(schema.targets.resourceId, schema.resources.resourceId),
                    eq(schema.targets.enabled, true)
                )
            )
            .groupBy(schema.resources.resourceId);

        if (!allResources.length) {
            return res.status(HttpCode.OK).json({});
        }

        const badgerMiddlewareName = "badger";
        const redirectHttpsMiddlewareName = "redirect-to-https";

        const config_output: any = {
            http: {
                routers: {},
                services: {},
                middlewares: {
                    [badgerMiddlewareName]: {
                        plugin: {
                            [badgerMiddlewareName]: {
                                apiBaseUrl: new URL(
                                    "/api/v1",
                                    `http://${config.getRawConfig().server.internal_hostname}:${config.getRawConfig().server.internal_port}`
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
                            scheme: "https",
                        }
                    }
                }
            },
            tcp: {
                routers: {},
                services: {}
            },
            udp: {
                routers: {},
                services: {}
            }
        };

        for (const resource of allResources) {
            const targets = JSON.parse(resource.targets);

            const site = resource.site;
            const org = resource.org;

            if (!resource.subdomain) {
                continue;
            }

            if (!org.domain) {
                continue;
            }

            const routerName = `${resource.resourceId}-router`;
            const serviceName = `${resource.resourceId}-service`;

            const fullDomain = `${resource.subdomain}.${org.domain}`;

            if (resource.http) {
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
                    // this is a redirect router; all it does is redirect to the https version if tls is enabled
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
                        servers: targets.map((target: Target) => {
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
                config_output[resource.protocol].routers[routerName] = {
                    entryPoints: [`${resource.protocol}-${resource.proxyPort}`],
                    service: serviceName,
                    rule: "HostSNI(`*`)"
                };
                config_output[resource.protocol].services[serviceName] = {
                    loadBalancer: {
                        servers: targets.map((target: Target) => {
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

        // Only include non-empty configuration sections
        const finalConfig: any = {};
        for (const section of ["http", "tcp", "udp"]) {
            if (
                Object.keys(config_output[section].routers).length > 0 ||
                Object.keys(config_output[section].services).length > 0 ||
                (section === "http" &&
                    Object.keys(config_output[section].middlewares).length > 0)
            ) {
                finalConfig[section] = config_output[section];
            }
        }

        return res.status(HttpCode.OK).json(finalConfig);
    } catch (e) {
        logger.error(`Failed to build traefik config: ${e}`);
        return res.status(HttpCode.INTERNAL_SERVER_ERROR).json({
            error: "Failed to build traefik config"
        });
    }
}
