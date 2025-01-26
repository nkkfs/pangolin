import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import {
    __DIRNAME,
    APP_PATH,
    configFilePath1,
    configFilePath2
} from "@server/lib/consts";
import { loadAppVersion } from "@server/lib/loadAppVersion";
import { passwordSchema } from "@server/auth/passwordSchema";
import stoi from "./stoi";

const portSchema = z.number().positive().gt(0).lte(65535);
const hostnameSchema = z
    .string()
    .regex(
        /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)+([A-Za-z]|[A-Za-z][A-Za-z0-9\-]*[A-Za-z0-9])$/
    )
    .or(z.literal("localhost"));

const getEnvOrYaml = (envVar: string) => (valFromYaml: any) => {
    return process.env[envVar] ?? valFromYaml;
};

const configSchema = z.object({
    app: z.object({
        dashboard_url: z
            .string()
            .url()
            .optional()
            .transform(getEnvOrYaml("APP_DASHBOARDURL"))
            .pipe(z.string().url())
            .transform((url) => url.toLowerCase()),
        base_domain: hostnameSchema
            .optional()
            .transform(getEnvOrYaml("APP_BASEDOMAIN"))
            .pipe(hostnameSchema)
            .transform((url) => url.toLowerCase()),
        log_level: z.enum(["debug", "info", "warn", "error"]),
        save_logs: z.boolean()
    }),
    server: z.object({
        external_port: portSchema
            .optional()
            .transform(getEnvOrYaml("SERVER_EXTERNALPORT"))
            .transform(stoi)
            .pipe(portSchema),
        internal_port: portSchema
            .optional()
            .transform(getEnvOrYaml("SERVER_INTERNALPORT"))
            .transform(stoi)
            .pipe(portSchema),
        next_port: portSchema
            .optional()
            .transform(getEnvOrYaml("SERVER_NEXTPORT"))
            .transform(stoi)
            .pipe(portSchema),
        internal_hostname: z.string().transform((url) => url.toLowerCase()),
        secure_cookies: z.boolean(),
        session_cookie_name: z.string(),
        resource_access_token_param: z.string(),
        resource_session_request_param: z.string(),
        dashboard_session_length_hours: z
            .number()
            .positive()
            .gt(0)
            .optional()
            .default(720),
        resource_session_length_hours: z
            .number()
            .positive()
            .gt(0)
            .optional()
            .default(720),
        cors: z
            .object({
                origins: z.array(z.string()).optional(),
                methods: z.array(z.string()).optional(),
                allowed_headers: z.array(z.string()).optional(),
                credentials: z.boolean().optional()
            })
            .optional(),
        trust_proxy: z.boolean().optional().default(true)
    }),
    traefik: z.object({
        http_entrypoint: z.string(),
        https_entrypoint: z.string().optional(),
        cert_resolver: z.string().optional(),
        prefer_wildcard_cert: z.boolean().optional()
    }),
    gerbil: z.object({
        start_port: portSchema
            .optional()
            .transform(getEnvOrYaml("GERBIL_STARTPORT"))
            .transform(stoi)
            .pipe(portSchema),
        base_endpoint: z
            .string()
            .optional()
            .transform(getEnvOrYaml("GERBIL_BASEENDPOINT"))
            .pipe(z.string())
            .transform((url) => url.toLowerCase()),
        use_subdomain: z.boolean(),
        subnet_group: z.string(),
        block_size: z.number().positive().gt(0),
        site_block_size: z.number().positive().gt(0)
    }),
    rate_limits: z.object({
        global: z.object({
            window_minutes: z.number().positive().gt(0),
            max_requests: z.number().positive().gt(0)
        }),
        auth: z
            .object({
                window_minutes: z.number().positive().gt(0),
                max_requests: z.number().positive().gt(0)
            })
            .optional()
    }),
    email: z
        .object({
            smtp_host: z.string(),
            smtp_port: portSchema,
            smtp_user: z.string(),
            smtp_pass: z.string(),
            no_reply: z.string().email()
        })
        .optional(),
    users: z.object({
        server_admin: z.object({
            email: z
                .string()
                .email()
                .optional()
                .transform(getEnvOrYaml("USERS_SERVERADMIN_EMAIL"))
                .pipe(z.string().email())
                .transform((v) => v.toLowerCase()),
            password: passwordSchema
                .optional()
                .transform(getEnvOrYaml("USERS_SERVERADMIN_PASSWORD"))
                .pipe(passwordSchema)
        })
    }),
    flags: z
        .object({
            require_email_verification: z.boolean().optional(),
            disable_signup_without_invite: z.boolean().optional(),
            disable_user_create_org: z.boolean().optional()
        })
        .optional()
});

export class Config {
    private rawConfig!: z.infer<typeof configSchema>;

    constructor() {
        this.loadConfig();

        if (process.env.GENERATE_TRAEFIK_CONFIG === "true") {
            this.createTraefikConfig();
        }
    }

    public loadEnvironment() {}

