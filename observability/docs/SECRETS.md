# Secrets — Observability Stack

The K8s manifests **reference** secrets but never contain them. Create these
before `kubectl apply -k k8s/`, or manage them with sealed-secrets /
external-secrets / Vault.

> Never commit real secret values. The commands below use placeholders.

## 1. Grafana admin password

```bash
kubectl -n observability create secret generic grafana-secrets \
  --from-literal=admin-password="$(openssl rand -base64 24)"
```

## 2. Loki S3 backend

```bash
kubectl -n observability create secret generic loki-s3-secrets \
  --from-literal=S3_ENDPOINT="s3.eu-west-1.amazonaws.com" \
  --from-literal=S3_ACCESS_KEY="<access-key>" \
  --from-literal=S3_SECRET_KEY="<secret-key>"
```

## 3. Tempo S3 backend

```bash
kubectl -n observability create secret generic tempo-s3-secrets \
  --from-literal=S3_ENDPOINT="s3.eu-west-1.amazonaws.com" \
  --from-literal=S3_ACCESS_KEY="<access-key>" \
  --from-literal=S3_SECRET_KEY="<secret-key>"
```

## 4. AlertManager receivers

```bash
kubectl -n observability create secret generic alertmanager-secrets \
  --from-literal=SLACK_WEBHOOK_URL="https://hooks.slack.com/services/XXX/YYY/ZZZ" \
  --from-literal=PAGERDUTY_ROUTING_KEY="<pagerduty-integration-key>"
```

## Buckets to pre-create

| Bucket | Used by | Lifecycle |
|--------|---------|-----------|
| `offcon-loki` | Loki | 30-day expiry |
| `offcon-tempo` | Tempo | 14-day expiry |

## Rotation

All four secrets can be rotated without downtime: update the secret, then
`kubectl -n observability rollout restart` the affected workload.
