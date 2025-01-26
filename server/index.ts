import { runSetupFunctions } from "./setup";
import { createApiServer } from "./apiServer";
import { createNextServer } from "./nextServer";
import { createInternalServer } from "./internalServer";
import { Session, User, UserOrg } from "./db/schema";

async function startServers() {
    await runSetupFunctions();

    // Start all servers
    const apiServer = createApiServer();
    const internalServer = createInternalServer();
    const nextServer = await createNextServer();

    return {
        apiServer,
        nextServer,
        internalServer,
    };
}

// Types
declare global {
    namespace Express {
        interface Request {
            user?: User;
            session?: Session;
            userOrg?: UserOrg;
            userOrgRoleId?: number;
            userOrgId?: string;
            userOrgIds?: string[];
        }
    }
}

startServers().catch(console.error);
