import { Target } from "@server/db/schema";
import { sendToClient } from "../ws";

export async function addTargets(
    newtId: string,
    targets: Target[],
    protocol: string
): Promise<void> {
    //create a list of udp and tcp targets
    const payloadTargets = targets.map((target) => {
        return `${target.internalPort ? target.internalPort + ":" : ""}${
            target.ip
        }:${target.port}`;
    });

    const payload = {
        type: `newt/${protocol}/add`,
        data: {
            targets: payloadTargets
        }
    };
    sendToClient(newtId, payload);
}

export async function removeTargets(
    newtId: string,
    targets: Target[],
    protocol: string
): Promise<void> {
    //create a list of udp and tcp targets
    const payloadTargets = targets.map((target) => {
        return `${target.internalPort ? target.internalPort + ":" : ""}${
            target.ip
        }:${target.port}`;
    });

    const payload = {
        type: `newt/${protocol}/remove`,
        data: {
            targets: payloadTargets
        }
    };
    sendToClient(newtId, payload);
}
