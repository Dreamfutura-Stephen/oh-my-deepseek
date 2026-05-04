/**
 * Mailbox — Houmao-inspired inter-agent messaging.
 *
 * Each agent can send structured messages to other agents.
 * Messages are queued per-recipient and consumed on next agent run.
 *
 * Message format:
 *   { from: string, to: string, type: string, body: string, id: string, ts: string }
 *
 * Types mirror Claude Nexus's signal-bus patterns:
 *   - DELEGATE: hand off a sub-task
 *   - REPORT: report findings back to delegator
 *   - QUERY: ask a question, expect answer
 *   - ALERT: raise an issue that needs attention
 *   - APPROVE: sign off on a deliverable
 *   - REJECT: reject with reason
 */

import { randomUUID } from 'node:crypto';

/** @type {Map<string, Array<object>>} */
const inboxes = new Map();

/**
 * Send a message to an agent's inbox.
 */
export function send({ from, to, type, body }) {
  if (!inboxes.has(to)) inboxes.set(to, []);
  const msg = {
    id: randomUUID().substring(0, 8),
    from,
    to,
    type,
    body,
    ts: new Date().toISOString(),
  };
  inboxes.get(to).push(msg);
  return msg;
}

/**
 * Drain all messages for an agent (read and clear).
 */
export function drain(agentName) {
  const msgs = inboxes.get(agentName) || [];
  inboxes.set(agentName, []);
  return msgs;
}

/**
 * Peek at messages without draining.
 */
export function peek(agentName) {
  return inboxes.get(agentName) || [];
}

/**
 * Check if an agent has pending messages.
 */
export function hasMail(agentName) {
  return (inboxes.get(agentName)?.length || 0) > 0;
}

/**
 * Format pending messages as context for the agent's next run.
 */
export function formatMailContext(agentName) {
  const msgs = drain(agentName);
  if (msgs.length === 0) return null;

  const lines = ['--- INBOX ---'];
  for (const m of msgs) {
    lines.push(`[${m.type}] From ${m.from}: ${m.body}`);
  }
  lines.push('--- END INBOX ---');
  return lines.join('\n');
}

/**
 * Clear all mailboxes (between sessions).
 */
export function clearAll() {
  inboxes.clear();
}
