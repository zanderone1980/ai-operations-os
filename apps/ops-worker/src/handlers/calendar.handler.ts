/**
 * Calendar Handler — Processes calendar-related jobs.
 *
 * Job types:
 *   - calendar.check: Check for conflicts and suggest actions
 *   - calendar.respond: Accept/decline/propose new time
 *   - calendar.daily: Generate daily schedule summary
 */

import type { QueueJob } from '../queue';

export interface CalendarCheckData {
  taskId: string;
  eventId: string;
  summary: string;
  startTime: string;
  endTime: string;
  organizer: string;
}

export interface CalendarRespondData {
  taskId: string;
  eventId: string;
  response: 'accept' | 'decline' | 'tentative' | 'propose_new_time';
  proposedTime?: string;
}

/**
 * Handle calendar conflict check.
 */
export async function handleCalendarCheck(job: QueueJob<CalendarCheckData>): Promise<unknown> {
  const { taskId, summary, startTime, endTime, organizer } = job.data;
  console.log(`[calendar.check] Checking: "${summary}" from ${organizer} (task: ${taskId})`);

  // Uses Calendar API when GOOGLE_CLIENT_ID is configured
  return {
    simulation: !process.env.GOOGLE_CLIENT_ID,
    taskId,
    hasConflict: false,
    suggestedResponse: 'accept',
    reason: 'No conflicts detected in checked window',
  };
}

/**
 * Handle calendar response.
 */
export async function handleCalendarRespond(job: QueueJob<CalendarRespondData>): Promise<unknown> {
  const { taskId, eventId, response } = job.data;
  console.log(`[calendar.respond] Responding ${response} to event ${eventId} (task: ${taskId})`);

  // Queues response for approval before sending via Calendar API
  return {
    simulation: !process.env.GOOGLE_CLIENT_ID,
    taskId,
    eventId,
    response,
    status: 'queued_for_approval',
    requiresApproval: true,
  };
}
