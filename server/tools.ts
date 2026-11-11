import type Anthropic from '@anthropic-ai/sdk';
import {
  addReminder,
  deleteReminder,
  listReminders,
  addEvent,
  deleteEvent,
  listEvents,
  addDraft,
  listDrafts,
  listConnections,
  addSocialDraft,
  listSocialDrafts,
  type SocialProvider,
} from './store.js';

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'create_reminder',
    description:
      "Create a reminder for the user. Use when they ask to be reminded of something at a specific time.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'What to be reminded about' },
        due_at: {
          type: 'string',
          description: 'ISO 8601 date-time the reminder is due, e.g. 2026-10-06T17:00:00',
        },
        notes: { type: 'string', description: 'Optional extra detail' },
      },
      required: ['title', 'due_at'],
    },
  },
  {
    name: 'list_reminders',
    description: "List the user's reminders.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'delete_reminder',
    description: 'Delete a reminder by id. Call list_reminders first if the id is not already known.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'schedule_event',
    description: 'Schedule a calendar event for the user.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start_at: { type: 'string', description: 'ISO 8601 date-time the event starts' },
        end_at: { type: 'string', description: 'ISO 8601 date-time the event ends (optional)' },
        notes: { type: 'string' },
      },
      required: ['title', 'start_at'],
    },
  },
  {
    name: 'list_events',
    description: "List the user's scheduled events.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'delete_event',
    description: 'Delete a scheduled event by id. Call list_events first if the id is not already known.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'draft_email',
    description:
      'Save an email draft for the user to review and send themselves. This does not send the email.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address or name' },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'list_email_drafts',
    description: 'List saved email drafts.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_connections',
    description: "List the user's connected social media accounts.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'draft_social_post',
    description:
      'Save a social media post draft for a connected platform, for the user to review and post themselves. ' +
      'For YouTube, "content" is a video title/description/script rather than a post caption. ' +
      'This does not publish anything. Check list_connections first — only draft for a platform the user has connected.',
    input_schema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          enum: ['x', 'linkedin', 'facebook', 'instagram', 'tiktok', 'youtube'],
          description: 'Which connected platform this is for',
        },
        content: { type: 'string', description: 'The post text (or video title/description for YouTube)' },
      },
      required: ['provider', 'content'],
    },
  },
  {
    name: 'list_social_drafts',
    description: 'List saved social media post drafts.',
    input_schema: { type: 'object', properties: {} },
  },
];

function requireString(input: unknown, field: string): string {
  const value = (input as Record<string, unknown>)?.[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`"${field}" must be a non-empty string`);
  }
  return value;
}

function optionalString(input: unknown, field: string): string | undefined {
  const value = (input as Record<string, unknown>)?.[field];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export async function executeTool(name: string, input: unknown): Promise<string> {
  switch (name) {
    case 'create_reminder': {
      const reminder = await addReminder(
        requireString(input, 'title'),
        requireString(input, 'due_at'),
        optionalString(input, 'notes')
      );
      return JSON.stringify(reminder);
    }
    case 'list_reminders':
      return JSON.stringify(await listReminders());
    case 'delete_reminder': {
      const ok = await deleteReminder(requireString(input, 'id'));
      return ok ? 'deleted' : 'no reminder found with that id';
    }
    case 'schedule_event': {
      const event = await addEvent(
        requireString(input, 'title'),
        requireString(input, 'start_at'),
        optionalString(input, 'end_at'),
        optionalString(input, 'notes')
      );
      return JSON.stringify(event);
    }
    case 'list_events':
      return JSON.stringify(await listEvents());
    case 'delete_event': {
      const ok = await deleteEvent(requireString(input, 'id'));
      return ok ? 'deleted' : 'no event found with that id';
    }
    case 'draft_email': {
      const draft = await addDraft(
        requireString(input, 'to'),
        requireString(input, 'subject'),
        requireString(input, 'body')
      );
      return JSON.stringify(draft);
    }
    case 'list_email_drafts':
      return JSON.stringify(await listDrafts());
    case 'list_connections':
      return JSON.stringify(await listConnections());
    case 'draft_social_post': {
      const provider = requireString(input, 'provider');
      if (
        provider !== 'x' &&
        provider !== 'linkedin' &&
        provider !== 'facebook' &&
        provider !== 'instagram' &&
        provider !== 'tiktok' &&
        provider !== 'youtube'
      ) {
        throw new Error('"provider" must be a supported social platform');
      }
      const draft = await addSocialDraft(provider as SocialProvider, requireString(input, 'content'));
      return JSON.stringify(draft);
    }
    case 'list_social_drafts':
      return JSON.stringify(await listSocialDrafts());
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
