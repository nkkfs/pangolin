import db from "@server/db";
import {
    emailVerificationCodes,
    passwordResetTokens,
    resourceOtp,
    resourceWhitelist,
    userInvites,
    users
} from "@server/db/schema";
import { APP_PATH, configFilePath1, configFilePath2 } from "@server/lib/consts";
import { sql } from "drizzle-orm";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

export default async function migration() {
    console.log("Running setup script 1.0.0-beta.9...");

    try {
        await db.transaction(async (trx) => {
            trx.run(sql`UPDATE ${users} SET email = LOWER(email);`);
            trx.run(
                sql`UPDATE ${emailVerificationCodes} SET email = LOWER(email);`
            );
            trx.run(
                sql`UPDATE ${passwordResetTokens} SET email = LOWER(email);`
            );
            trx.run(sql`UPDATE ${userInvites} SET email = LOWER(email);`);
            trx.run(sql`UPDATE ${resourceWhitelist} SET email = LOWER(email);`);
            trx.run(sql`UPDATE ${resourceOtp} SET email = LOWER(email);`);
        });
    } catch (error) {
        console.log(
            "We were unable to make all emails lower case in the database. You can safely ignore this error."
        );
        console.error(error);
    }

    try {
        await db.transaction(async (trx) => {
            trx.run(sql`PRAGMA foreign_keys=OFF;`);
            trx.run(sql`CREATE TABLE __new_resources (
                resourceId integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                siteId integer NOT NULL,
                orgId text NOT NULL,
                name text NOT NULL,
                subdomain text,
                fullDomain text,
                ssl integer DEFAULT false NOT NULL,
                blockAccess integer DEFAULT false NOT NULL,
                sso integer DEFAULT true NOT NULL,
                http integer DEFAULT true NOT NULL,
                protocol text NOT NULL,
                proxyPort integer,
                emailWhitelistEnabled integer DEFAULT false NOT NULL,
                FOREIGN KEY (siteId) REFERENCES sites(siteId) ON UPDATE no action ON DELETE cascade,
                FOREIGN KEY (orgId) REFERENCES orgs(orgId) ON UPDATE no action ON DELETE cascade
            );`);
            trx.run(
                sql`INSERT INTO __new_resources("resourceId", "siteId", "orgId", "name", "subdomain", "fullDomain", "ssl", "blockAccess", "sso", "http", "protocol", "proxyPort", "emailWhitelistEnabled") SELECT "resourceId", "siteId", "orgId", "name", "subdomain", "fullDomain", "ssl", "blockAccess", "sso", "http", "protocol", "proxyPort", "emailWhitelistEnabled" FROM resources;`
            );
            trx.run(sql`DROP TABLE resources;`);
            trx.run(sql`ALTER TABLE __new_resources RENAME TO resources;`);
            trx.run(sql`PRAGMA foreign_keys=ON;`);
            trx.run(sql`CREATE TABLE __new_targets (
                targetId integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                resourceId integer NOT NULL,
                ip text NOT NULL,
                method text,
                port integer NOT NULL,
                internalPort integer,
                enabled integer DEFAULT true NOT NULL,
                FOREIGN KEY (resourceId) REFERENCES resources(resourceId) ON UPDATE no action ON DELETE cascade
            );`);
            trx.run(
                sql`INSERT INTO __new_targets("targetId", "resourceId", "ip", "method", "port", "internalPort", "enabled") SELECT "targetId", "resourceId", "ip", "method", "port", "internalPort", "enabled" FROM targets;`
            );
            trx.run(sql`DROP TABLE targets;`);
            trx.run(sql`ALTER TABLE __new_targets RENAME TO targets;`);
        });
    } catch (error) {
        console.log(
            "We were unable to make the changes to the targets and resources tables."
        );
        throw error;
    }

    try {
        // Determine which config file exists
        const filePaths = [configFilePath1, configFilePath2];
        let filePath = "";
        for (const path of filePaths) {
            if (fs.existsSync(path)) {
                filePath = path;
                break;
            }
        }

        if (!filePath) {
            throw new Error(
                `No config file found (expected config.yml or config.yaml).`
            );
        }

        // Read and parse the YAML file
        let rawConfig: any;
        const fileContents = fs.readFileSync(filePath, "utf8");
        rawConfig = yaml.load(fileContents);

        rawConfig.server.resource_session_request_param = "p_session_request";
        rawConfig.server.session_cookie_name = "p_session_token"; // rename to prevent conflicts
        delete rawConfig.server.resource_session_cookie_name;

        // Write the updated YAML back to the file
        const updatedYaml = yaml.dump(rawConfig);
        fs.writeFileSync(filePath, updatedYaml, "utf8");
    } catch (e) {
        console.log(
            `Failed to add resource_session_request_param to config. Please add it manually. https://docs.fossorial.io/Pangolin/Configuration/config`
        );
        throw e;
    }

    try {
        const traefikPath = path.join(
            APP_PATH,
            "traefik",
            "traefik_config.yml"
        );

        // Define schema for traefik config validation
        const schema = z.object({
            entryPoints: z
                .object({
                    websecure: z
                        .object({
                            address: z.string(),
                            transport: z
                                .object({
                                    respondingTimeouts: z.object({
                                        readTimeout: z.string()
                                    })
                                })
                                .optional()
                        })
                        .optional()
                })
                .optional(),
            experimental: z.object({
                plugins: z.object({
                    badger: z.object({
                        moduleName: z.string(),
                        version: z.string()
                    })
                })
            })
        });

        const traefikFileContents = fs.readFileSync(traefikPath, "utf8");
        const traefikConfig = yaml.load(traefikFileContents) as any;

        const parsedConfig = schema.safeParse(traefikConfig);

        if (!parsedConfig.success) {
            throw new Error(fromZodError(parsedConfig.error).toString());
        }

        // Ensure websecure entrypoint exists
        if (traefikConfig.entryPoints?.websecure) {
            // Add transport configuration
            traefikConfig.entryPoints.websecure.transport = {
                respondingTimeouts: {
                    readTimeout: "30m"
                }
            };
        }

        traefikConfig.experimental.plugins.badger.version = "v1.0.0-beta.3";

        const updatedTraefikYaml = yaml.dump(traefikConfig);
        fs.writeFileSync(traefikPath, updatedTraefikYaml, "utf8");

        console.log(
            "Updated the version of Badger in your Traefik configuration to v1.0.0-beta.3 and added readTimeout to websecure entrypoint in your Traefik configuration.."
        );
    } catch (e) {
        console.log(
            "We were unable to update the version of Badger in your Traefik configuration. Please update it manually to at least v1.0.0-beta.3. https://github.com/fosrl/badger"
        );
        throw e;
    }

    try {
        await db.transaction(async (trx) => {
            trx.run(
                sql`ALTER TABLE 'resourceSessions' ADD 'isRequestToken' integer;`
            );
            trx.run(
                sql`ALTER TABLE 'resourceSessions' ADD 'userSessionId' text REFERENCES session(id);`
            );
        });
    } catch (e) {
        console.log(
            "We were unable to add columns to the resourceSessions table."
        );
        throw e;
    }

    console.log("Done.");
}
