import { Database } from "../database";
import { Network, SecurityGroups } from "../network";
import { ApiSecrets } from "../secrets";
import { createApiRoles } from "./iam";
import { createApiImage } from "./image";
import { createLoadBalancer } from "./loadBalancer";
import { createApiService } from "./service";

export { ORIGIN_VERIFY_HEADER } from "./loadBalancer";

interface ApiArgs {
  network: Network;
  securityGroups: SecurityGroups;
  database: Database;
  secrets: ApiSecrets;
}

/** API container image, ALB origin and ECS service. Exposed publicly through CloudFront at /api/*. */
export const createApi = ({ network, securityGroups, database, secrets }: ApiArgs) => {
  const image = createApiImage();
  const roles = createApiRoles(secrets.secretArn);

  const loadBalancer = createLoadBalancer({
    vpcId: network.vpcId,
    subnetIds: network.publicSubnetIds,
    securityGroupId: securityGroups.albSecurityGroupId,
  });

  const service = createApiService({
    imageUri: image.imageUri,
    executionRoleArn: roles.executionRoleArn,
    taskRoleArn: roles.taskRoleArn,
    database,
    secrets,
    subnetIds: network.appSubnetIds,
    securityGroupId: securityGroups.apiSecurityGroupId,
    assignPublicIp: network.assignPublicIp,
    targetGroupArn: loadBalancer.targetGroupArn,
    dependsOn: [loadBalancer.forwardRule],
  });

  return {
    repositoryUrl: image.repositoryUrl,
    imageUri: image.imageUri,
    albDnsName: loadBalancer.dnsName,
    originVerifySecret: loadBalancer.originVerifySecret,
    ...service,
  };
};
