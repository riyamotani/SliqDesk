import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export const SLA_QUEUE = 'sla';

export interface SlaJobData {
  ticketId: string;
  organizationId: string;
}

export interface SlaScheduler {
  /** Schedules a check that runs when the ticket's SLA deadline passes. */
  schedule(job: SlaJobData, dueAt: Date): Promise<void>;
}

/**
 * Schedules SLA checks as BullMQ delayed jobs. The job is stored in Redis,
 * not in the API process, so it survives API restarts and is picked up by the
 * separate worker process.
 */
export function createSlaScheduler(connection: Redis): SlaScheduler & { queue: Queue } {
  const queue = new Queue<SlaJobData>(SLA_QUEUE, { connection });
  return {
    queue,
    async schedule(data, dueAt) {
      await queue.add('check', data, {
        delay: Math.max(0, dueAt.getTime() - Date.now()),
        // One job per ticket *and* deadline: scheduling the same deadline twice
        // is a no-op, while a new deadline (priority raised again) gets a new job.
        jobId: `check-${data.ticketId}-${dueAt.getTime()}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    },
  };
}

/** For tests: records scheduled checks instead of queueing them. */
export function createRecordingScheduler() {
  const scheduled: { job: SlaJobData; dueAt: Date }[] = [];
  const scheduler: SlaScheduler = {
    async schedule(job, dueAt) {
      scheduled.push({ job, dueAt });
    },
  };
  return { scheduler, scheduled };
}
