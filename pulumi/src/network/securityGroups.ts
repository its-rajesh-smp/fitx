import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { config } from "../config";
import { resourceName } from "../utils/naming";

export interface SecurityGroups {
  albSecurityGroupId: pulumi.Output<string>;
  apiSecurityGroupId: pulumi.Output<string>;
  dbSecurityGroupId: pulumi.Output<string>;
}

/** Traffic flow: CloudFront -> ALB (80) -> API tasks (8080) -> RDS (5432). */
export const createSecurityGroups = (vpcId: pulumi.Input<string>): SecurityGroups => {
  const albSg = new aws.ec2.SecurityGroup(resourceName("alb-sg"), {
    vpcId,
    description: "Public ALB for the FitX API",
  });

  const apiSg = new aws.ec2.SecurityGroup(resourceName("api-sg"), {
    vpcId,
    description: "FitX API ECS tasks",
  });

  const dbSg = new aws.ec2.SecurityGroup(resourceName("db-sg"), {
    vpcId,
    description: "FitX RDS Postgres",
  });

  // ALB: HTTP only from CloudFront's origin-facing IP ranges (AWS-managed prefix list).
  const cloudfrontPrefixList = aws.ec2.getManagedPrefixListOutput({
    name: "com.amazonaws.global.cloudfront.origin-facing",
  });

  new aws.vpc.SecurityGroupIngressRule(resourceName("alb-in-cloudfront"), {
    securityGroupId: albSg.id,
    ipProtocol: "tcp",
    fromPort: 80,
    toPort: 80,
    prefixListId: cloudfrontPrefixList.id,
  });

  new aws.vpc.SecurityGroupEgressRule(resourceName("alb-out-api"), {
    securityGroupId: albSg.id,
    ipProtocol: "tcp",
    fromPort: config.api.containerPort,
    toPort: config.api.containerPort,
    referencedSecurityGroupId: apiSg.id,
  });

  // API tasks: only reachable from the ALB.
  new aws.vpc.SecurityGroupIngressRule(resourceName("api-in-alb"), {
    securityGroupId: apiSg.id,
    ipProtocol: "tcp",
    fromPort: config.api.containerPort,
    toPort: config.api.containerPort,
    referencedSecurityGroupId: albSg.id,
  });

  // API tasks need outbound internet for ECR, Secrets Manager, LLM providers, YouTube and seed data.
  new aws.vpc.SecurityGroupEgressRule(resourceName("api-out-all"), {
    securityGroupId: apiSg.id,
    ipProtocol: "-1",
    cidrIpv4: "0.0.0.0/0",
  });

  // RDS: only reachable from the API tasks. No egress rules.
  new aws.vpc.SecurityGroupIngressRule(resourceName("db-in-api"), {
    securityGroupId: dbSg.id,
    ipProtocol: "tcp",
    fromPort: 5432,
    toPort: 5432,
    referencedSecurityGroupId: apiSg.id,
  });

  return {
    albSecurityGroupId: albSg.id,
    apiSecurityGroupId: apiSg.id,
    dbSecurityGroupId: dbSg.id,
  };
};
