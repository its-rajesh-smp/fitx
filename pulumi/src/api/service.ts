import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { config } from "../config";
import { Database } from "../database";
import { ApiSecrets } from "../secrets";
import { resourceName } from "../utils/naming";

const CONTAINER_NAME = "api";

interface ApiServiceArgs {
  imageUri: pulumi.Input<string>;
  executionRoleArn: pulumi.Input<string>;
  taskRoleArn: pulumi.Input<string>;
  database: Database;
  secrets: ApiSecrets;
  subnetIds: pulumi.Input<pulumi.Input<string>[]>;
  securityGroupId: pulumi.Input<string>;
  assignPublicIp: boolean;
  targetGroupArn: pulumi.Input<string>;
  dependsOn: pulumi.Resource[];
}

/** ECS cluster, Fargate task definition, service and CPU-based autoscaling for the API. */
export const createApiService = (args: ApiServiceArgs) => {
  const { api } = config;

  const cluster = new aws.ecs.Cluster(resourceName("cluster"), {
    settings: [{ name: "containerInsights", value: api.containerInsights ? "enabled" : "disabled" }],
  });

  const logGroup = new aws.cloudwatch.LogGroup(resourceName("api-logs"), {
    name: `/ecs/${resourceName("api")}`,
    retentionInDays: api.logRetentionDays,
  });

  const environment = Object.entries({
    NODE_ENV: "production",
    PORT: String(api.containerPort),
    POSTGRES_HOST: args.database.host,
    POSTGRES_PORT: args.database.port.apply(String),
    POSTGRES_USER: args.database.username,
    POSTGRES_DB: args.database.name,
    GOOGLE_CLIENT_ID: config.googleClientId,
    ...api.environment,
  }).map(([name, value]) => ({ name, value }));

  const secrets = args.secrets.keys.map((key) => ({
    name: key,
    valueFrom: pulumi.interpolate`${args.secrets.secretArn}:${key}::`,
  }));

  const taskDefinition = new aws.ecs.TaskDefinition(resourceName("api-task"), {
    family: resourceName("api"),
    cpu: String(api.cpu),
    memory: String(api.memory),
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    runtimePlatform: { cpuArchitecture: api.cpuArchitecture, operatingSystemFamily: "LINUX" },
    executionRoleArn: args.executionRoleArn,
    taskRoleArn: args.taskRoleArn,
    containerDefinitions: pulumi.jsonStringify([
      {
        name: CONTAINER_NAME,
        image: args.imageUri,
        essential: true,
        portMappings: [{ containerPort: api.containerPort, protocol: "tcp" }],
        environment,
        secrets,
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": logGroup.name,
            "awslogs-region": config.region,
            "awslogs-stream-prefix": CONTAINER_NAME,
          },
        },
        healthCheck: {
          command: [
            "CMD-SHELL",
            `wget -q -O /dev/null http://127.0.0.1:${api.containerPort}${api.healthCheckPath} || exit 1`,
          ],
          interval: 30,
          timeout: 5,
          retries: 3,
          // Migrations + exercise seeding run before the server starts listening.
          startPeriod: 120,
        },
      },
    ]),
  });

  const service = new aws.ecs.Service(
    resourceName("api"),
    {
      cluster: cluster.arn,
      taskDefinition: taskDefinition.arn,
      desiredCount: api.minCount,
      launchType: "FARGATE",
      networkConfiguration: {
        subnets: args.subnetIds,
        securityGroups: [args.securityGroupId],
        assignPublicIp: args.assignPublicIp,
      },
      loadBalancers: [
        {
          targetGroupArn: args.targetGroupArn,
          containerName: CONTAINER_NAME,
          containerPort: api.containerPort,
        },
      ],
      healthCheckGracePeriodSeconds: 180,
      deploymentMinimumHealthyPercent: 100,
      deploymentMaximumPercent: 200,
      deploymentCircuitBreaker: { enable: true, rollback: true },
      enableExecuteCommand: true,
      propagateTags: "SERVICE",
      waitForSteadyState: true,
    },
    {
      dependsOn: args.dependsOn,
      // Autoscaling owns the running task count after creation.
      ignoreChanges: ["desiredCount"],
    },
  );

  const scalingTarget = new aws.appautoscaling.Target(resourceName("api-scaling-target"), {
    serviceNamespace: "ecs",
    scalableDimension: "ecs:service:DesiredCount",
    resourceId: pulumi.interpolate`service/${cluster.name}/${service.name}`,
    minCapacity: api.minCount,
    maxCapacity: api.maxCount,
  });

  new aws.appautoscaling.Policy(resourceName("api-cpu-scaling"), {
    policyType: "TargetTrackingScaling",
    serviceNamespace: scalingTarget.serviceNamespace,
    scalableDimension: scalingTarget.scalableDimension,
    resourceId: scalingTarget.resourceId,
    targetTrackingScalingPolicyConfiguration: {
      targetValue: api.cpuTargetPercent,
      predefinedMetricSpecification: { predefinedMetricType: "ECSServiceAverageCPUUtilization" },
      scaleInCooldown: 300,
      scaleOutCooldown: 60,
    },
  });

  return {
    clusterName: cluster.name,
    serviceName: service.name,
    logGroupName: logGroup.name,
  };
};
