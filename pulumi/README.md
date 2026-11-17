# FitX infrastructure (Pulumi + AWS)

```
                    ┌──────────────── Route 53 (your hosted zone) ────────────────┐
                    │                                                             │
  fitx.example.com ─┴─> CloudFront (ACM us-east-1) ──OAC──> S3 (private, UI build)
  api.fitx.example.com ─> ALB :443 (ACM regional) ──> ECS Fargate (API, from ECR) ──> RDS Postgres
                                                        │ private subnets             isolated subnets
                                                        └─> NAT ─> Gemini / OpenAI / YouTube
```

## Layout

```
pulumi/
├── index.ts                 # Composition root: wires modules together and exports outputs
├── Pulumi.yaml              # Project definition
├── Pulumi.prod.yaml         # Stack config (non-secret values + encrypted secrets)
└── src/
    ├── config.ts            # Typed, validated stack configuration (single source of truth)
    ├── providers.ts         # Extra AWS providers (us-east-1 for CloudFront certs)
    ├── network/             # VPC, subnets, NAT, security groups
    ├── dns/                 # Hosted zone lookup, ACM certs w/ DNS validation, alias records
    ├── database/            # RDS Postgres + generated master password
    ├── secrets/             # Secrets Manager JSON secret injected into ECS
    ├── api/                 # ECR + image build, IAM roles, ALB, ECS service + autoscaling
    ├── frontend/            # S3 bucket, CloudFront + OAC, UI build & upload
    └── utils/               # Naming and hashing helpers
```

## Prerequisites

- Pulumi CLI, Node 22+, pnpm, AWS CLI, Docker (running — the API image is built locally)
- AWS credentials (`aws login` or a profile; set `pulumi config set aws:profile <name>` if using one)
- A **public Route 53 hosted zone** for your domain. If the domain is registered elsewhere,
  create the hosted zone in Route 53 and point the registrar's NS records at it.

## First deploy

```bash
cd pulumi
pnpm install
pulumi stack init prod          # or: pulumi stack select prod

# Edit Pulumi.prod.yaml: region, hostedZoneName, uiDomain, apiDomain, googleClientId

# Secrets (encrypted in the stack file)
pulumi config set --secret jwtSecret "$(openssl rand -base64 48)"
pulumi config set --secret geminiApiKey   <key>     # if AI_PROVIDER=gemini
pulumi config set --secret openaiApiKey   <key>     # if AI_PROVIDER=openai
pulumi config set --secret anthropicApiKey <key>    # if AI_PROVIDER=anthropic
pulumi config set --secret youtubeApiKey  <key>

pulumi preview
pulumi up
```

`pulumi up` will:

1. Create the VPC, RDS, Secrets Manager secret, ECR repo, ALB, ECS cluster/service, S3 + CloudFront, certs and DNS.
2. Build `api/Dockerfile.prod`, push it to ECR, and roll out a new ECS task revision. Migrations and
   seeds run on container start, as before.
3. Build the UI with `VITE_API_BASE_URL=https://<apiDomain>/api/v1`, sync it to S3 and invalidate CloudFront.

Subsequent `pulumi up` runs only rebuild/redeploy what changed (new API image digest, or UI source hash).

Add `https://<uiDomain>` to the **Authorized JavaScript origins** of your Google OAuth client.

## Configuration reference

| Key | Default | Notes |
| --- | --- | --- |
| `hostedZoneName` / `uiDomain` / `apiDomain` | — (required) | Domains must be inside the hosted zone |
| `natGateways` | `single` | `none` (tasks in public subnets with public IP, ~$32/mo cheaper), `single`, `onePerAz` |
| `dbInstanceClass` | `db.t4g.micro` | |
| `dbAllocatedStorage` / `dbMaxAllocatedStorage` | `20` / `100` | GiB, storage autoscaling |
| `dbMultiAz` | `false` | |
| `dbDeletionProtection` | `true` on `prod` | Also sets Pulumi `protect` on the instance |
| `dbSkipFinalSnapshot` | `false` on `prod` | |
| `apiCpu` / `apiMemory` | `512` / `1024` | Fargate task size |
| `apiCpuArchitecture` | `ARM64` | `X86_64` also supported |
| `apiMinCount` / `apiMaxCount` | `1` / `3` | CPU target tracking at `apiCpuTargetPercent` (60) |
| `albIdleTimeoutSeconds` | `300` | Keeps streamed chat responses alive |
| `aiProvider` | `gemini` | `gemini`, `openai` or `anthropic` |
| `geminiModel`, `openaiModel`, `openaiMemoryModel`, `anthropicModel`, `anthropicMemoryModel` | see `src/config.ts` | Plain env vars |
| `googleClientId` | `""` | Used by both API and UI build |
| `cloudfrontPriceClass` | `PriceClass_100` | |
| secrets: `jwtSecret` (required), `geminiApiKey`, `openaiApiKey`, `anthropicApiKey`, `youtubeApiKey` | | Stored in Secrets Manager |

`MASTER_PASSWORD` is always set to a random 48-character value so the API's hard-coded fallback is never used.

## Operations

```bash
# Tail API logs
aws logs tail "$(pulumi stack output apiLogGroup)" --follow

# Shell into a running task (ECS Exec)
aws ecs execute-command --cluster "$(pulumi stack output ecsClusterName)" \
  --task <task-id> --container api --interactive --command sh
```

## Teardown

On `prod` the database is protected. To destroy: set `dbDeletionProtection=false`, run `pulumi up`,
then `pulumi destroy`. A final snapshot is kept unless `dbSkipFinalSnapshot=true`.
