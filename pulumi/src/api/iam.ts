import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { config } from "../config";
import { resourceName } from "../utils/naming";

/** Trust policy for ECS tasks, scoped to this account to prevent confused-deputy use. */
const ecsTasksTrustPolicy = aws.getCallerIdentityOutput().accountId.apply((accountId) =>
  JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Service: "ecs-tasks.amazonaws.com" },
        Action: "sts:AssumeRole",
        Condition: {
          StringEquals: { "aws:SourceAccount": accountId },
          ArnLike: { "aws:SourceArn": `arn:aws:ecs:${config.region}:${accountId}:*` },
        },
      },
    ],
  }),
);

export const createApiRoles = (secretArn: pulumi.Input<string>) => {
  // Execution role: used by the ECS agent to pull the image, write logs and read secrets.
  const executionRole = new aws.iam.Role(resourceName("api-execution-role"), {
    assumeRolePolicy: ecsTasksTrustPolicy,
  });

  new aws.iam.RolePolicyAttachment(resourceName("api-execution-managed"), {
    role: executionRole.name,
    policyArn: aws.iam.ManagedPolicy.AmazonECSTaskExecutionRolePolicy,
  });

  new aws.iam.RolePolicy(resourceName("api-execution-secrets"), {
    role: executionRole.id,
    policy: pulumi.jsonStringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["secretsmanager:GetSecretValue"],
          Resource: [secretArn],
        },
      ],
    }),
  });

  // Task role: permissions for the application itself. The API calls no AWS services,
  // so it only gets what ECS Exec needs (`aws ecs execute-command` for debugging).
  const taskRole = new aws.iam.Role(resourceName("api-task-role"), {
    assumeRolePolicy: ecsTasksTrustPolicy,
  });

  new aws.iam.RolePolicy(resourceName("api-task-exec"), {
    role: taskRole.id,
    policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "ssmmessages:CreateControlChannel",
            "ssmmessages:CreateDataChannel",
            "ssmmessages:OpenControlChannel",
            "ssmmessages:OpenDataChannel",
          ],
          Resource: "*",
        },
      ],
    }),
  });

  return { executionRoleArn: executionRole.arn, taskRoleArn: taskRole.arn };
};
