"use client";

import { Button, buttonVariants } from "@app/components/ui/button";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import { useToast } from "@app/hooks/useToast";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
    Credenza,
    CredenzaBody,
    CredenzaClose,
    CredenzaContent,
    CredenzaDescription,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle
} from "@app/components/Credenza";
import { useParams, useRouter } from "next/navigation";
import { ListSitesResponse } from "@server/routers/site";
import { formatAxiosError } from "@app/lib/api";
import { CheckIcon } from "lucide-react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "@app/components/ui/command";
import { CaretSortIcon } from "@radix-ui/react-icons";
import CustomDomainInput from "./[resourceId]/CustomDomainInput";
import { AxiosResponse } from "axios";
import { Resource } from "@server/db/schema";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { cn } from "@app/lib/cn";
import { Switch } from "@app/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";

const createResourceFormSchema = z
    .object({
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
        siteId: z.number(),
        http: z.boolean(),
        protocol: z.string(),
        proxyPort: z.number().int().min(1).max(65535).optional()
    })
    .refine(
        (data) => {
            if (data.http === true) {
                return true;
            }
            return !!data.proxyPort;
        },
        {
            message: "Port number is required for non-HTTP resources",
            path: ["proxyPort"]
        }
    );

type CreateResourceFormValues = z.infer<typeof createResourceFormSchema>;

type CreateResourceFormProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
};

