import * as pulumi from "@pulumi/pulumi";
import { config } from "../config";
import { createAliasRecords, createValidatedCertificate, getHostedZone } from "../dns";
import { usEast1 } from "../providers";
import { resourceName } from "../utils/naming";
import { createSiteBucket } from "./bucket";
import { createCdn } from "./cdn";
import { deployUi } from "./deploy";

interface FrontendArgs {
  apiOriginDomain: pulumi.Input<string>;
  originVerifySecret: pulumi.Input<string>;
}

/**
 * Public entry point of the app: CloudFront serving the UI from S3 and proxying /api/* to the ALB.
 * Uses the custom domain when configured, otherwise the default *.cloudfront.net URL.
 */
export const createFrontend = ({ apiOriginDomain, originVerifySecret }: FrontendArgs) => {
  const { bucket, publicAccessBlock } = createSiteBucket();

  const zoneId = config.domain ? getHostedZone(config.domain.hostedZoneName).zoneId : undefined;

  const customDomain =
    config.domain && zoneId
      ? {
          domainName: config.domain.uiDomain,
          certificateArn: createValidatedCertificate(resourceName("ui-cert"), {
            domainName: config.domain.uiDomain,
            zoneId,
            provider: usEast1,
          }),
        }
      : undefined;

  const { distribution, bucketPolicy } = createCdn({
    bucket,
    apiOriginDomain,
    originVerifySecret,
    customDomain,
    dependsOn: [publicAccessBlock],
  });

  if (customDomain && zoneId) {
    createAliasRecords(resourceName("ui-dns"), {
      zoneId,
      domainName: customDomain.domainName,
      targetDnsName: distribution.domainName,
      targetZoneId: distribution.hostedZoneId,
      ipv6: true,
    });
  }

  const appUrl = customDomain
    ? pulumi.output(`https://${customDomain.domainName}`)
    : pulumi.interpolate`https://${distribution.domainName}`;

  deployUi({
    bucketName: bucket.bucket,
    distributionId: distribution.id,
    // Same origin as the UI, so no CORS and no separate API domain/certificate.
    apiBaseUrl: "/api/v1",
    dependsOn: [bucketPolicy],
  });

  return {
    appUrl,
    bucketName: bucket.bucket,
    distributionId: distribution.id,
    cloudfrontDomain: distribution.domainName,
  };
};
