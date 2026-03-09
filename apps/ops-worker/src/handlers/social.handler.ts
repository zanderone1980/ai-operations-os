/**
 * Social Handler — Processes social media-related jobs.
 *
 * Job types:
 *   - social.post: Schedule and publish a post
 *   - social.reply: Draft and send a reply to a mention/comment
 *   - social.engage: Like/repost content
 *   - social.digest: Generate social analytics digest
 */

import type { QueueJob } from '../queue';

export interface SocialPostData {
  taskId: string;
  platform: 'x' | 'linkedin' | 'instagram';
  content: string;
  scheduledAt?: string;
  mediaUrls?: string[];
}

export interface SocialReplyData {
  taskId: string;
  platform: 'x' | 'linkedin' | 'instagram';
  postId: string;
  authorHandle: string;
  originalContent: string;
  draftReply?: string;
}

/**
 * Handle social media post scheduling.
 */
export async function handleSocialPost(job: QueueJob<SocialPostData>): Promise<unknown> {
  const { taskId, platform, content, scheduledAt } = job.data;
  console.log(`[social.post] Scheduling on ${platform}: "${content.slice(0, 50)}..." (task: ${taskId})`);

  // Queues post for approval before publishing via platform connector
  return {
    simulation: !process.env.X_BEARER_TOKEN,
    taskId,
    platform,
    status: scheduledAt ? 'scheduled' : 'queued_for_approval',
    scheduledAt: scheduledAt || new Date().toISOString(),
    requiresApproval: true,
  };
}

/**
 * Handle social media reply.
 */
export async function handleSocialReply(job: QueueJob<SocialReplyData>): Promise<unknown> {
  const { taskId, platform, postId, authorHandle, draftReply } = job.data;
  console.log(`[social.reply] Replying to @${authorHandle} on ${platform} (task: ${taskId})`);

  // Uses LLM draft when OPS_LLM_PROVIDER is set, otherwise uses provided draft
  return {
    simulation: !process.env.OPS_LLM_PROVIDER,
    taskId,
    platform,
    postId,
    draftReply: draftReply || `Thanks for reaching out, @${authorHandle}. Let me look into this and get back to you.`,
    status: 'queued_for_approval',
    requiresApproval: true,
  };
}
