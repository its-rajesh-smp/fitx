import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

/** Existing public Route 53 hosted zone for the user's domain. */
export const getHostedZone = (hostedZoneName: string) =>
  aws.route53.getZoneOutput({ name: hostedZoneName, privateZone: false });

interface ValidatedCertificateArgs {
  domainName: string;
  zoneId: pulumi.Input<string>;
  provider?: aws.Provider;
}

/** ACM certificate validated through DNS records in the hosted zone. Returns the validated ARN. */
export const createValidatedCertificate = (
  name: string,
  { domainName, zoneId, provider }: ValidatedCertificateArgs,
): pulumi.Output<string> => {
  const opts = provider ? { provider } : undefined;

  const certificate = new aws.acm.Certificate(name, { domainName, validationMethod: "DNS" }, opts);

  const validationOption = certificate.domainValidationOptions[0];

  const validationRecord = new aws.route53.Record(`${name}-validation`, {
    zoneId,
    name: validationOption.resourceRecordName,
    type: validationOption.resourceRecordType,
    records: [validationOption.resourceRecordValue],
    ttl: 300,
    allowOverwrite: true,
  });

  const validation = new aws.acm.CertificateValidation(
    `${name}-validation`,
    {
      certificateArn: certificate.arn,
      validationRecordFqdns: [validationRecord.fqdn],
    },
    opts,
  );

  return validation.certificateArn;
};

interface AliasRecordArgs {
  zoneId: pulumi.Input<string>;
  domainName: string;
  targetDnsName: pulumi.Input<string>;
  targetZoneId: pulumi.Input<string>;
  /** Also create an AAAA record — only for IPv6-enabled targets such as CloudFront. */
  ipv6?: boolean;
}

/** Alias record(s) pointing a domain at an ALB or CloudFront distribution. */
export const createAliasRecords = (
  name: string,
  { zoneId, domainName, targetDnsName, targetZoneId, ipv6 = false }: AliasRecordArgs,
) =>
  (ipv6 ? (["A", "AAAA"] as const) : (["A"] as const)).map(
    (type) =>
      new aws.route53.Record(`${name}-${type.toLowerCase()}`, {
        zoneId,
        name: domainName,
        type,
        aliases: [{ name: targetDnsName, zoneId: targetZoneId, evaluateTargetHealth: false }],
      }),
  );
