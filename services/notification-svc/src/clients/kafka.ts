/**
 * Kafka client (consumer + producer).
 *
 * The consumer subscribes to every domain-event topic and routes incoming
 * envelopes to the dispatch table. The producer is used by the notification
 * service itself if it needs to emit downstream events (e.g. delivery
 * confirmations for analytics).
 */

import { Kafka, type Consumer, type Producer, type SASLOptions } from 'kafkajs';

import { getConfig } from '@/config/index.js';
import { getLogger } from '@/config/logger.js';

const log = getLogger('kafka');

let _kafka: Kafka | null = null;
let _consumer: Consumer | null = null;
let _producer: Producer | null = null;

function buildKafka(): Kafka {
  if (_kafka !== null) return _kafka;
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
  return _kafka;
}

export async function startConsumer(
  handler: (topic: string, partition: number, message: { key: Buffer | null; value: Buffer | null; offset: string }) => Promise<void>,
): Promise<Consumer> {
  if (_consumer !== null) return _consumer;
  const cfg = getConfig();
  const kafka = buildKafka();
  _consumer = kafka.consumer({
    groupId: cfg.KAFKA_CONSUMER_GROUP,
    sessionTimeout: 30_000,
    heartbeatInterval: 3_000,
    allowAutoTopicCreation: false,
  });
  await _consumer.connect();

  const topics = [
    cfg.KAFKA_TOPIC_AUTH_EVENTS,
    cfg.KAFKA_TOPIC_SCORING_EVENTS,
    cfg.KAFKA_TOPIC_PAYMENT_EVENTS,
    cfg.KAFKA_TOPIC_FORUM_EVENTS,
    cfg.KAFKA_TOPIC_WRITEUP_EVENTS,
    cfg.KAFKA_TOPIC_CTF_EVENTS,
  ];
  for (const topic of topics) {
    await _consumer.subscribe({ topic, fromBeginning: false });
  }
  log.info({ topics, group: cfg.KAFKA_CONSUMER_GROUP }, 'kafka_consumer_subscribed');

  await _consumer.run({
    autoCommit: true,
    autoCommitInterval: 5_000,
    eachMessage: async ({ topic, partition, message }) => {
      try {
        await handler(topic, partition, {
          key: message.key as Buffer | null,
          value: message.value as Buffer | null,
          offset: message.offset,
        });
      } catch (err) {
        log.error({ err, topic, partition, offset: message.offset }, 'consumer_message_failed');
        // Don't rethrow — autoCommit progresses, dispatch failures are written
        // to the deliveries table for replay tooling.
      }
    },
  });

  return _consumer;
}

export async function stopConsumer(): Promise<void> {
  if (_consumer !== null) {
    await _consumer.disconnect();
    _consumer = null;
  }
}

export async function startProducer(): Promise<Producer> {
  if (_producer !== null) return _producer;
  const kafka = buildKafka();
  _producer = kafka.producer({
    idempotent: true,
    maxInFlightRequests: 5,
    allowAutoTopicCreation: false,
  });
  await _producer.connect();
  return _producer;
}

export async function stopProducer(): Promise<void> {
  if (_producer !== null) {
    await _producer.disconnect();
    _producer = null;
  }
}
