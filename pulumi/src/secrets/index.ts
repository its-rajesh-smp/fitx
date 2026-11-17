import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { config } from "../config";
import { resourceName } from "../utils/naming";

export interface ApiSecrets {
  secretArn: pulumi.Output<string>;
  /** Environment variable names stored as keys in the JSON secret. */
  keys: string[];
}

/**
 * Stores every sensitive API setting as one JSON secret in Secrets Manager.
 * ECS injects each key as an environment variable at task start, so values
 * never appear in the task definition.
 */
export const createApiSecrets = (dbPassword: pulumi.Input<string>): ApiSecrets => {
  // The API accepts MASTER_PASSWORD for any account and falls back to a hard-coded
  // default when unset. Always override it with a random value in deployed stacks.
  const masterPassword = new random.RandomPassword(resourceName("master-password"), {
    length: 48,
    special: false,
  });

  const values: Record<string, pulumi.Input<string>> = {
    POSTGRES_PASSWORD: dbPassword,
    MASTER_PASSWORD: masterPassword.result,
  };

  for (const [key, value] of Object.entries(config.secrets)) {
    if (value !== undefined) values[key] = value;
  }

  const secret = new aws.secretsmanager.Secret(resourceName("api-secrets"), {
    namePrefix: `${config.project}/${config.stack}/api-`,
    description: "Runtime secrets for the FitX API",
    recoveryWindowInDays: config.stack === "prod" ? 7 : 0,
  });

  new aws.secretsmanager.SecretVersion(resourceName("api-secrets-version"), {
    secretId: secret.id,
    secretString: pulumi.secret(pulumi.jsonStringify(values)),
  });

  return { secretArn: secret.arn, keys: Object.keys(values) };
};
