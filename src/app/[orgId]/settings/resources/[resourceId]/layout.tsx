import ResourceProvider from "@app/providers/ResourceProvider";
import { internal } from "@app/lib/api";
import {
    GetResourceAuthInfoResponse,
    GetResourceResponse
} from "@server/routers/resource";
import { AxiosResponse } from "axios";
import { redirect } from "next/navigation";
import { authCookieHeader } from "@app/lib/api/cookies";
import { SidebarSettings } from "@app/components/SidebarSettings";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { GetOrgResponse } from "@server/routers/org";
import OrgProvider from "@app/providers/OrgProvider";
import { cache } from "react";
import ResourceInfoBox from "./ResourceInfoBox";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator
} from "@app/components/ui/breadcrumb";
import Link from "next/link";

interface ResourceLayoutProps {
    children: React.ReactNode;
    params: Promise<{ resourceId: number | string; orgId: string }>;
}

export default async function ResourceLayout(props: ResourceLayoutProps) {
    const params = await props.params;

    const { children } = props;

    let authInfo = null;
    let resource = null;
    try {
        const res = await internal.get<AxiosResponse<GetResourceResponse>>(
            `/resource/${params.resourceId}`,
            await authCookieHeader()
        );
        resource = res.data.data;
    } catch {
        redirect(`/${params.orgId}/settings/resources`);
    }

    if (!resource) {
        redirect(`/${params.orgId}/settings/resources`);
    }

    try {
        const res = await internal.get<
            AxiosResponse<GetResourceAuthInfoResponse>
        >(`/resource/${resource.resourceId}/auth`, await authCookieHeader());
        authInfo = res.data.data;
    } catch {
        redirect(`/${params.orgId}/settings/resources`);
    }

    if (!authInfo) {
        redirect(`/${params.orgId}/settings/resources`);
    }

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

    const sidebarNavItems = [
        {
            title: "General",
            href: `/{orgId}/settings/resources/{resourceId}/general`
            // icon: <Settings className="w-4 h-4" />,
        },
        {
            title: "Connectivity",
            href: `/{orgId}/settings/resources/{resourceId}/connectivity`
            // icon: <Cloud className="w-4 h-4" />,
        }
    ];

    if (resource.http) {
        sidebarNavItems.push({
            title: "Authentication",
            href: `/{orgId}/settings/resources/{resourceId}/authentication`
            // icon: <Shield className="w-4 h-4" />,
        });
    }

    return (
        <>
            <div className="mb-4">
                <Breadcrumb>
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <Link href="../">Resources</Link>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbPage>{resource.name}</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
            </div>

            <SettingsSectionTitle
                title={`${resource?.name} Settings`}
                description="Configure the settings on your resource"
            />

            <OrgProvider org={org}>
                <ResourceProvider resource={resource} authInfo={authInfo}>
                    <SidebarSettings sidebarNavItems={sidebarNavItems}>
                        <div className="mb-8">
                            <ResourceInfoBox />
                        </div>
                        {children}
                    </SidebarSettings>
                </ResourceProvider>
            </OrgProvider>
        </>
    );
}
