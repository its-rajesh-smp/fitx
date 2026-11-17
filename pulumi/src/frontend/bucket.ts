import * as aws from "@pulumi/aws";
import { resourceName } from "../utils/naming";

/** Private bucket holding the built UI. Only CloudFront (via OAC) can read it. */
export const createSiteBucket = () => {
  const bucket = new aws.s3.Bucket(resourceName("ui"), {
    // Contents are build artifacts, re-uploaded on every UI deploy.
    forceDestroy: true,
  });

  new aws.s3.BucketOwnershipControls(resourceName("ui-ownership"), {
    bucket: bucket.id,
    rule: { objectOwnership: "BucketOwnerEnforced" },
  });

  const publicAccessBlock = new aws.s3.BucketPublicAccessBlock(resourceName("ui-public-access"), {
    bucket: bucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  });

  return { bucket, publicAccessBlock };
};
