import * as command from "@pulumi/command";
import * as pulumi from "@pulumi/pulumi";
import * as path from "path";
import { config } from "../config";
import { hashDirectory } from "../utils/hashDirectory";
import { resourceName } from "../utils/naming";

const UI_DIR = path.resolve(__dirname, "../../../ui");

// Hashed assets are immutable; index.html must always be revalidated so new deploys are picked up.
const DEPLOY_SCRIPT = `
set -euo pipefail
# msw (dev-only mocking) has an unapproved install script; it isn't needed for the build.
pnpm install --frozen-lockfile --config.strict-dep-builds=false
pnpm run build
aws s3 sync dist "s3://$BUCKET" --delete --exclude index.html \\
  --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html "s3://$BUCKET/index.html" \\
  --cache-control "no-cache"
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" > /dev/null
`;

interface UiDeployArgs {
  bucketName: pulumi.Input<string>;
  distributionId: pulumi.Input<string>;
  apiBaseUrl: pulumi.Input<string>;
  dependsOn: pulumi.Resource[];
}

/**
 * Builds the Vite app with production env vars and uploads it to S3.
 * Re-runs whenever UI sources or build-time settings change.
 * Requires pnpm and the AWS CLI on the machine running `pulumi up`.
 */
export const deployUi = ({ bucketName, distributionId, apiBaseUrl, dependsOn }: UiDeployArgs) => {
  const environment: Record<string, pulumi.Input<string>> = {
    BUCKET: bucketName,
    DISTRIBUTION_ID: distributionId,
    AWS_REGION: config.region,
    VITE_API_BASE_URL: apiBaseUrl,
    VITE_GOOGLE_CLIENT_ID: config.googleClientId,
  };
  if (config.awsProfile) environment.AWS_PROFILE = config.awsProfile;

  return new command.local.Command(
    resourceName("ui-deploy"),
    {
      dir: UI_DIR,
      interpreter: ["/bin/bash", "-c"],
      create: DEPLOY_SCRIPT,
      environment,
      triggers: [hashDirectory(UI_DIR), apiBaseUrl, config.googleClientId],
    },
    { dependsOn },
  );
};
