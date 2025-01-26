import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import ResourcesTable, { ResourceRow } from "./ResourcesTable";
import { AxiosResponse } from "axios";
import { ListResourcesResponse } from "@server/routers/resource";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { redirect } from "next/navigation";
import { cache } from "react";
import { GetOrgResponse } from "@server/routers/org";
import OrgProvider from "@app/providers/OrgProvider";
import ResourcesSplashCard from "./ResourcesSplashCard";

type ResourcesPageProps = {
    params: Promise<{ orgId: string }>;
};

export const dynamic = "force-dynamic";

export default async function ResourcesPage(props: ResourcesPageProps) {
    const params = await props.params;
    let resources: ListResourcesResponse["resources"] = [];
    try {
        const res = await internal.get<AxiosResponse<ListResourcesResponse>>(
            `/org/${params.orgId}/resources`,
            await authCookieHeader()
        );
        resources = res.data.data.resources;
    } catch (e) {}

    let org = null;
    try {
        const getOrg = cache(async () =>
            internal.get<AxiosResponse<GetOrgResponse>>(
                `/org/${params.orgId}`,
                await authCookieHeader()
            )
        );
        const res = await getOrg();
        org = res.data.data;
    } catch {
        redirect(`/${params.orgId}/settings/resources`);
    }

    if (!org) {
        redirect(`/${params.orgId}/settings/resources`);
    }

    const resourceRows: ResourceRow[] = resources.map((resource) => {
        return {
            id: resource.resourceId,
            name: resource.name,
            orgId: params.orgId,
            domain: `${resource.ssl ? "https://" : "http://"}${resource.fullDomain}`,
            site: resource.siteName || "None",
            siteId: resource.siteId || "Unknown",
            protocol: resource.protocol,
            proxyPort: resource.proxyPort,
            http: resource.http,
            hasAuth:
                resource.sso ||
                resource.pincodeId !== null ||
                resource.pincodeId !== null ||
                resource.whitelist
        };
    });

    return (
        <>
            <ResourcesSplashCard />

            <SettingsSectionTitle
                title="Manage Resources"
                description="Create secure proxies to your private applications"
            />

            <OrgProvider org={org}>
                <ResourcesTable resources={resourceRows} orgId={params.orgId} />
            </OrgProvider>
        </>
    );
}
