import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";
import { config } from "../config";
import { resourceName } from "../utils/naming";

export interface Network {
  vpcId: pulumi.Output<string>;
  publicSubnetIds: pulumi.Output<string[]>;
  /** Subnets the ECS tasks run in (private with NAT, or public when NAT is disabled). */
  appSubnetIds: pulumi.Output<string[]>;
  /** Subnets with no internet route — used by RDS. */
  dataSubnetIds: pulumi.Output<string[]>;
  /** Whether ECS tasks need a public IP to reach the internet (no NAT gateway). */
  assignPublicIp: boolean;
}

const natStrategy = {
  none: awsx.ec2.NatGatewayStrategy.None,
  single: awsx.ec2.NatGatewayStrategy.Single,
  onePerAz: awsx.ec2.NatGatewayStrategy.OnePerAz,
} as const;

/**
 * Layout per AZ:
 *  - public   : ALB (+ NAT gateway, or ECS tasks when NAT is disabled)
 *  - private  : ECS tasks, egress through NAT (only when NAT is enabled)
 *  - isolated : RDS, no route to the internet
 */
export const createNetwork = (): Network => {
  const withNat = config.network.natGateways !== "none";

  const subnetSpecs: awsx.types.input.ec2.SubnetSpecArgs[] = [
    { type: awsx.ec2.SubnetType.Public, cidrMask: 22 },
    ...(withNat ? [{ type: awsx.ec2.SubnetType.Private, cidrMask: 20 }] : []),
    { type: awsx.ec2.SubnetType.Isolated, cidrMask: 24 },
  ];

  const vpc = new awsx.ec2.Vpc(resourceName("vpc"), {
    cidrBlock: config.network.vpcCidr,
    numberOfAvailabilityZones: config.network.availabilityZones,
    enableDnsHostnames: true,
    enableDnsSupport: true,
    subnetStrategy: "Auto",
    subnetSpecs,
    natGateways: { strategy: natStrategy[config.network.natGateways] },
  });

  return {
    vpcId: vpc.vpcId,
    publicSubnetIds: vpc.publicSubnetIds,
    appSubnetIds: withNat ? vpc.privateSubnetIds : vpc.publicSubnetIds,
    dataSubnetIds: vpc.isolatedSubnetIds,
    assignPublicIp: !withNat,
  };
};
