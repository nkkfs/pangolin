import db from "@server/db";
import { resources } from "@server/db/schema";
import { sql } from "drizzle-orm";
import fs from "fs";
import yaml from "js-yaml";
import { APP_PATH, configFilePath1, configFilePath2 } from "@server/lib/consts";
import path from "path";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

export default async function migration() {
    console.log("Running setup script 1.0.0-beta.10...");

    try {
        await db.transaction(async (trx) => {
            // TODO: NEED TO GENERATE SQL FOR THIS
            // TODO: NEED TO SET HTTP and PROTOCOL ON ALL RESOURCES
        });
    } catch (error) {
        console.log("Could not create new columns in the database.");
        console.error(error);
    }

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

    // Validate the structure
    if (!rawConfig.server) {
        throw new Error(`Invalid config file: server is missing.`);
    }

    // Update the config
    rawConfig.server.resource_access_token_param = "p_token";

    // Write the updated YAML back to the file
    const updatedYaml = yaml.dump(rawConfig);
    fs.writeFileSync(filePath, updatedYaml, "utf8");

    // then try to update badger in traefik config

    try {
        const traefikPath = path.join(
            APP_PATH,
            "traefik",
            "traefik_config.yml"
        );

        // read the traefik file
        // look for the websecure:
        // add
        // transport:
        //     respondingTimeouts:
        //         readTimeout: 30m

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
                .optional()
        });

        const traefikFileContents = fs.readFileSync(traefikPath, "utf8");
        const traefikConfig = yaml.load(traefikFileContents) as any;

        // Validate existing config
        const parsedConfig = schema.safeParse(traefikConfig);
        if (!parsedConfig.success) {
            throw new Error(fromZodError(parsedConfig.error).toString());
        }

        // Ensure websecure entrypoint exists
        if (!traefikConfig.entryPoints) {
            traefikConfig.entryPoints = {};
        }
        if (!traefikConfig.entryPoints.websecure) {
            traefikConfig.entryPoints.websecure = {
                address: ":443"
            };
        }

        // Add transport configuration
        traefikConfig.entryPoints.websecure.transport = {
            respondingTimeouts: {
                readTimeout: "30m"
            }
        };

        const updatedTraefikYaml = yaml.dump(traefikConfig);
        fs.writeFileSync(traefikPath, updatedTraefikYaml, "utf8");
        console.log(
            "Added readTimeout to websecure entrypoint in your Traefik configuration."
        );
    } catch (e) {
        console.log(
            "We were unable to update the readTimeout in Traefik config. Please update it manually."
        );
        console.error(e);
    }
    console.log("Done.");
}
