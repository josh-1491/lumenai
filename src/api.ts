import type { ChatMessage, SocialProvider } from './types';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'text'; media_type: 'text/plain'; data: string }; title: string };

function buildContent(message: ChatMessage): string | ContentBlock[] {
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) return message.content;

  const blocks: ContentBlock[] = attachments.map((a) => {
    if (a.kind === 'image') {
      return { type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } };
    }
    if (a.kind === 'pdf') {
      return { type: 'document', source: { type: 'base64', media_type: a.mediaType, data: a.data } };
    }
    return {
      type: 'document',
      source: { type: 'text', media_type: 'text/plain', data: a.data },
      title: a.name,
    };
  });

  if (message.content.trim()) {
    blocks.push({ type: 'text', text: message.content });
  }
  return blocks;
}

const SOCIAL_PROVIDER_LABELS: Record<SocialProvider, string> = {
  x: 'X',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

const TOOL_LABELS: Record<string, (input: Record<string, unknown>) => string> = {
  create_reminder: (i) => `Created reminder: ${i.title}`,
  list_reminders: () => 'Checked reminders',
  delete_reminder: () => 'Deleted a reminder',
  schedule_event: (i) => `Scheduled: ${i.title}`,
  list_events: () => 'Checked the schedule',
  delete_event: () => 'Deleted an event',
  draft_email: (i) => `Drafted an email to ${i.to}`,
  list_email_drafts: () => 'Checked email drafts',
  list_connections: () => 'Checked connected accounts',
  draft_social_post: (i) =>
    `Drafted a ${SOCIAL_PROVIDER_LABELS[i.provider as SocialProvider] ?? 'social media'} post`,
  list_social_drafts: () => 'Checked social drafts',
};

function summarizeTool(name: string, input: Record<string, unknown>): string {
  return TOOL_LABELS[name]?.(input) ?? `Used ${name}`;
}

export type ToolEvent = { id: string; name: string; summary: string; error?: string };

export async function streamChat(
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  onTool?: (tool: ToolEvent) => void
): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: messages.map((m) => ({ role: m.role, content: buildContent(m) })),
    }),
  });

  if (!response.ok || !response.body) {
    return { ok: false, error: `Server returned ${response.status}` };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let errorMessage: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; parse one at a time.
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const eventLine = frame.split('\n').find((l) => l.startsWith('event: '));
      const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!eventLine || !dataLine) continue;

      const event = eventLine.slice('event: '.length);
      const data = JSON.parse(dataLine.slice('data: '.length));

      if (event === 'delta') {
        onDelta(data.text as string);
      } else if (event === 'tool') {
        const { name, input, error } = data as { name: string; input: Record<string, unknown>; error?: string };
        onTool?.({
          id: crypto.randomUUID(),
          name,
          summary: summarizeTool(name, input),
          error,
        });
      } else if (event === 'error') {
        errorMessage = data.message as string;
      }
    }
  }

  if (errorMessage) return { ok: false, error: errorMessage };
  return { ok: true };
}
