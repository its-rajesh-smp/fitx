import * as pulumi from "@pulumi/pulumi";

const cfg = new pulumi.Config();
const awsCfg = new pulumi.Config("aws");

export type NatGatewayMode = "none" | "single" | "onePerAz";
export type CpuArchitecture = "ARM64" | "X86_64";

const natGateways = (cfg.get("natGateways") ?? "single") as NatGatewayMode;
if (!["none", "single", "onePerAz"].includes(natGateways)) {
  throw new Error(`fitx:natGateways must be none | single | onePerAz, got "${natGateways}"`);
}

const cpuArchitecture = (cfg.get("apiCpuArchitecture") ?? "ARM64") as CpuArchitecture;
if (!["ARM64", "X86_64"].includes(cpuArchitecture)) {
  throw new Error(`fitx:apiCpuArchitecture must be ARM64 | X86_64, got "${cpuArchitecture}"`);
}

const isProd = pulumi.getStack() === "prod";

export const config = {
  project: pulumi.getProject(),
  stack: pulumi.getStack(),
  region: awsCfg.require("region"),
  awsProfile: awsCfg.get("profile"),
  defaultTags: awsCfg.getObject<{ tags?: Record<string, string> }>("defaultTags")?.tags ?? {},

  // Optional custom domain for the CloudFront distribution. When unset, the app is served
  // on the default *.cloudfront.net URL. The API is always reachable under /api on the same host.
  domain: (() => {
    const hostedZoneName = cfg.get("hostedZoneName");
    const uiDomain = cfg.get("uiDomain");
    if (!hostedZoneName && !uiDomain) return undefined;
    if (!hostedZoneName || !uiDomain) {
      throw new Error("Set both fitx:hostedZoneName and fitx:uiDomain, or neither.");
    }
    return { hostedZoneName, uiDomain };
  })(),

  network: {
    vpcCidr: cfg.get("vpcCidr") ?? "10.0.0.0/16",
    availabilityZones: cfg.getNumber("availabilityZones") ?? 2,
    natGateways,
  },

  database: {
    engineVersion: cfg.get("dbEngineVersion") ?? "16",
    instanceClass: cfg.get("dbInstanceClass") ?? "db.t4g.micro",
    allocatedStorage: cfg.getNumber("dbAllocatedStorage") ?? 20,
    maxAllocatedStorage: cfg.getNumber("dbMaxAllocatedStorage") ?? 100,
    name: cfg.get("dbName") ?? "fitx",
    username: cfg.get("dbUsername") ?? "fitx_admin",
    multiAz: cfg.getBoolean("dbMultiAz") ?? false,
    backupRetentionDays: cfg.getNumber("dbBackupRetentionDays") ?? 7,
    deletionProtection: cfg.getBoolean("dbDeletionProtection") ?? isProd,
    skipFinalSnapshot: cfg.getBoolean("dbSkipFinalSnapshot") ?? !isProd,
  },

  api: {
    containerPort: 8080,
    healthCheckPath: "/api/v1/health",
    cpu: cfg.getNumber("apiCpu") ?? 512,
    memory: cfg.getNumber("apiMemory") ?? 1024,
    cpuArchitecture,
    minCount: cfg.getNumber("apiMinCount") ?? 1,
    maxCount: cfg.getNumber("apiMaxCount") ?? 3,
    cpuTargetPercent: cfg.getNumber("apiCpuTargetPercent") ?? 60,
    logRetentionDays: cfg.getNumber("apiLogRetentionDays") ?? 30,
    containerInsights: cfg.getBoolean("containerInsights") ?? false,
    // Chat responses are streamed; keep long-lived connections open (matches the old Vercel maxDuration).
    albIdleTimeoutSeconds: cfg.getNumber("albIdleTimeoutSeconds") ?? 300,
    // CloudFront waits this long for the first byte / between bytes from the API (max 60 without a quota increase).
    originReadTimeoutSeconds: cfg.getNumber("apiOriginReadTimeoutSeconds") ?? 60,
    // Plain (non-secret) environment variables passed to the container.
    environment: {
      AI_PROVIDER: cfg.get("aiProvider") ?? "gemini",
      GEMINI_MODEL: cfg.get("geminiModel") ?? "gemini-2.5-flash-lite",
      OPENAI_MODEL: cfg.get("openaiModel") ?? "gpt-4.1-mini",
      OPENAI_MEMORY_MODEL: cfg.get("openaiMemoryModel") ?? "gpt-4.1-nano",
      ANTHROPIC_MODEL: cfg.get("anthropicModel") ?? "claude-opus-5-5",
      ANTHROPIC_MEMORY_MODEL: cfg.get("anthropicMemoryModel") ?? "claude-haiku-5-5",
      OPENAI_AGENTS_TRACING_ENABLED: cfg.get("openaiAgentsTracingEnabled") ?? "false",
      BCRYPT_SALT_ROUNDS: cfg.get("bcryptSaltRounds") ?? "10",
    },
  },

  // Public OAuth client ID — used by both the API (token verification) and the UI build.
  googleClientId: cfg.get("googleClientId") ?? "",

  // Secrets are only injected into the container when they are set.
  secrets: {
    JWT_SECRET: cfg.requireSecret("jwtSecret"),
    GEMINI_API_KEY: cfg.getSecret("geminiApiKey"),
    OPENAI_API_KEY: cfg.getSecret("openaiApiKey"),
    ANTHROPIC_API_KEY: cfg.getSecret("anthropicApiKey"),
    YOUTUBE_API_KEY: cfg.getSecret("youtubeApiKey"),
  },

  frontend: {
    priceClass: cfg.get("cloudfrontPriceClass") ?? "PriceClass_100",
  },
};

export type AppConfig = typeof config;
