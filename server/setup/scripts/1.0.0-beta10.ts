import db from "@server/db";
import {
    resources,
} from "@server/db/schema";
import { sql } from "drizzle-orm";

export default async function migration() {
    console.log("Running setup script 1.0.0-beta.10...");

    try {
        await db.transaction(async (trx) => {
            trx.run(sql`ALTER TABLE ${resources} ADD proxyPort integer;`);
            trx.run(sql`ALTER TABLE ${resources} ADD http integer;`);
            // set all existing resources to be http 1
            trx.run(sql`UPDATE ${resources} SET http = 1;`);
        });

    } catch (error) {
        console.log("Could not create new columns in the database.");
        console.error(error);
    }
    
    console.log("Done.");
}