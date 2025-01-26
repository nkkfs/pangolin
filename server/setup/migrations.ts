import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import db, { exists } from "@server/db";
import path from "path";
import semver from "semver";
import { versionMigrations } from "@server/db/schema";
import { desc } from "drizzle-orm";
import { __DIRNAME, APP_PATH } from "@server/lib/consts";
import { loadAppVersion } from "@server/lib/loadAppVersion";
import m1 from "./scripts/1.0.0-beta1";
import m2 from "./scripts/1.0.0-beta2";
import m3 from "./scripts/1.0.0-beta3";
import m4 from "./scripts/1.0.0-beta5";
import m5 from "./scripts/1.0.0-beta6";
import m6 from "./scripts/1.0.0-beta9";

// THIS CANNOT IMPORT ANYTHING FROM THE SERVER
// EXCEPT FOR THE DATABASE AND THE SCHEMA

// Define the migration list with versions and their corresponding functions
const migrations = [
    { version: "1.0.0-beta.1", run: m1 },
    { version: "1.0.0-beta.2", run: m2 },
    { version: "1.0.0-beta.3", run: m3 },
    { version: "1.0.0-beta.5", run: m4 },
    { version: "1.0.0-beta.6", run: m5 },
    { version: "1.0.0-beta.9", run: m6 }
    // Add new migrations here as they are created
] as const;

// Run the migrations
await runMigrations();

export async function runMigrations() {
    const appVersion = loadAppVersion();
    if (!appVersion) {
        throw new Error("APP_VERSION is not set in the environment");
    }

    if (exists) {
        await executeScripts();
    } else {
        console.log("Running migrations...");
        try {
            migrate(db, {
                migrationsFolder: path.join(__DIRNAME, "init") // put here during the docker build
            });
            console.log("Migrations completed successfully.");
        } catch (error) {
            console.error("Error running migrations:", error);
        }

        await db
            .insert(versionMigrations)
            .values({
                version: appVersion,
                executedAt: Date.now()
            })
            .execute();
    }
}

async function executeScripts() {
    try {
        // Get the last executed version from the database
        const lastExecuted = await db
            .select()
            .from(versionMigrations)
            .orderBy(desc(versionMigrations.version))
            .limit(1);

        const startVersion = lastExecuted[0]?.version ?? "0.0.0";
        console.log(`Starting migrations from version ${startVersion}`);

        // Filter and sort migrations
        const pendingMigrations = migrations
            .filter((migration) => semver.gt(migration.version, startVersion))
            .sort((a, b) => semver.compare(a.version, b.version));

        // Run migrations in order
        for (const migration of pendingMigrations) {
            console.log(`Running migration ${migration.version}`);

            try {
                await migration.run();

                // Update version in database
                await db
                    .insert(versionMigrations)
                    .values({
                        version: migration.version,
                        executedAt: Date.now()
                    })
                    .execute();

                console.log(
                    `Successfully completed migration ${migration.version}`
                );
            } catch (error) {
                console.error(
                    `Failed to run migration ${migration.version}:`,
                    error
                );
                throw error; // Re-throw to stop migration process
            }
        }

        console.log("All migrations completed successfully");
    } catch (error) {
        console.error("Migration process failed:", error);
        throw error;
    }
}
