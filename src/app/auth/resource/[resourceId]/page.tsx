import {
    GetResourceAuthInfoResponse,
    GetExchangeTokenResponse
} from "@server/routers/resource";
import ResourceAuthPortal from "./ResourceAuthPortal";
import { internal, priv } from "@app/lib/api";
import { AxiosResponse } from "axios";
import { authCookieHeader } from "@app/lib/api/cookies";
import { cache } from "react";
import { verifySession } from "@app/lib/auth/verifySession";
import { redirect } from "next/navigation";
import ResourceNotFound from "./ResourceNotFound";
import ResourceAccessDenied from "./ResourceAccessDenied";
import AccessToken from "./AccessToken";
import { pullEnv } from "@app/lib/pullEnv";

export default async function ResourceAuthPage(props: {
    params: Promise<{ resourceId: number }>;
    searchParams: Promise<{
        redirect: string | undefined;
        token: string | undefined;
    }>;
}) {
    const params = await props.params;
    const searchParams = await props.searchParams;

    const env = pullEnv();

    let authInfo: GetResourceAuthInfoResponse | undefined;
    try {
        const res = await internal.get<
            AxiosResponse<GetResourceAuthInfoResponse>
        >(`/resource/${params.resourceId}/auth`, await authCookieHeader());

        if (res && res.status === 200) {
            authInfo = res.data.data;
        }
    } catch (e) {}

    const getUser = cache(verifySession);
    const user = await getUser({ skipCheckVerifyEmail: true });

    if (!authInfo) {
        // TODO: fix this
        return (
            <div className="w-full max-w-md">
                {/* @ts-ignore */}
                <ResourceNotFound />
            </div>
        );
    }

    let redirectUrl = authInfo.url;
    if (searchParams.redirect) {
        try {
            const serverResourceHost = new URL(authInfo.url).host;
            const redirectHost = new URL(searchParams.redirect).host;

            if (serverResourceHost === redirectHost) {
                redirectUrl = searchParams.redirect;
            }
        } catch (e) {}
    }

    const hasAuth =
        authInfo.password ||
        authInfo.pincode ||
        authInfo.sso ||
        authInfo.whitelist;
    const isSSOOnly =
        authInfo.sso &&
        !authInfo.password &&
        !authInfo.pincode &&
        !authInfo.whitelist;

    if (user && !user.emailVerified && env.flags.emailVerificationRequired) {
        redirect(
            `/auth/verify-email?redirect=/auth/resource/${authInfo.resourceId}`
        );
    }

    if (!hasAuth) {
        // no authentication so always go straight to the resource
        redirect(redirectUrl);
    }


    // convert the dashboard token into a resource session token
    let userIsUnauthorized = false;
    if (user && authInfo.sso) {
        let redirectToUrl: string | undefined;
        try {
            const res = await priv.post<
                AxiosResponse<GetExchangeTokenResponse>
            >(
                `/resource/${params.resourceId}/get-exchange-token`,
                {},
                await authCookieHeader()
            );

            if (res.data.data.requestToken) {
                const paramName = env.server.resourceSessionRequestParam;
                // append the param with the token to the redirect url
                const fullUrl = new URL(redirectUrl);
                fullUrl.searchParams.append(
                    paramName,
                    res.data.data.requestToken
                );
                redirectToUrl = fullUrl.toString();
            }
        } catch (e) {
            userIsUnauthorized = true;
        }

        if (redirectToUrl) {
            redirect(redirectToUrl);
        }
    }

    if (searchParams.token) {
        const [accessTokenId, accessToken] = searchParams.token.split(".");
        return (
            <div className="w-full max-w-md">
                <AccessToken
                    accessToken={accessToken}
                    accessTokenId={accessTokenId}
                    resourceId={params.resourceId}
                    redirectUrl={redirectUrl}
                />
            </div>
        );
    }

    return (
        <>
            {userIsUnauthorized && isSSOOnly ? (
                <div className="w-full max-w-md">
                    <ResourceAccessDenied />
                </div>
            ) : (
                <div className="w-full max-w-md">
                    <ResourceAuthPortal
                        methods={{
                            password: authInfo.password,
                            pincode: authInfo.pincode,
                            sso: authInfo.sso && !userIsUnauthorized,
                            whitelist: authInfo.whitelist
                        }}
                        resource={{
                            name: authInfo.resourceName,
                            id: authInfo.resourceId
                        }}
                        redirect={redirectUrl}
                    />
                </div>
            )}
        </>
    );
}
