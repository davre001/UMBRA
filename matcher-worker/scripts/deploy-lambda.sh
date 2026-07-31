#!/usr/bin/env bash
# Deploys matcher-worker to AWS Lambda (zip package, no container/ECR needed
# — see README.md for why) and wires an EventBridge schedule to invoke it
# every POLL_MINUTES minutes. Idempotent: safe to re-run after a code change
# (updates function code) or a config change (updates config).
#
# Requires: aws CLI authenticated (`aws sts get-caller-identity` must work),
# `npm run package-lambda` already run (this script zips lambda-build/ as-is
# rather than rebuilding it, so you control exactly when a rebuild happens).
#
# Required env vars (not read from backend/.env automatically — set them
# yourself so you're always the one who knows what's being deployed):
#   BACKEND_URL              e.g. https://your-backend.onrender.com
#   MATCHER_INTERNAL_SECRET  must match the backend's own MATCHER_INTERNAL_SECRET
# Optional:
#   AWS_REGION       default us-east-1
#   FUNCTION_NAME     default umbra-matcher-worker
#   POLL_MINUTES      default 5
#   MEMORY_MB         default 2048
#   TIMEOUT_SECONDS   default 120

set -euo pipefail

: "${BACKEND_URL:?Set BACKEND_URL to your deployed backend's base URL}"
: "${MATCHER_INTERNAL_SECRET:?Set MATCHER_INTERNAL_SECRET (must match the backend's own value)}"
AWS_REGION="${AWS_REGION:-us-east-1}"
FUNCTION_NAME="${FUNCTION_NAME:-umbra-matcher-worker}"
POLL_MINUTES="${POLL_MINUTES:-5}"
MEMORY_MB="${MEMORY_MB:-2048}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-120}"
ROLE_NAME="${FUNCTION_NAME}-role"

cd "$(dirname "$0")/.."

if [ ! -d lambda-build ]; then
  echo "lambda-build/ not found — run 'npm run package-lambda' first." >&2
  exit 1
fi

echo "Zipping lambda-build/ contents..."
rm -f function.zip
if command -v zip >/dev/null 2>&1; then
  (cd lambda-build && zip -qr ../function.zip .)
else
  # No zip on this box (e.g. plain git-bash on Windows) — fall back to
  # PowerShell's Compress-Archive, which is always present on Windows.
  # Needs a real Windows path (git-bash's own $(pwd) is POSIX-style, which
  # PowerShell can't resolve) — `pwd -W` gives the Windows form.
  WIN_DIR="$(pwd -W)"
  powershell.exe -NoProfile -Command \
    "Compress-Archive -Path '${WIN_DIR}\\lambda-build\\*' -DestinationPath '${WIN_DIR}\\function.zip' -Force"
fi
echo "  $(du -h function.zip | cut -f1) function.zip"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# The zip is ~50MB, which the direct `--zip-file fileb://...` upload path
# (whole file in one HTTP request body) has repeatedly failed on
# ("Connection was closed before we received a valid response") — a known
# reliability issue with large inline Lambda uploads. Uploading to S3 first
# and deploying via --code S3Bucket/S3Key instead is the standard, more
# resilient fix (chunked S3 upload vs. one big synchronous PUT).
DEPLOY_BUCKET="${FUNCTION_NAME}-deploy-${ACCOUNT_ID}"
echo "Ensuring S3 deploy bucket ${DEPLOY_BUCKET} exists..."
if ! aws s3api head-bucket --bucket "$DEPLOY_BUCKET" --region "$AWS_REGION" >/dev/null 2>&1; then
  if [ "$AWS_REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$DEPLOY_BUCKET" --region "$AWS_REGION" >/dev/null
  else
    aws s3api create-bucket --bucket "$DEPLOY_BUCKET" --region "$AWS_REGION" \
      --create-bucket-configuration LocationConstraint="$AWS_REGION" >/dev/null
  fi
  echo "  created"
else
  echo "  already exists"
fi

# Fixed key, not timestamped — nothing needs deploy history kept in S3
# (Lambda's own versioning covers that if it's ever needed), so each
# deploy just overwrites the previous object instead of accumulating one
# new object per run forever.
S3_KEY="function.zip"
echo "Uploading function.zip to s3://${DEPLOY_BUCKET}/${S3_KEY}..."
aws s3 cp function.zip "s3://${DEPLOY_BUCKET}/${S3_KEY}" --region "$AWS_REGION" >/dev/null

echo "Ensuring IAM role ${ROLE_NAME} exists..."
if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
    >/dev/null
  aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole \
    >/dev/null
  echo "  created, waiting for IAM propagation..."
  sleep 10
else
  echo "  already exists"
fi
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

ENV_VARS="Variables={BACKEND_URL=${BACKEND_URL},MATCHER_INTERNAL_SECRET=${MATCHER_INTERNAL_SECRET}}"

if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$AWS_REGION" >/dev/null 2>&1; then
  echo "Updating existing function code..."
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --s3-bucket "$DEPLOY_BUCKET" \
    --s3-key "$S3_KEY" \
    --region "$AWS_REGION" \
    >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$AWS_REGION"
  echo "Updating configuration..."
  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --memory-size "$MEMORY_MB" \
    --timeout "$TIMEOUT_SECONDS" \
    --environment "$ENV_VARS" \
    --region "$AWS_REGION" \
    >/dev/null
else
  echo "Creating function..."
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime nodejs20.x \
    --role "$ROLE_ARN" \
    --handler dist/lambda.handler \
    --code S3Bucket="$DEPLOY_BUCKET",S3Key="$S3_KEY" \
    --memory-size "$MEMORY_MB" \
    --timeout "$TIMEOUT_SECONDS" \
    --environment "$ENV_VARS" \
    --region "$AWS_REGION" \
    >/dev/null
fi

RULE_NAME="${FUNCTION_NAME}-schedule"
echo "Ensuring EventBridge schedule (every ${POLL_MINUTES}m)..."
aws events put-rule \
  --name "$RULE_NAME" \
  --schedule-expression "rate(${POLL_MINUTES} minutes)" \
  --state ENABLED \
  --region "$AWS_REGION" \
  >/dev/null

LAMBDA_ARN=$(aws lambda get-function --function-name "$FUNCTION_NAME" --region "$AWS_REGION" --query 'Configuration.FunctionArn' --output text)
aws lambda add-permission \
  --function-name "$FUNCTION_NAME" \
  --statement-id "${RULE_NAME}-invoke" \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn "arn:aws:events:${AWS_REGION}:${ACCOUNT_ID}:rule/${RULE_NAME}" \
  --region "$AWS_REGION" \
  >/dev/null 2>&1 || true # already granted on a re-run

aws events put-targets \
  --rule "$RULE_NAME" \
  --targets "Id=1,Arn=${LAMBDA_ARN}" \
  --region "$AWS_REGION" \
  >/dev/null

echo ""
echo "Deployed: $FUNCTION_NAME ($LAMBDA_ARN)"
echo "Polling every ${POLL_MINUTES} minutes via rule $RULE_NAME."
echo "Watch it: aws logs tail /aws/lambda/${FUNCTION_NAME} --follow --region ${AWS_REGION}"
