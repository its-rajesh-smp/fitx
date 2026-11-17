import * as aws from "@pulumi/aws";
import { config } from "./config";

/**
 * CloudFront only accepts ACM certificates issued in us-east-1,
 * so the UI certificate is created through this provider.
 */
export const usEast1 = new aws.Provider("us-east-1", {
  region: "us-east-1",
  profile: config.awsProfile,
  defaultTags: { tags: config.defaultTags },
});
