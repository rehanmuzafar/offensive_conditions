/**
 * Business metric helpers for Node services (offcon_* series).
 * payment-svc and notification-svc emit these.
 */

import { Counter, Gauge } from "prom-client";
import { registry } from "./observability";

export const businessMetrics = {
  // payment-svc
  paymentAttempts: new Counter({
    name: "offcon_payment_attempts_total",
    help: "Payment attempts.",
    labelNames: ["result"], // succeeded | failed
    registers: [registry],
  }),
  subscriptionMrrCents: new Gauge({
    name: "offcon_subscription_mrr_cents",
    help: "Monthly recurring revenue in cents.",
    registers: [registry],
  }),
  activeSubscriptions: new Gauge({
    name: "offcon_active_subscriptions",
    help: "Active subscriptions by plan.",
    labelNames: ["plan"],
    registers: [registry],
  }),

  // notification-svc
  notificationQueueDepth: new Gauge({
    name: "offcon_notification_queue_depth",
    help: "Pending notifications in the delivery queue.",
    registers: [registry],
  }),
  notificationsSent: new Counter({
    name: "offcon_notifications_sent_total",
    help: "Notifications delivered.",
    labelNames: ["channel", "result"], // channel=email|push|in_app, result=success|failed
    registers: [registry],
  }),
};
