import { config } from "../config";

/** Prefix a logical resource name with project and stack, e.g. `fitx-prod-api`. */
export const resourceName = (suffix: string): string =>
  `${config.project}-${config.stack}-${suffix}`;
