"use client";

import { useEffect, useState, use } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AxiosResponse } from "axios";
import { ListTargetsResponse } from "@server/routers/target/listTargets";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { CreateTargetResponse } from "@server/routers/target";
import {
    ColumnDef,
    getFilteredRowModel,
    getSortedRowModel,
    getPaginationRowModel,
    getCoreRowModel,
    useReactTable,
    flexRender
} from "@tanstack/react-table";
import {
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableHeader,
    TableRow
} from "@app/components/ui/table";
import { useToast } from "@app/hooks/useToast";
import { useResourceContext } from "@app/hooks/useResourceContext";
import { ArrayElement } from "@server/types/ArrayElement";
import { formatAxiosError } from "@app/lib/api/formatAxiosError";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { createApiClient } from "@app/lib/api";
import { GetSiteResponse } from "@server/routers/site";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSectionDescription,
    SettingsSectionBody,
    SettingsSectionFooter
} from "@app/components/Settings";
import { SwitchInput } from "@app/components/SwitchInput";
import { useSiteContext } from "@app/hooks/useSiteContext";

// Regular expressions for validation
const DOMAIN_REGEX =
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const IPV4_REGEX =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const IPV6_REGEX = /^(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}$/i;

// Schema for domain names and IP addresses
const domainSchema = z
    .string()
    .min(1, "Domain cannot be empty")
    .max(255, "Domain name too long")
    .refine(
        (value) => {
            // Check if it's a valid IP address (v4 or v6)
            if (IPV4_REGEX.test(value) || IPV6_REGEX.test(value)) {
                return true;
            }

            // Check if it's a valid domain name
            return DOMAIN_REGEX.test(value);
        },
        {
            message: "Invalid domain name or IP address format",
            path: ["domain"]
        }
    );

const addTargetSchema = z.object({
    ip: domainSchema,
    method: z.string().nullable(),
    port: z.coerce.number().int().positive()
    // protocol: z.string(),
});

type LocalTarget = Omit<
    ArrayElement<ListTargetsResponse["targets"]> & {
        new?: boolean;
        updated?: boolean;
    },
    "protocol"
>;

