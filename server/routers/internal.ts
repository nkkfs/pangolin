import { Router } from "express";
import * as gerbil from "@server/routers/gerbil";
import * as badger from "@server/routers/badger";
import * as traefik from "@server/routers/traefik";
import * as auth from "@server/routers/auth";
import * as resource from "@server/routers/resource";
import HttpCode from "@server/types/HttpCode";
import { verifyResourceAccess, verifySessionUserMiddleware } from "@server/middlewares";

// Root routes
const internalRouter = Router();

internalRouter.get("/", (_, res) => {
    res.status(HttpCode.OK).json({ message: "Healthy" });
});

internalRouter.get("/traefik-config", traefik.traefikConfigProvider);
internalRouter.get(
    "/resource-session/:resourceId/:token",
    auth.checkResourceSession
);

internalRouter.post(
    `/resource/:resourceId/get-exchange-token`,
    verifySessionUserMiddleware,
    verifyResourceAccess,
    resource.getExchangeToken
);

// Gerbil routes
const gerbilRouter = Router();
internalRouter.use("/gerbil", gerbilRouter);

gerbilRouter.post("/get-config", gerbil.getConfig);
gerbilRouter.post("/receive-bandwidth", gerbil.receiveBandwidth);

// Badger routes
const badgerRouter = Router();
internalRouter.use("/badger", badgerRouter);

badgerRouter.post("/verify-session", badger.verifyResourceSession);
badgerRouter.post("/exchange-session", badger.exchangeSession);

export default internalRouter;
