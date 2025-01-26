"use client";

import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
    InfoIcon,
    ShieldCheck,
    ShieldOff
} from "lucide-react";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { useResourceContext } from "@app/hooks/useResourceContext";
import { Separator } from "@app/components/ui/separator";
import CopyToClipboard from "@app/components/CopyToClipboard";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";

type ResourceInfoBoxType = {};

export default function ResourceInfoBox({}: ResourceInfoBoxType) {
    const [copied, setCopied] = useState(false);

    const { org } = useOrgContext();
    const { resource, authInfo } = useResourceContext();

    const fullUrl = `${resource.ssl ? "https" : "http"}://${
        resource.subdomain
    }.${org.org.domain}`;

    return (
        <Alert>
            <InfoIcon className="h-4 w-4" />
            <AlertTitle className="font-semibold">
                Resource Information
            </AlertTitle>
            <AlertDescription className="mt-4">
                <InfoSections>
                    {resource.http ? (
                        <>
                            <InfoSection>
                                <InfoSectionTitle>
                                    Authentication
                                </InfoSectionTitle>
                                <InfoSectionContent>
                                    {authInfo.password ||
                                    authInfo.pincode ||
                                    authInfo.sso ||
                                    authInfo.whitelist ? (
                                        <div className="flex items-start space-x-2 text-green-500">
                                            <ShieldCheck className="w-4 h-4 mt-0.5" />
                                            <span>
                                                This resource is protected with
                                                at least one auth method.
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="flex items-center space-x-2 text-yellow-500">
                                            <ShieldOff className="w-4 h-4" />
                                            <span>
                                                Anyone can access this resource.
                                            </span>
                                        </div>
                                    )}
                                </InfoSectionContent>
                            </InfoSection>
                            <Separator orientation="vertical" />
                            <InfoSection>
                                <InfoSectionTitle>URL</InfoSectionTitle>
                                <InfoSectionContent>
                                    <CopyToClipboard
                                        text={fullUrl}
                                        isLink={true}
                                    />
                                </InfoSectionContent>
                            </InfoSection>
                        </>
                    ) : (
                        <>
                            <InfoSection>
                                <InfoSectionTitle>Protocol</InfoSectionTitle>
                                <InfoSectionContent>
                                    <span>{resource.protocol.toUpperCase()}</span>
                                </InfoSectionContent>
                            </InfoSection>
                            <Separator orientation="vertical" />
                            <InfoSection>
                                <InfoSectionTitle>Port</InfoSectionTitle>
                                <InfoSectionContent>
                                    <CopyToClipboard
                                        text={resource.proxyPort!.toString()}
                                        isLink={false}
                                    />
                                </InfoSectionContent>
                            </InfoSection>
                        </>
                    )}
                </InfoSections>
            </AlertDescription>
        </Alert>
    );
}
