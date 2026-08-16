/**
 * Kafka event publisher.
 *
 * Emits domain events to `payment.events`. Downstream services
 * (notification, user-svc, analytics) consume from this topic.
 */

import { randomUUID } from 'node:crypto';

import { Kafka, type Producer, type SASLOptions } from 'kafkajs';

import { getConfig } from '@/config/index.js';
import { getLogger } from '@/config/logger.js';

const log = getLogger('kafka');

let _producer: Producer | null = null;
let _kafka: Kafka | null = null;

export async function initKafka(): Promise<void> {
  if (_producer !== null) return;
  const cfg = getConfig();
  const sasl: SASLOptions | undefined =
    cfg.KAFKA_USERNAME && cfg.KAFKA_PASSWORD
      ? { mechanism: 'plain', username: cfg.KAFKA_USERNAME, password: cfg.KAFKA_PASSWORD }
      : undefined;
  _kafka = new Kafka({
    clientId: cfg.APP_NAME,
    brokers: cfg.KAFKA_BROKERS,
    ssl: cfg.KAFKA_USE_TLS,
    sasl,
    retry: { initialRetryTime: 300, retries: 5 },
  });
  _producer = _kafka.producer({
    idempotent: true,
    maxInFlightRequests: 5,
    allowAutoTopicCreation: false,
  });
  await _producer.connect();
  log.info({ brokers: cfg.KAFKA_BROKERS }, 'kafka_producer_connected');
}

export async function closeKafka(): Promise<void> {
  if (_producer !== null) {
    await _producer.disconnect();
    _producer = null;
  }
}

export async function publishPaymentEvent(
  eventType: string,
  payload: Record<string, unknown>,
  opts: { actorUserId?: string; subjectId?: string; requestId?: string } = {},
): Promise<void> {
  if (_producer === null) {
    log.warn({ event_type: eventType }, 'publish_skipped_no_producer');
    return;
  }
  const cfg = getConfig();
  const envelope = {
    event_id: randomUUID(),
    event_type: eventType,
    occurred_at: new Date().toISOString(),
    subject_id: opts.subjectId ?? null,
    actor_user_id: opts.actorUserId ?? null,
    payload,
    request_id: opts.requestId ?? null,
  };
  try {
    await _producer.send({
      topic: cfg.KAFKA_TOPIC_PAYMENT_EVENTS,
      messages: [
        {
          key: opts.subjectId ?? envelope.event_id,
          value: JSON.stringify(envelope),
          headers: {
            event_type: eventType,
            event_id: envelope.event_id,
          },
        },
      ],
      acks: -1,
    });
  } catch (err) {
    log.error({ err, event_type: eventType }, 'kafka_publish_failed');
  }
}
