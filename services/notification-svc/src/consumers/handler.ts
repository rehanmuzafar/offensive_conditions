/**
 * Kafka consumer entrypoint.
 *
 * Processes envelopes off every domain topic, idempotency-checks via the
 * `consumed_events` table, and hands off to the dispatcher. Designed to be
 * run as a separate process from the HTTP server + BullMQ workers.
 */

import { z } from 'zod';

import { getLogger } from '@/config/logger.js';
import { dispatchEvent, markEventConsumed } from '@/services/dispatcher.js';

const log = getLogger('consumer');

/**
 * Envelope shape — every domain service publishes this envelope.
 * Older publishers may not include `request_id`; we make it optional.
 */
const EnvelopeSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.string().min(1),
  occurred_at: z.string(),
  subject_id: z.string().nullable().optional(),
  actor_user_id: z.string().nullable().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  request_id: z.string().nullable().optional(),
});

export interface RawMessage {
  key: Buffer | null;
  value: Buffer | null;
  offset: string;
}

export async function handleMessage(
  topic: string,
  partition: number,
  message: RawMessage,
): Promise<void> {
  if (!message.value) {
    log.warn({ topic, partition, offset: message.offset }, 'consumer_empty_value');
    return;
  }
  let envelope: z.infer<typeof EnvelopeSchema>;
  try {
    const parsed = JSON.parse(message.value.toString('utf-8'));
    const result = EnvelopeSchema.safeParse(parsed);
    if (!result.success) {
      log.warn(
        { topic, partition, offset: message.offset, issues: result.error.issues },
        'consumer_envelope_invalid',
      );
      return;
    }
    envelope = result.data;
  } catch (err) {
    log.warn({ err, topic, offset: message.offset }, 'consumer_parse_failed');
    return;
  }

  // Idempotency: only process each event_id once
  const fresh = await markEventConsumed({
    event_id: envelope.event_id,
    source_topic: topic,
    event_type: envelope.event_type,
    kafka_offset: message.offset,
    kafka_partition: partition,
  });
  if (!fresh) {
    log.debug({ event_id: envelope.event_id, topic }, 'consumer_duplicate_skipped');
    return;
  }

  // Resolve target user. Conventions:
  //   - If the envelope has `subject_id` AND the event_type implies a per-user
  //     notification (auth.*, scoring.*, payment.*, writeup.*), subject_id IS
  //     the user_id (the subject of the event was the user).
  //   - For forum/CTF events the target is often someone OTHER than the actor,
  //     and the payload includes the explicit `target_user_id` or
  //     `recipient_user_id` field.
  //   - Else, fall back to actor_user_id.
  //
  // This keeps the consumer dumb — the producing services own who-gets-pinged
  // semantics in their payload shape.
  const payload = envelope.payload;
  const targetUserId =
    (payload.target_user_id as string | undefined) ??
    (payload.recipient_user_id as string | undefined) ??
    (payload.user_id as string | undefined) ??
    envelope.subject_id ??
    envelope.actor_user_id;

  if (!targetUserId) {
    log.debug(
      { event_id: envelope.event_id, event_type: envelope.event_type },
      'consumer_no_target_user',
    );
    return;
  }

  // Special handling: forum.post.reply should notify the *thread author*, not
  // the actor (who just posted). The forum-svc puts thread_author_id in payload.
  const recipient: string =
    envelope.event_type === 'forum.post.reply' && payload.thread_author_id
      ? (payload.thread_author_id as string)
      : envelope.event_type === 'forum.user.mentioned' && payload.mentioned_user_id
        ? (payload.mentioned_user_id as string)
        : targetUserId;

  // Self-notification suppression: don't notify the actor about their own
  // action (e.g. user A posting on their own thread).
  if (recipient === envelope.actor_user_id && envelope.event_type === 'forum.post.reply') {
    log.debug({ event_id: envelope.event_id }, 'consumer_self_action_suppressed');
    return;
  }

  try {
    await dispatchEvent({
      user_id: recipient,
      event_id: envelope.event_id,
      event_type: envelope.event_type,
      variables: payload,
    });
  } catch (err) {
    log.error(
      {
        err,
        event_id: envelope.event_id,
        event_type: envelope.event_type,
        recipient,
      },
      'consumer_dispatch_failed',
    );
    // Don't rethrow: the consumed_events row already committed, so we won't
    // re-process. Deliveries are tracked separately and have their own retries.
  }
}
