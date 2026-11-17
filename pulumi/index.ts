import * as pulumi from "@pulumi/pulumi";
import { createApi } from "./src/api";
import { createDatabase } from "./src/database";
import { createFrontend } from "./src/frontend";
import { createNetwork, createSecurityGroups } from "./src/network";
import { createApiSecrets } from "./src/secrets";

const network = createNetwork();
const securityGroups = createSecurityGroups(network.vpcId);

const database = createDatabase({
  subnetIds: network.dataSubnetIds,
  securityGroupId: securityGroups.dbSecurityGroupId,
});

const secrets = createApiSecrets(database.password);

const api = createApi({ network, securityGroups, database, secrets });

const frontend = createFrontend({
  apiOriginDomain: api.albDnsName,
  originVerifySecret: api.originVerifySecret,
});

// --- Stack outputs ---
export const appUrl = frontend.appUrl;
export const apiUrl = pulumi.interpolate`${frontend.appUrl}/api/v1`;
export const ecrRepositoryUrl = api.repositoryUrl;
export const apiImageUri = api.imageUri;
export const ecsClusterName = api.clusterName;
export const ecsServiceName = api.serviceName;
export const apiLogGroup = api.logGroupName;
export const albDnsName = api.albDnsName;
export const dbEndpoint = database.host;
export const uiBucketName = frontend.bucketName;
export const cloudfrontDistributionId = frontend.distributionId;
export const cloudfrontDomain = frontend.cloudfrontDomain;
