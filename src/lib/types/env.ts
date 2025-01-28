export type Env = {
    app: {
        environment: string;
        version: string;
    },
    server: {
        externalPort: string;
        nextPort: string;
        sessionCookieName: string;
        resourceAccessTokenParam: string;
        resourceSessionRequestParam: string;
    },
    email: {
        emailEnabled: boolean;
    },
    flags: {
        disableSignupWithoutInvite: boolean;
        disableUserCreateOrg: boolean;
        emailVerificationRequired: boolean;
        allowRawResources: boolean;
    }
};
