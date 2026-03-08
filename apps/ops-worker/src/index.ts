/**
 * AI Operations OS — Worker
 *
 * Background job processor with scheduling, queue management,
 * and handler registration for all workflow domains.
 */

import { JobQueue } from './queue';
import { Scheduler } from './scheduler';
import { handleEmailTriage, handleEmailReply } from './handlers/email.handler';
import { handleCalendarCheck, handleCalendarRespond } from './handlers/calendar.handler';
import { handleSocialPost, handleSocialReply } from './handlers/social.handler';
import { handleStoreFulfill, handleStoreSupport } from './handlers/store.handler';

// ── Initialize ───────────────────────────────────────────────────────────────

const queue = new JobQueue({ pollIntervalMs: 1000 });
const scheduler = new Scheduler(queue);

// ── Register job handlers ────────────────────────────────────────────────────

// Email
queue.registerHandler('email.triage', handleEmailTriage);
queue.registerHandler('email.reply', handleEmailReply);

// Calendar
queue.registerHandler('calendar.check', handleCalendarCheck);
queue.registerHandler('calendar.respond', handleCalendarRespond);

// Social
queue.registerHandler('social.post', handleSocialPost);
queue.registerHandler('social.reply', handleSocialReply);

// Store
queue.registerHandler('store.fulfill', handleStoreFulfill);
queue.registerHandler('store.support', handleStoreSupport);

// ── Register scheduled tasks ─────────────────────────────────────────────────

scheduler.register({
  id: 'daily-email-digest',
  name: 'Daily Email Digest',
  schedule: { hour: 8, minute: 0 },
  jobType: 'email.digest',
  jobData: { type: 'daily' },
  enabled: false, // Enable when Gmail connector is configured
});

scheduler.register({
  id: 'daily-calendar-summary',
  name: 'Daily Calendar Summary',
  schedule: { hour: 7, minute: 30 },
  jobType: 'calendar.daily',
  jobData: { type: 'daily' },
  enabled: false,
});

scheduler.register({
  id: 'social-engagement-check',
  name: 'Social Engagement Check',
  schedule: { minute: 0 }, // Every hour
  jobType: 'social.digest',
  jobData: { type: 'hourly' },
  enabled: false,
});

// ── Start ────────────────────────────────────────────────────────────────────

console.log('\n  AI Operations OS — Worker');
console.log(`  Job handlers: ${8} registered`);
console.log(`  Scheduled tasks: ${scheduler.list().length} registered`);
console.log('');

queue.start();
scheduler.start();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[worker] Shutting down...');
  scheduler.stop();
  queue.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  scheduler.stop();
  queue.stop();
  process.exit(0);
});

export { queue, scheduler };
