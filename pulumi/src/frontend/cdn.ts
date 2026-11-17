import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { ORIGIN_VERIFY_HEADER } from "../api";
import { config } from "../config";
import { resourceName } from "../utils/naming";

// AWS managed policies — https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html
const MANAGED_CACHING_OPTIMIZED = "658327ea-f89d-4fab-a63d-7e88639e58f6";
const MANAGED_CACHING_DISABLED = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
const MANAGED_ALL_VIEWER_EXCEPT_HOST = "b689b0a8-53d0-40ab-baf2-68738e2966ac";
const MANAGED_SECURITY_HEADERS = "67f7725c-6f97-4210-82d7-5512b31e9d03";

// Client-side routing: any path whose last segment has no file extension is served index.html.
// Done with a function (not custom error responses) so API 403/404s pass through untouched.
const SPA_REWRITE_FUNCTION = `
function handler(event) {
  var request = event.request;
  var lastSegment = request.uri.split("/").pop();
  if (lastSegment.indexOf(".") === -1) {
    request.uri = "/index.html";
  }
  return request;
}
`;

interface CdnArgs {
  bucket: aws.s3.Bucket;
  apiOriginDomain: pulumi.Input<string>;
  originVerifySecret: pulumi.Input<string>;
  /** Custom domain + validated us-east-1 certificate; omit to use the *.cloudfront.net URL. */
  customDomain?: { domainName: string; certificateArn: pulumi.Input<string> };
  dependsOn: pulumi.Resource[];
}

/**
 * Single CloudFront distribution for the whole app:
 *  - default behavior -> private S3 bucket (UI)
 *  - /api/*           -> ALB (API), never cached
 */
export const createCdn = ({
  bucket,
  apiOriginDomain,
  originVerifySecret,
  customDomain,
  dependsOn,
}: CdnArgs) => {
  const uiOriginId = "ui-s3";
  const apiOriginId = "api-alb";

  const oac = new aws.cloudfront.OriginAccessControl(resourceName("ui-oac"), {
    description: "FitX UI bucket access",
    originAccessControlOriginType: "s3",
    signingBehavior: "always",
    signingProtocol: "sigv4",
  });

  const spaRewrite = new aws.cloudfront.Function(resourceName("spa-rewrite"), {
    runtime: "cloudfront-js-2.0",
    comment: "Serve index.html for client-side routes",
    code: SPA_REWRITE_FUNCTION,
    publish: true,
  });

  const distribution = new aws.cloudfront.Distribution(resourceName("cdn"), {
    enabled: true,
    isIpv6Enabled: true,
    httpVersion: "http2and3",
    priceClass: config.frontend.priceClass,
    aliases: customDomain ? [customDomain.domainName] : [],
    defaultRootObject: "index.html",
    origins: [
      {
        originId: uiOriginId,
        domainName: bucket.bucketRegionalDomainName,
        originAccessControlId: oac.id,
      },
      {
        originId: apiOriginId,
        domainName: apiOriginDomain,
        customOriginConfig: {
          // CloudFront -> ALB is HTTP; the ALB only accepts CloudFront IPs carrying the verify header.
          originProtocolPolicy: "http-only",
          httpPort: 80,
          httpsPort: 443,
          originSslProtocols: ["TLSv1.2"],
          originReadTimeout: config.api.originReadTimeoutSeconds,
          originKeepaliveTimeout: 60,
        },
        customHeaders: [{ name: ORIGIN_VERIFY_HEADER, value: originVerifySecret }],
      },
    ],
    defaultCacheBehavior: {
      targetOriginId: uiOriginId,
      viewerProtocolPolicy: "redirect-to-https",
      allowedMethods: ["GET", "HEAD", "OPTIONS"],
      cachedMethods: ["GET", "HEAD"],
      compress: true,
      cachePolicyId: MANAGED_CACHING_OPTIMIZED,
      responseHeadersPolicyId: MANAGED_SECURITY_HEADERS,
      functionAssociations: [{ eventType: "viewer-request", functionArn: spaRewrite.arn }],
    },
    orderedCacheBehaviors: [
      {
        pathPattern: "/api/*",
        targetOriginId: apiOriginId,
        viewerProtocolPolicy: "redirect-to-https",
        allowedMethods: ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
        cachedMethods: ["GET", "HEAD"],
        // Streamed chat responses must not be buffered for compression.
        compress: false,
        cachePolicyId: MANAGED_CACHING_DISABLED,
        originRequestPolicyId: MANAGED_ALL_VIEWER_EXCEPT_HOST,
      },
    ],
    restrictions: { geoRestriction: { restrictionType: "none" } },
    viewerCertificate: customDomain
      ? {
          acmCertificateArn: customDomain.certificateArn,
          sslSupportMethod: "sni-only",
          minimumProtocolVersion: "TLSv1.2_2021",
        }
      : { cloudfrontDefaultCertificate: true },
  });

  const bucketPolicy = new aws.s3.BucketPolicy(
    resourceName("ui-bucket-policy"),
    {
      bucket: bucket.id,
      policy: pulumi.jsonStringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "AllowCloudFrontRead",
            Effect: "Allow",
            Principal: { Service: "cloudfront.amazonaws.com" },
            Action: "s3:GetObject",
            Resource: pulumi.interpolate`${bucket.arn}/*`,
            Condition: { StringEquals: { "AWS:SourceArn": distribution.arn } },
          },
        ],
      }),
    },
    { dependsOn },
  );

  return { distribution, bucketPolicy };
};
