import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'lumen-store.json');

export type Reminder = { id: string; title: string; due_at: string; notes?: string; created_at: string };
export type ScheduledEvent = {
  id: string;
  title: string;
  start_at: string;
  end_at?: string;
  notes?: string;
  created_at: string;
};
export type EmailDraft = { id: string; to: string; subject: string; body: string; created_at: string };

export type SocialProvider =
  | 'x'
  | 'linkedin'
  | 'facebook'
  | 'youtube'
  | 'instagram'
  | 'tiktok'
  | 'gmail'
  | 'yahoo'
  | 'telegram'
  | 'whatsapp';
export type SocialConnection = {
  id: string;
  provider: SocialProvider;
  handle: string;
  accessToken: string;
  refreshToken?: string;
  // Provider-specific identifier that isn't a secret, e.g. the WhatsApp phone number id.
  externalId?: string;
  connected_at: string;
};
export type SocialConnectionPublic = Omit<SocialConnection, 'accessToken' | 'refreshToken' | 'externalId'>;

export type SocialPostDraft = {
  id: string;
  provider: SocialProvider;
  content: string;
  created_at: string;
};

type StoreShape = {
  reminders: Reminder[];
  events: ScheduledEvent[];
  drafts: EmailDraft[];
  connections: SocialConnection[];
  socialDrafts: SocialPostDraft[];
};

// Single-user local app — a JSON file is enough persistence without pulling in
// a database dependency. Cached in memory and rewritten whole on every
// mutation; fine at this scale, not meant to survive concurrent writers.
let cache: StoreShape | null = null;

async function load(): Promise<StoreShape> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    cache = JSON.parse(raw) as StoreShape;
  } catch {
    cache = { reminders: [], events: [], drafts: [], connections: [], socialDrafts: [] };
  }
  // Older store files predate these fields — backfill so reads never see undefined.
  cache.connections ??= [];
  cache.socialDrafts ??= [];
  return cache;
}

async function persist() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(cache, null, 2));
}

export async function listReminders(): Promise<Reminder[]> {
  return (await load()).reminders;
}

export async function addReminder(title: string, due_at: string, notes?: string): Promise<Reminder> {
  const store = await load();
  const reminder: Reminder = { id: randomUUID(), title, due_at, notes, created_at: new Date().toISOString() };
  store.reminders.push(reminder);
  await persist();
  return reminder;
}

export async function deleteReminder(id: string): Promise<boolean> {
  const store = await load();
  const before = store.reminders.length;
  store.reminders = store.reminders.filter((r) => r.id !== id);
  await persist();
  return store.reminders.length < before;
}

export async function listEvents(): Promise<ScheduledEvent[]> {
  return (await load()).events;
}

export async function addEvent(
  title: string,
  start_at: string,
  end_at?: string,
  notes?: string
): Promise<ScheduledEvent> {
  const store = await load();
  const event: ScheduledEvent = { id: randomUUID(), title, start_at, end_at, notes, created_at: new Date().toISOString() };
  store.events.push(event);
  await persist();
  return event;
}

export async function deleteEvent(id: string): Promise<boolean> {
  const store = await load();
  const before = store.events.length;
  store.events = store.events.filter((e) => e.id !== id);
  await persist();
  return store.events.length < before;
}

export async function listDrafts(): Promise<EmailDraft[]> {
  return (await load()).drafts;
}

export async function addDraft(to: string, subject: string, body: string): Promise<EmailDraft> {
  const store = await load();
  const draft: EmailDraft = { id: randomUUID(), to, subject, body, created_at: new Date().toISOString() };
  store.drafts.push(draft);
  await persist();
  return draft;
}

function toPublicConnection(c: SocialConnection): SocialConnectionPublic {
  const { accessToken: _accessToken, refreshToken: _refreshToken, externalId: _externalId, ...rest } = c;
  return rest;
}

export async function listConnections(): Promise<SocialConnectionPublic[]> {
  return (await load()).connections.map(toPublicConnection);
}

export async function getConnection(id: string): Promise<SocialConnection | undefined> {
  return (await load()).connections.find((c) => c.id === id);
}

export async function getConnectionByProvider(provider: SocialProvider): Promise<SocialConnection | undefined> {
  return (await load()).connections.find((c) => c.provider === provider);
}

export async function upsertConnection(
  provider: SocialProvider,
  handle: string,
  accessToken: string,
  refreshToken?: string,
  externalId?: string
): Promise<SocialConnectionPublic> {
  const store = await load();
  const existing = store.connections.find((c) => c.provider === provider);
  if (existing) {
    existing.handle = handle;
    existing.accessToken = accessToken;
    existing.refreshToken = refreshToken;
    existing.externalId = externalId;
    existing.connected_at = new Date().toISOString();
    await persist();
    return toPublicConnection(existing);
  }
  const connection: SocialConnection = {
    id: randomUUID(),
    provider,
    handle,
    accessToken,
    refreshToken,
    externalId,
    connected_at: new Date().toISOString(),
  };
  store.connections.push(connection);
  await persist();
  return toPublicConnection(connection);
}

export async function removeConnection(id: string): Promise<boolean> {
  const store = await load();
  const before = store.connections.length;
  store.connections = store.connections.filter((c) => c.id !== id);
  await persist();
  return store.connections.length < before;
}

export async function listSocialDrafts(): Promise<SocialPostDraft[]> {
  return (await load()).socialDrafts;
}

export async function addSocialDraft(provider: SocialProvider, content: string): Promise<SocialPostDraft> {
  const store = await load();
  const draft: SocialPostDraft = { id: randomUUID(), provider, content, created_at: new Date().toISOString() };
  store.socialDrafts.push(draft);
  await persist();
  return draft;
}
