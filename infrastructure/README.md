# Infrastructure & Protected Live Evaluation

`infrastructure/template.yaml` defines the minimal, zero-standing-cost AWS CloudFormation stack specified in [SPEC.md](../SPEC.md) §4, §8, and §10:

1. **`CanonicalEvidenceBucket` (Private Amazon S3)** — Versioned, `BlockPublicAccess` enabled on all four flags, HTTPS-only bucket policy, and `SSE-S3` (`AES256`) encryption (avoiding the `$1.00/month` customer-managed KMS key fee).
2. **`InvestigatorLambdaRole` & `InvestigatorFunction` (AWS Lambda)** — Python 3.12 function with a hard `20s` timeout, `ReservedConcurrentExecutions: 2`, and no public URL or unauthenticated API Gateway endpoint. Its IAM policy grants read-only `s3:GetObject*` on `campaigns/*`, **explicitly denies** access to `ground_truth/*`, and restricts `bedrock:InvokeModel` to the three allowlisted `eu-west-1` inference profiles (`eu.amazon.nova-micro-v1:0`, `eu.amazon.nova-lite-v1:0`, `eu.anthropic.claude-haiku-4-5-20251001-v1:0`).
3. **`GitHubActionsLiveEvalRole` (GitHub OIDC)** — Federated IAM role restricted via `StringEquals` to `repo:camiloavilacm/QualityOps-AI:environment:live-bedrock-eval`. Untrusted pull requests cannot assume this role.

## Validate Template Locally (`$0.00`)

```sh
aws cloudformation validate-template \
  --region eu-west-1 \
  --template-body file://infrastructure/template.yaml
```

## Optional Deployment (`eu-west-1`, `<$0.01/month` Idle Cost)

Requires explicit human authorization before provisioning:

```sh
aws cloudformation deploy \
  --region eu-west-1 \
  --stack-name qualityops-ai-mvp \
  --template-file infrastructure/template.yaml \
  --capabilities CAPABILITY_IAM
```
