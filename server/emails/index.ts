export * from "@server/emails/sendEmail";

import nodemailer from "nodemailer";
import config from "@server/lib/config";
import logger from "@server/logger";

function createEmailClient() {
    const emailConfig = config.getRawConfig().email;
    if (!emailConfig || !emailConfig.no_reply) {
        logger.warn(
            "Email SMTP configuration is missing. Emails will not be sent."
        );
        return;
    }

    return nodemailer.createTransport({
        host: emailConfig.smtp_host,
        port: emailConfig.smtp_port,
        secure: emailConfig.smtp_secure || false,
        auth: {
            user: emailConfig.smtp_user,
            pass: emailConfig.smtp_pass
        }
    });
}

export const emailClient = createEmailClient();

export default emailClient;