    public loadConfig() {
        const loadConfig = (configPath: string) => {
            try {
                const yamlContent = fs.readFileSync(configPath, "utf8");
                const config = yaml.load(yamlContent);
                return config;
            } catch (error) {
                if (error instanceof Error) {
                    throw new Error(
                        `Error loading configuration file: ${error.message}`
                    );
                }
                throw error;
            }
        };

        let environment: any;
        if (fs.existsSync(configFilePath1)) {
            environment = loadConfig(configFilePath1);
        } else if (fs.existsSync(configFilePath2)) {
            environment = loadConfig(configFilePath2);
        }
        if (!environment) {
            const exampleConfigPath = path.join(
                __DIRNAME,
                "config.example.yml"
            );
            if (fs.existsSync(exampleConfigPath)) {
                try {
                    const exampleConfigContent = fs.readFileSync(
                        exampleConfigPath,
                        "utf8"
                    );
                    fs.writeFileSync(
                        configFilePath1,
                        exampleConfigContent,
                        "utf8"
                    );
                    environment = loadConfig(configFilePath1);
                } catch (error) {
                    console.log(
                        "See the docs for information about what to include in the configuration file: https://docs.fossorial.io/Pangolin/Configuration/config"
                    );
                    if (error instanceof Error) {
                        throw new Error(
                            `Error creating configuration file from example: ${
                                error.message
                            }`
                        );
                    }
                    throw error;
                }
            } else {
                throw new Error(
                    "No configuration file found and no example configuration available"
                );
            }
        }

        if (!environment) {
            throw new Error("No configuration file found");
        }

        const parsedConfig = configSchema.safeParse(environment);

        if (!parsedConfig.success) {
            const errors = fromError(parsedConfig.error);
            throw new Error(`Invalid configuration file: ${errors}`);
        }

        const appVersion = loadAppVersion();
        if (!appVersion) {
            throw new Error("Could not load the application version");
        }
        process.env.APP_VERSION = appVersion;

        process.env.NEXT_PORT = parsedConfig.data.server.next_port.toString();
        process.env.SERVER_EXTERNAL_PORT =
            parsedConfig.data.server.external_port.toString();
        process.env.SERVER_INTERNAL_PORT =
            parsedConfig.data.server.internal_port.toString();
        process.env.FLAGS_EMAIL_VERIFICATION_REQUIRED = parsedConfig.data.flags
            ?.require_email_verification
            ? "true"
            : "false";
        process.env.SESSION_COOKIE_NAME =
            parsedConfig.data.server.session_cookie_name;
        process.env.EMAIL_ENABLED = parsedConfig.data.email ? "true" : "false";
        process.env.DISABLE_SIGNUP_WITHOUT_INVITE = parsedConfig.data.flags
            ?.disable_signup_without_invite
            ? "true"
            : "false";
        process.env.DISABLE_USER_CREATE_ORG = parsedConfig.data.flags
            ?.disable_user_create_org
            ? "true"
            : "false";
        process.env.RESOURCE_ACCESS_TOKEN_PARAM =
            parsedConfig.data.server.resource_access_token_param;
        process.env.RESOURCE_SESSION_REQUEST_PARAM =
            parsedConfig.data.server.resource_session_request_param;

        this.rawConfig = parsedConfig.data;
    }

    public getRawConfig() {
        return this.rawConfig;
    }

    public getBaseDomain(): string {
        return this.rawConfig.app.base_domain;
    }

    private createTraefikConfig() {
        try {
            // check if traefik_config.yml and dynamic_config.yml exists in APP_PATH/traefik
            const defaultTraefikConfigPath = path.join(
                __DIRNAME,
                "traefik_config.example.yml"
            );
            const defaultDynamicConfigPath = path.join(
                __DIRNAME,
                "dynamic_config.example.yml"
            );

            const traefikPath = path.join(APP_PATH, "traefik");
            if (!fs.existsSync(traefikPath)) {
                return;
            }

            // load default configs
            let traefikConfig = fs.readFileSync(
                defaultTraefikConfigPath,
                "utf8"
            );
            let dynamicConfig = fs.readFileSync(
                defaultDynamicConfigPath,
                "utf8"
            );

            traefikConfig = traefikConfig
                .split("{{.LetsEncryptEmail}}")
                .join(this.rawConfig.users.server_admin.email);
            traefikConfig = traefikConfig
                .split("{{.INTERNAL_PORT}}")
                .join(this.rawConfig.server.internal_port.toString());

            dynamicConfig = dynamicConfig
                .split("{{.DashboardDomain}}")
                .join(new URL(this.rawConfig.app.dashboard_url).hostname);
            dynamicConfig = dynamicConfig
                .split("{{.NEXT_PORT}}")
                .join(this.rawConfig.server.next_port.toString());
            dynamicConfig = dynamicConfig
                .split("{{.EXTERNAL_PORT}}")
                .join(this.rawConfig.server.external_port.toString());

            // write thiese to the traefik directory
            const traefikConfigPath = path.join(
                traefikPath,
                "traefik_config.yml"
            );
            const dynamicConfigPath = path.join(
                traefikPath,
                "dynamic_config.yml"
            );

            fs.writeFileSync(traefikConfigPath, traefikConfig, "utf8");
            fs.writeFileSync(dynamicConfigPath, dynamicConfig, "utf8");

            console.log("Traefik configuration files created");
        } catch (e) {
            console.log(
                "Failed to generate the Traefik configuration files. Please create them manually."
            );
            console.error(e);
        }
    }
}

export const config = new Config();

export default config;
