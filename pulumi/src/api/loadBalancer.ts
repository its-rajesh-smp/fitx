import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { config } from "../config";
import { resourceName } from "../utils/naming";

/** Header CloudFront adds to every origin request; the ALB rejects requests without it. */
export const ORIGIN_VERIFY_HEADER = "X-Origin-Verify";

interface LoadBalancerArgs {
  vpcId: pulumi.Input<string>;
  subnetIds: pulumi.Input<pulumi.Input<string>[]>;
  securityGroupId: pulumi.Input<string>;
}

/**
 * ALB in front of the API tasks. It is only an origin for CloudFront: the security group
 * allows CloudFront IP ranges only, and requests must carry the secret origin-verify header.
 */
export const createLoadBalancer = ({ vpcId, subnetIds, securityGroupId }: LoadBalancerArgs) => {
  const originVerifySecret = new random.RandomPassword(resourceName("origin-verify"), {
    length: 40,
    special: false,
  });

  const alb = new aws.lb.LoadBalancer(resourceName("alb"), {
    loadBalancerType: "application",
    internal: false,
    subnets: subnetIds,
    securityGroups: [securityGroupId],
    idleTimeout: config.api.albIdleTimeoutSeconds,
    dropInvalidHeaderFields: true,
  });

  const targetGroup = new aws.lb.TargetGroup(resourceName("api-tg"), {
    vpcId,
    port: config.api.containerPort,
    protocol: "HTTP",
    targetType: "ip",
    deregistrationDelay: 30,
    healthCheck: {
      path: config.api.healthCheckPath,
      matcher: "200",
      interval: 30,
      timeout: 5,
      healthyThreshold: 2,
      unhealthyThreshold: 3,
    },
  });

  const listener = new aws.lb.Listener(resourceName("http"), {
    loadBalancerArn: alb.arn,
    port: 80,
    protocol: "HTTP",
    defaultActions: [
      {
        type: "fixed-response",
        fixedResponse: { contentType: "text/plain", statusCode: "403", messageBody: "Forbidden" },
      },
    ],
  });

  const forwardRule = new aws.lb.ListenerRule(resourceName("http-from-cloudfront"), {
    listenerArn: listener.arn,
    priority: 10,
    conditions: [
      {
        httpHeader: {
          httpHeaderName: ORIGIN_VERIFY_HEADER,
          values: [originVerifySecret.result],
        },
      },
    ],
    actions: [{ type: "forward", targetGroupArn: targetGroup.arn }],
  });

  return {
    dnsName: alb.dnsName,
    targetGroupArn: targetGroup.arn,
    originVerifySecret: originVerifySecret.result,
    forwardRule,
  };
};