export default function CreateResourceForm({
    open,
    setOpen
}: CreateResourceFormProps) {
    const { toast } = useToast();

    const api = createApiClient(useEnvContext());

    const [loading, setLoading] = useState(false);
    const params = useParams();

    const orgId = params.orgId;
    const router = useRouter();

    const { org } = useOrgContext();
    const { env } = useEnvContext();

    const [sites, setSites] = useState<ListSitesResponse["sites"]>([]);
    const [domainSuffix, setDomainSuffix] = useState<string>(org.org.domain);

    const form = useForm<CreateResourceFormValues>({
        resolver: zodResolver(createResourceFormSchema),
        defaultValues: {
            subdomain: "",
            name: "My Resource",
            http: true,
            protocol: "tcp"
        }
    });

    useEffect(() => {
        if (!open) {
            return;
        }

        const fetchSites = async () => {
            const res = await api.get<AxiosResponse<ListSitesResponse>>(
                `/org/${orgId}/sites/`
            );
            setSites(res.data.data.sites);

            if (res.data.data.sites.length > 0) {
                form.setValue("siteId", res.data.data.sites[0].siteId);
            }
        };

        fetchSites();
    }, [open]);

    async function onSubmit(data: CreateResourceFormValues) {
        console.log(data);

        const res = await api
            .put<AxiosResponse<Resource>>(
                `/org/${orgId}/site/${data.siteId}/resource/`,
                {
                    name: data.name,
                    subdomain: data.http ? data.subdomain : undefined,
                    http: data.http,
                    protocol: data.protocol,
                    proxyPort: data.http ? undefined : data.proxyPort
                }
            )
            .catch((e) => {
                toast({
                    variant: "destructive",
                    title: "Error creating resource",
                    description: formatAxiosError(
                        e,
                        "An error occurred when creating the resource"
                    )
                });
            });

        if (res && res.status === 201) {
            const id = res.data.data.resourceId;
            // navigate to the resource page
            router.push(`/${orgId}/settings/resources/${id}`);
        }
    }

    return (
        <>
            <Credenza
                open={open}
                onOpenChange={(val) => {
                    setOpen(val);
                    setLoading(false);

                    // reset all values
                    form.reset();
                }}
            >
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>Create Resource</CredenzaTitle>
                        <CredenzaDescription>
                            Create a new resource to proxy requests to your app
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody>
                        <Form {...form}>
                            <form
                                onSubmit={form.handleSubmit(onSubmit)}
                                className="space-y-4"
                                id="create-resource-form"
                            >
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Name</FormLabel>
                                            <FormControl>
                                                <Input
                                                    placeholder="Your name"
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormDescription>
                                                This is the name that will be
                                                displayed for this resource.
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {!env.flags.allowRawResources || (
                                    <FormField
                                        control={form.control}
                                        name="http"
                                        render={({ field }) => (
                                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                                <div className="space-y-0.5">
                                                    <FormLabel className="text-base">
                                                        HTTP Resource
                                                    </FormLabel>
                                                    <FormDescription>
                                                        Toggle if this is an
                                                        HTTP resource or a raw
                                                        TCP/UDP resource
                                                    </FormDescription>
                                                </div>
                                                <FormControl>
                                                    <Switch
                                                        checked={field.value}
                                                        onCheckedChange={
                                                            field.onChange
                                                        }
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                )}

                                {form.watch("http") && (
                                    <FormField
                                        control={form.control}
                                        name="subdomain"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Subdomain</FormLabel>
                                                <FormControl>
                                                    <CustomDomainInput
                                                        value={
                                                            field.value ?? ""
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
                                                    This is the fully qualified
                                                    domain name that will be
                                                    used to access the resource.
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                )}

                                {!form.watch("http") && (
                                    <>
                                        <FormField
                                            control={form.control}
                                            name="protocol"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        Protocol
                                                    </FormLabel>
                                                    <Select
                                                        value={field.value}
                                                        onValueChange={
                                                            field.onChange
                                                        }
                                                    >
                                                        <FormControl>
                                                            <SelectTrigger>
                                                                <SelectValue placeholder="Select a protocol" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent>
                                                            <SelectItem value="tcp">
                                                                TCP
                                                            </SelectItem>
                                                            <SelectItem value="udp">
                                                                UDP
                                                            </SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                    <FormDescription>
                                                        The protocol to use for
                                                        the resource
                                                    </FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
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
                                                                field.value ??
                                                                ""
                                                            }
                                                            onChange={(e) =>
                                                                field.onChange(
                                                                    e.target
                                                                        .value
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
                                                        The port number to proxy
                                                        requests to (required
                                                        for non-HTTP resources)
                                                    </FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </>
                                )}

                                <FormField
                                    control={form.control}
                                    name="siteId"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-col">
                                            <FormLabel>Site</FormLabel>
                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <FormControl>
                                                        <Button
                                                            variant="outline"
                                                            role="combobox"
                                                            className={cn(
                                                                "justify-between",
                                                                !field.value &&
                                                                    "text-muted-foreground"
                                                            )}
                                                        >
                                                            {field.value
                                                                ? sites.find(
                                                                      (site) =>
                                                                          site.siteId ===
                                                                          field.value
                                                                  )?.name
                                                                : "Select site"}
                                                            <CaretSortIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                        </Button>
                                                    </FormControl>
                                                </PopoverTrigger>
                                                <PopoverContent className="p-0">
                                                    <Command>
                                                        <CommandInput placeholder="Search site..." />
                                                        <CommandList>
                                                            <CommandEmpty>
                                                                No site found.
                                                            </CommandEmpty>
                                                            <CommandGroup>
                                                                {sites.map(
                                                                    (site) => (
                                                                        <CommandItem
                                                                            value={
                                                                                site.niceId
                                                                            }
                                                                            key={
                                                                                site.siteId
                                                                            }
                                                                            onSelect={() => {
                                                                                form.setValue(
                                                                                    "siteId",
                                                                                    site.siteId
                                                                                );
                                                                            }}
                                                                        >
                                                                            <CheckIcon
                                                                                className={cn(
                                                                                    "mr-2 h-4 w-4",
                                                                                    site.siteId ===
                                                                                        field.value
                                                                                        ? "opacity-100"
                                                                                        : "opacity-0"
                                                                                )}
                                                                            />
                                                                            {
                                                                                site.name
                                                                            }
                                                                        </CommandItem>
                                                                    )
                                                                )}
                                                            </CommandGroup>
                                                        </CommandList>
                                                    </Command>
                                                </PopoverContent>
                                            </Popover>
                                            <FormDescription>
                                                This is the site that will be
                                                used in the dashboard.
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </form>
                        </Form>
                    </CredenzaBody>
                    <CredenzaFooter>
                        <Button
                            type="submit"
                            form="create-resource-form"
                            loading={loading}
                            disabled={loading}
                        >
                            Create Resource
                        </Button>
                        <CredenzaClose asChild>
                            <Button variant="outline">Close</Button>
                        </CredenzaClose>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>
        </>
    );
}
