"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { formatAxiosError } from "@app/lib/api";
import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useResourceContext } from "@app/hooks/useResourceContext";
import { ListSitesResponse } from "@server/routers/site";
import { useEffect, useState } from "react";
import { AxiosResponse } from "axios";
import { useParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { GetResourceAuthInfoResponse } from "@server/routers/resource";
import { useToast } from "@app/hooks/useToast";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSectionDescription,
    SettingsSectionBody,
    SettingsSectionForm,
    SettingsSectionFooter
} from "@app/components/Settings";
import { useOrgContext } from "@app/hooks/useOrgContext";
import CustomDomainInput from "../CustomDomainInput";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";

const GeneralFormSchema = z.object({
    subdomain: z
        .union([
            z
                .string()
                .regex(
                    /^(?!:\/\/)([a-zA-Z0-9-_]+\.)*[a-zA-Z0-9-_]+$/,
                    "Invalid subdomain format"
                )
                .min(1, "Subdomain must be at least 1 character long")
                .transform((val) => val.toLowerCase()),
            z.string().optional()
        ])
        .optional(),
    name: z.string().min(1).max(255),
    proxyPort: z.number().int().min(1).max(65535).optional()
});

type GeneralFormValues = z.infer<typeof GeneralFormSchema>;

export default function GeneralForm() {
    const params = useParams();
    const { toast } = useToast();
    const { resource, updateResource } = useResourceContext();
    const { org } = useOrgContext();
    const router = useRouter();

    const orgId = params.orgId;

    const api = createApiClient(useEnvContext());

    const [sites, setSites] = useState<ListSitesResponse["sites"]>([]);
    const [saveLoading, setSaveLoading] = useState(false);
    const [domainSuffix, setDomainSuffix] = useState(org.org.domain);

    const form = useForm<GeneralFormValues>({
        resolver: zodResolver(GeneralFormSchema),
        defaultValues: {
            name: resource.name,
            subdomain: resource.subdomain ? resource.subdomain : undefined,
            proxyPort: resource.proxyPort ? resource.proxyPort : undefined
        },
        mode: "onChange"
    });

    useEffect(() => {
        const fetchSites = async () => {
            const res = await api.get<AxiosResponse<ListSitesResponse>>(
                `/org/${orgId}/sites/`
            );
            setSites(res.data.data.sites);
        };
        fetchSites();
    }, []);

    async function onSubmit(data: GeneralFormValues) {
        setSaveLoading(true);

        api.post<AxiosResponse<GetResourceAuthInfoResponse>>(
            `resource/${resource?.resourceId}`,
            {
                name: data.name,
                subdomain: data.subdomain
                // siteId: data.siteId,
            }
        )
            .catch((e) => {
                toast({
                    variant: "destructive",
                    title: "Failed to update resource",
                    description: formatAxiosError(
                        e,
                        "An error occurred while updating the resource"
                    )
                });
            })
            .then(() => {
                toast({
                    title: "Resource updated",
                    description: "The resource has been updated successfully"
                });

                updateResource({ name: data.name, subdomain: data.subdomain });

                router.refresh();
            })
            .finally(() => setSaveLoading(false));
    }

    return (
        <SettingsContainer>
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        General Settings
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        Configure the general settings for this resource
                    </SettingsSectionDescription>
                </SettingsSectionHeader>

                <SettingsSectionBody>
                    <SettingsSectionForm>
                        <Form {...form}>
                            <form
                                onSubmit={form.handleSubmit(onSubmit)}
                                className="space-y-4"
                                id="general-settings-form"
                            >
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Name</FormLabel>
                                            <FormControl>
                                                <Input {...field} />
                                            </FormControl>
                                            <FormDescription>
                                                This is the display name of the
                                                resource.
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {resource.http ? (
                                    <FormField
                                        control={form.control}
                                        name="subdomain"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Subdomain</FormLabel>
                                                <FormControl>
                                                    <CustomDomainInput
                                                        value={
                                                            field.value || ""
                                                        }
                                                        domainSuffix={
                                                            domainSuffix
                                                        }
                                                        placeholder="Enter subdomain"
                                                        onChange={(value) =>
                                                            form.setValue(
                                                                "subdomain",
                                                                value
                                                            )
                                                        }
                                                    />
                                                </FormControl>
                                                <FormDescription>
                                                    This is the subdomain that
                                                    will be used to access the
                                                    resource.
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                ) : (
                                    <FormField
                                        control={form.control}
                                        name="proxyPort"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    Port Number
                                                </FormLabel>
                                                <FormControl>
                                                    <Input
                                                        type="number"
                                                        placeholder="Enter port number"
                                                        value={
                                                            field.value ?? ""
                                                        }
                                                        onChange={(e) =>
                                                            field.onChange(
                                                                e.target.value
                                                                    ? parseInt(
                                                                          e
                                                                              .target
                                                                              .value
                                                                      )
                                                                    : null
                                                            )
                                                        }
                                                    />
                                                </FormControl>
                                                <FormDescription>
                                                    This is the port that will
                                                    be used to access the
                                                    resource.
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                )}
                            </form>
                        </Form>
                    </SettingsSectionForm>
                </SettingsSectionBody>

                <SettingsSectionFooter>
                    <Button
                        type="submit"
                        loading={saveLoading}
                        disabled={saveLoading}
                        form="general-settings-form"
                    >
                        Save Settings
                    </Button>
                </SettingsSectionFooter>
            </SettingsSection>
        </SettingsContainer>
    );
}
