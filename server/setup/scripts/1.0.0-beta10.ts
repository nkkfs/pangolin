import db from "@server/db";
import {
    targets,
} from "@server/db/schema";
import { sql } from "drizzle-orm";

export default async function migration() {
    console.log("Running setup script 1.0.0-beta.10...");

    try {
        await db.transaction(async (trx) => {
            trx.run(sql`ALTER TABLE ${targets} ADD proxyPort integer;`);
        });
    } catch (error) {
        console.log("Could not create new columns in the database.");
        console.error(error);
    }
    
    console.log("Done.");
}