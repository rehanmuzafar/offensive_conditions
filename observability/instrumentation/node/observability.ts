/**
 * OFFCON observability for Node (Fastify) services.
 *
 * Usage in a service's server.ts:
 *
 *   import { setupObservability, businessMetrics } from "@offcon/observability";
 *
 *   const app = Fastify();
 *   await setupObservability(app, { serviceName: "payment-svc", tier: "billing" });
 *   businessMetrics.paymentAttempts.inc({ result: "succeeded" });
 *
 * Provides Prometheus /metrics (RED metrics with route templating),
 * OpenTelemetry tracing via OTLP, and business metric helpers. Names match the
 * conventions in prometheus/prometheus.yml.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { Resource } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_DEPLOYMENT_ENVIRONMENT,
} from "@opentelemetry/semantic-conventions/incubating";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-node";

export const registry = new Registry();

const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

export interface ObservabilityOptions {
  serviceName: string;
  tier?: string;
  otlpEndpoint?: string;
  sampleRatio?: number;
}

/* -------------------------------------------------------------------------- */
/* RED metrics                                                                */
/* -------------------------------------------------------------------------- */
let httpRequests: Counter<string>;
let httpDuration: Histogram<string>;
let httpInflight: Gauge<string>;
let serviceName = "unknown";

let sdk: NodeSDK | undefined;

export async function setupObservability(
  app: FastifyInstance,
  opts: ObservabilityOptions,
): Promise<void> {
  serviceName = opts.serviceName;
  const tier = opts.tier ?? "unknown";
  const endpoint =
    opts.otlpEndpoint ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    "http://otel-collector:4317";
  const sampleRatio = opts.sampleRatio ?? 1.0;

  // ---- Tracing ----
  sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: serviceName,
      tier,
      [ATTR_DEPLOYMENT_ENVIRONMENT]: process.env.DEPLOY_ENV ?? "production",
    }),
    traceExporter: new OTLPTraceExporter({ url: endpoint }),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(sampleRatio),
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs instrumentation is noisy; disable it
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });
  sdk.start();

  // ---- Default + RED metrics ----
  collectDefaultMetrics({ register: registry, prefix: "" });

  httpRequests = new Counter({
    name: "http_requests_total",
    help: "Total HTTP requests.",
    labelNames: ["service", "method", "path", "status"],
    registers: [registry],
  });
  httpDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request latency.",
    labelNames: ["service", "method", "path", "status"],
    buckets: LATENCY_BUCKETS,
    registers: [registry],
  });
  httpInflight = new Gauge({
    name: "http_inflight_requests",
    help: "In-flight HTTP requests.",
    labelNames: ["service"],
    registers: [registry],
  });

  // ---- Per-request RED hooks ----
  app.addHook("onRequest", async (req: FastifyRequest) => {
    (req as RequestWithTiming)._startTime = process.hrtime.bigint();
    httpInflight.inc({ service: serviceName });
  });

  app.addHook("onResponse", async (req: FastifyRequest, reply: FastifyReply) => {
    httpInflight.dec({ service: serviceName });
    const start = (req as RequestWithTiming)._startTime;
    const elapsed = start ? Number(process.hrtime.bigint() - start) / 1e9 : 0;
    // Fastify exposes the matched route template at req.routeOptions.url
    const path = req.routeOptions?.url ?? "unmatched";
    const labels = {
      service: serviceName,
      method: req.method,
      path,
      status: String(reply.statusCode),
    };
    httpRequests.inc(labels);
    httpDuration.observe(labels, elapsed);
  });

  // ---- Endpoints ----
  app.get("/metrics", async (_req, reply) => {
    reply.header("Content-Type", registry.contentType);
    return registry.metrics();
  });

  app.get("/healthz", async () => ({ status: "ok", service: serviceName }));

  // Graceful shutdown of the trace SDK
  app.addHook("onClose", async () => {
    await sdk?.shutdown();
  });
}

interface RequestWithTiming {
  _startTime?: bigint;
}
