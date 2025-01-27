import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { roles, userOrgs } from "@server/db/schema";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";

export async function verifyAdmin(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const userId = req.user?.userId;
    const orgId = req.userOrgId;

    if (!orgId) {
        return next(
            createHttpError(HttpCode.UNAUTHORIZED, "User does not have orgId")
        );
    }

    if (!userId) {
        return next(
            createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
        );
    }

    if (!req.userOrg) {
        const userOrgRes = await db
            .select()
            .from(userOrgs)
            .where(and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, orgId!)))
            .limit(1);
        req.userOrg = userOrgRes[0];
    }

    if (!req.userOrg) {
        return next(
            createHttpError(
                HttpCode.FORBIDDEN,
                "User does not have access to this organization"
            )
        );
    }

    const userRole = await db
        .select()
        .from(roles)
        .where(eq(roles.roleId, req.userOrg.roleId))
        .limit(1);

    if (userRole.length === 0 || !userRole[0].isAdmin) {
        return next(
            createHttpError(
                HttpCode.FORBIDDEN,
                "User does not have Admin access"
            )
        );
    }

    return next();
}
