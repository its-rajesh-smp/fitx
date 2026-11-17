import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as path from "path";
import { config } from "../config";
import { resourceName } from "../utils/naming";

const API_DIR = path.resolve(__dirname, "../../../api");

/** ECR repository plus the API image built from `api/Dockerfile.prod` and pushed on `pulumi up`. */
export const createApiImage = () => {
  const repository = new aws.ecr.Repository(resourceName("api"), {
    imageTagMutability: "MUTABLE",
    imageScanningConfiguration: { scanOnPush: true },
    encryptionConfigurations: [{ encryptionType: "AES256" }],
    forceDelete: config.stack !== "prod",
  });

  new aws.ecr.LifecyclePolicy(resourceName("api-lifecycle"), {
    repository: repository.name,
    policy: JSON.stringify({
      rules: [
        {
          rulePriority: 1,
          description: "Keep the 15 most recent images",
          selection: { tagStatus: "any", countType: "imageCountMoreThan", countNumber: 15 },
          action: { type: "expire" },
        },
      ],
    }),
  });

  const image = new awsx.ecr.Image(resourceName("api-image"), {
    repositoryUrl: repository.repositoryUrl,
    context: API_DIR,
    dockerfile: path.join(API_DIR, "Dockerfile.prod"),
    platform: config.api.cpuArchitecture === "ARM64" ? "linux/arm64" : "linux/amd64",
  });

  return {
    repositoryUrl: repository.repositoryUrl,
    // Digest-pinned URI, so a new image always produces a new task definition revision.
    imageUri: image.imageUri,
  };
};