export default function ReverseProxyTargets(props: {
    params: Promise<{ resourceId: number }>;
}) {
    const params = use(props.params);

    const { toast } = useToast();
    const { resource, updateResource } = useResourceContext();

    const api = createApiClient(useEnvContext());

    const [targets, setTargets] = useState<LocalTarget[]>([]);
    const [site, setSite] = useState<GetSiteResponse>();
    const [targetsToRemove, setTargetsToRemove] = useState<number[]>([]);
    const [sslEnabled, setSslEnabled] = useState(resource.ssl);

    const [loading, setLoading] = useState(false);

    const [pageLoading, setPageLoading] = useState(true);

    const addTargetForm = useForm({
        resolver: zodResolver(addTargetSchema),
        defaultValues: {
            ip: "localhost",
            method: resource.http ? "http" : null,
            port: resource.http ? 80 : resource.proxyPort || 1234
            // protocol: "TCP",
        }
    });

    useEffect(() => {
        const fetchTargets = async () => {
            try {
                const res = await api.get<AxiosResponse<ListTargetsResponse>>(
                    `/resource/${params.resourceId}/targets`
                );

                if (res.status === 200) {
                    setTargets(res.data.data.targets);
                }
            } catch (err) {
                console.error(err);
                toast({
                    variant: "destructive",
                    title: "Failed to fetch targets",
                    description: formatAxiosError(
                        err,
                        "An error occurred while fetching targets"
                    )
                });
            } finally {
                setPageLoading(false);
            }
        };
        fetchTargets();

        const fetchSite = async () => {
            try {
                const res = await api.get<AxiosResponse<GetSiteResponse>>(
                    `/site/${resource.siteId}`
                );

                if (res.status === 200) {
                    setSite(res.data.data);
                }
            } catch (err) {
                console.error(err);
                toast({
                    variant: "destructive",
                    title: "Failed to fetch resource",
                    description: formatAxiosError(
                        err,
                        "An error occurred while fetching resource"
                    )
                });
            }
        };
        fetchSite();
    }, []);

    async function addTarget(data: z.infer<typeof addTargetSchema>) {
        // Check if target with same IP, port and method already exists
        const isDuplicate = targets.some(
            (target) =>
                target.ip === data.ip &&
                target.port === data.port &&
                target.method === data.method
        );

        if (isDuplicate) {
            toast({
                variant: "destructive",
                title: "Duplicate target",
                description: "A target with these settings already exists"
            });
            return;
        }

        if (site && site.type == "wireguard" && site.subnet) {
            // make sure that the target IP is within the site subnet
            const targetIp = data.ip;
            const subnet = site.subnet;
            if (!isIPInSubnet(targetIp, subnet)) {
                toast({
                    variant: "destructive",
                    title: "Invalid target IP",
                    description: "Target IP must be within the site subnet"
                });
                return;
            }
        }

        const newTarget: LocalTarget = {
            ...data,
            enabled: true,
            targetId: new Date().getTime(),
            new: true,
            resourceId: resource.resourceId
        };

        setTargets([...targets, newTarget]);
        addTargetForm.reset();
    }

    const removeTarget = (targetId: number) => {
        setTargets([
            ...targets.filter((target) => target.targetId !== targetId)
        ]);

        if (!targets.find((target) => target.targetId === targetId)?.new) {
            setTargetsToRemove([...targetsToRemove, targetId]);
        }
    };

    async function updateTarget(targetId: number, data: Partial<LocalTarget>) {
        setTargets(
            targets.map((target) =>
                target.targetId === targetId
                    ? { ...target, ...data, updated: true }
                    : target
            )
        );
    }

    async function saveTargets() {
        try {
            setLoading(true);

            for (let target of targets) {
                const data = {
                    ip: target.ip,
                    port: target.port,
                    // protocol: target.protocol,
                    method: target.method,
                    enabled: target.enabled
                };

                if (target.new) {
                    const res = await api.put<
                        AxiosResponse<CreateTargetResponse>
                    >(`/resource/${params.resourceId}/target`, data);
                    target.targetId = res.data.data.targetId;
                } else if (target.updated) {
                    const res = await api.post(
                        `/target/${target.targetId}`,
                        data
                    );
                }

                setTargets([
                    ...targets.map((t) => {
                        let res = {
                            ...t,
                            new: false,
                            updated: false
                        };
                        return res;
                    })
                ]);
            }

            for (const targetId of targetsToRemove) {
                await api.delete(`/target/${targetId}`);
                setTargets(
                    targets.filter((target) => target.targetId !== targetId)
                );
            }

            toast({
                title: "Targets updated",
                description: "Targets updated successfully"
            });

            setTargetsToRemove([]);
        } catch (err) {
            console.error(err);
            toast({
                variant: "destructive",
                title: "Operation failed",
                description: formatAxiosError(
                    err,
                    "An error occurred during the save operation"
                )
            });
        }

        setLoading(false);
    }

    async function saveSsl(val: boolean) {
        const res = await api.post(`/resource/${params.resourceId}`, {
            ssl: val
        });

        setSslEnabled(val);
        updateResource({ ssl: val });

        toast({
            title: "SSL Configuration",
            description: "SSL configuration updated successfully"
        });
    }

    const columns: ColumnDef<LocalTarget>[] = [
        {
            accessorKey: "ip",
            header: "IP / Hostname",
            cell: ({ row }) => (
                <Input
                    defaultValue={row.original.ip}
                    className="min-w-[150px]"
                    onBlur={(e) =>
                        updateTarget(row.original.targetId, {
                            ip: e.target.value
                        })
                    }
                />
            )
        },
        {
            accessorKey: "port",
            header: "Port",
            cell: ({ row }) => (
                <Input
                    type="number"
                    defaultValue={row.original.port}
                    className="min-w-[100px]"
                    onBlur={(e) =>
                        updateTarget(row.original.targetId, {
                            port: parseInt(e.target.value, 10)
                        })
                    }
                />
            )
        },
        // {
        //     accessorKey: "protocol",
        //     header: "Protocol",
        //     cell: ({ row }) => (
        //         <Select
        //             defaultValue={row.original.protocol!}
        //             onValueChange={(value) =>
        //                 updateTarget(row.original.targetId, { protocol: value })
        //             }
        //         >
        //             <SelectTrigger>{row.original.protocol}</SelectTrigger>
        //             <SelectContent>
        //                 <SelectItem value="TCP">TCP</SelectItem>
        //                 <SelectItem value="UDP">UDP</SelectItem>
        //             </SelectContent>
        //         </Select>
        //     ),
        // },
        {
            accessorKey: "enabled",
            header: "Enabled",
            cell: ({ row }) => (
                <Switch
                    defaultChecked={row.original.enabled}
                    onCheckedChange={(val) =>
                        updateTarget(row.original.targetId, { enabled: val })
                    }
                />
            )
        },
        {
            id: "actions",
            cell: ({ row }) => (
                <>
                    <div className="flex items-center justify-end space-x-2">
                        {/* <Dot
                            className={
                                row.original.new || row.original.updated
                                    ? "opacity-100"
                                    : "opacity-0"
                            }
                        /> */}

                        <Button
                            variant="outline"
                            onClick={() => removeTarget(row.original.targetId)}
                        >
                            Delete
                        </Button>
                    </div>
                </>
            )
        }
    ];

    if (resource.http) {
        const methodCol: ColumnDef<LocalTarget> = {
            accessorKey: "method",
            header: "Method",
            cell: ({ row }) => (
                <Select
                    defaultValue={row.original.method ?? ""}
                    onValueChange={(value) =>
                        updateTarget(row.original.targetId, { method: value })
                    }
                >
                    <SelectTrigger className="min-w-[100px]">
                        {row.original.method}
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="http">http</SelectItem>
                        <SelectItem value="https">https</SelectItem>
                    </SelectContent>
                </Select>
            )
        };

        // add this to the first column
        columns.unshift(methodCol);
    }

    const table = useReactTable({
        data: targets,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel()
    });

    if (pageLoading) {
        return <></>;
    }

    return (
        <SettingsContainer>
            {resource.http && (
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        SSL Configuration
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        Setup SSL to secure your connections with LetsEncrypt
                        certificates
                    </SettingsSectionDescription>
                </SettingsSectionHeader>
                <SettingsSectionBody>
                    <SwitchInput
                        id="ssl-toggle"
                        label="Enable SSL (https)"
                        defaultChecked={resource.ssl}
                        onCheckedChange={async (val) => {
                            await saveSsl(val);
                        }}
                    />
                </SettingsSectionBody>
            </SettingsSection>
)}
            {/* Targets Section */}
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        Target Configuration
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        Setup targets to route traffic to your services
                    </SettingsSectionDescription>
                </SettingsSectionHeader>
                <SettingsSectionBody>
                    <Form {...addTargetForm}>
                        <form
                            onSubmit={addTargetForm.handleSubmit(addTarget)}
                            className="space-y-4"
                        >
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                {resource.http && (

                                <FormField
                                    control={addTargetForm.control}
                                    name="method"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Method</FormLabel>
                                            <FormControl>
                                                <Select
                                                    value={field.value || undefined}    
                                                    onValueChange={(value) => {
                                                        addTargetForm.setValue(
                                                            "method",
                                                            value
                                                        );
                                                    }}
                                                >
                                                    <SelectTrigger id="method">
                                                        <SelectValue placeholder="Select method" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="http">
                                                            http
                                                        </SelectItem>
                                                        <SelectItem value="https">
                                                            https
                                                        </SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            )}

                                <FormField
                                    control={addTargetForm.control}
                                    name="ip"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>IP / Hostname</FormLabel>
                                            <FormControl>
                                                <Input id="ip" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                            {site?.type === "newt" ? (
                                                <FormDescription>
                                                    This is the IP or hostname
                                                    of the target service on
                                                    your network.
                                                </FormDescription>
                                            ) : site?.type === "wireguard" ? (
                                                <FormDescription>
                                                    This is the IP of the
                                                    WireGuard peer.
                                                </FormDescription>
                                            ) : null}
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={addTargetForm.control}
                                    name="port"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Port</FormLabel>
                                            <FormControl>
                                                <Input
                                                    id="port"
                                                    type="number"
                                                    {...field}
                                                    required
                                                />
                                            </FormControl>
                                            <FormMessage />
                                            {site?.type === "newt" ? (
                                                <FormDescription>
                                                    This is the port of the
                                                    target service on your
                                                    network.
                                                </FormDescription>
                                            ) : site?.type === "wireguard" ? (
                                                <FormDescription>
                                                    This is the port exposed on
                                                    an address on the WireGuard
                                                    network.
                                                </FormDescription>
                                            ) : null}
                                        </FormItem>
                                    )}
                                />
                            </div>
                            <Button type="submit" variant="outline">
                                Add Target
                            </Button>
                        </form>
                    </Form>

                    <TableContainer>
                        <Table>
                            <TableHeader>
                                {table.getHeaderGroups().map((headerGroup) => (
                                    <TableRow key={headerGroup.id}>
                                        {headerGroup.headers.map((header) => (
                                            <TableHead key={header.id}>
                                                {header.isPlaceholder
                                                    ? null
                                                    : flexRender(
                                                          header.column
                                                              .columnDef.header,
                                                          header.getContext()
                                                      )}
                                            </TableHead>
                                        ))}
                                    </TableRow>
                                ))}
                            </TableHeader>
                            <TableBody>
                                {table.getRowModel().rows?.length ? (
                                    table.getRowModel().rows.map((row) => (
                                        <TableRow key={row.id}>
                                            {row
                                                .getVisibleCells()
                                                .map((cell) => (
                                                    <TableCell key={cell.id}>
                                                        {flexRender(
                                                            cell.column
                                                                .columnDef.cell,
                                                            cell.getContext()
                                                        )}
                                                    </TableCell>
                                                ))}
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell
                                            colSpan={columns.length}
                                            className="h-24 text-center"
                                        >
                                            No targets. Add a target using the
                                            form.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>
                    <SettingsSectionDescription>
                        Multiple targets will get load balanced by Traefik. You can use this for high availability.
                    </SettingsSectionDescription>
                </SettingsSectionBody>
                <SettingsSectionFooter>
                    <Button
                        onClick={saveTargets}
                        loading={loading}
                        disabled={loading}
                    >
                        Save Targets
                    </Button>
                </SettingsSectionFooter>
            </SettingsSection>
        </SettingsContainer>
    );
}

function isIPInSubnet(subnet: string, ip: string): boolean {
    // Split subnet into IP and mask parts
    const [subnetIP, maskBits] = subnet.split("/");
    const mask = parseInt(maskBits);

    if (mask < 0 || mask > 32) {
        throw new Error("Invalid subnet mask. Must be between 0 and 32.");
    }

    // Convert IP addresses to binary numbers
    const subnetNum = ipToNumber(subnetIP);
    const ipNum = ipToNumber(ip);

    // Calculate subnet mask
    const maskNum = mask === 32 ? -1 : ~((1 << (32 - mask)) - 1);

    // Check if the IP is in the subnet
    return (subnetNum & maskNum) === (ipNum & maskNum);
}

function ipToNumber(ip: string): number {
    // Validate IP address format
    const parts = ip.split(".");
    if (parts.length !== 4) {
        throw new Error("Invalid IP address format");
    }

    // Convert IP octets to 32-bit number
    return parts.reduce((num, octet) => {
        const oct = parseInt(octet);
        if (isNaN(oct) || oct < 0 || oct > 255) {
            throw new Error("Invalid IP address octet");
        }
        return (num << 8) + oct;
    }, 0);
}
