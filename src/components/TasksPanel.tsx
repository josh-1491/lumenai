import { useEffect, useState } from 'react';
import type { EmailDraft, Reminder, ScheduledEvent, SocialPostDraft } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';
const PROVIDER_LABELS: Record<SocialPostDraft['provider'], string> = {
  x: 'X',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function TasksPanel({ refreshKey }: { refreshKey: number }) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [events, setEvents] = useState<ScheduledEvent[]>([]);
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [socialDrafts, setSocialDrafts] = useState<SocialPostDraft[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [r, e, d, s] = await Promise.all([
          fetch(`${API_BASE}/api/reminders`).then((res) => res.json()),
          fetch(`${API_BASE}/api/events`).then((res) => res.json()),
          fetch(`${API_BASE}/api/drafts`).then((res) => res.json()),
          fetch(`${API_BASE}/api/social-drafts`).then((res) => res.json()),
        ]);
        if (!cancelled) {
          setReminders(r);
          setEvents(e);
          setDrafts(d);
          setSocialDrafts(s);
        }
      } catch {
        // Backend may not be up yet — the panel just stays empty.
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (reminders.length === 0 && events.length === 0 && drafts.length === 0 && socialDrafts.length === 0) {
    return null;
  }

  return (
    <div className="tasks-panel">
      {events.length > 0 && (
        <section className="tasks-section">
          <h3>Scheduled</h3>
          {events.map((e) => (
            <div key={e.id} className="tasks-item">
              <span className="tasks-item-title">{e.title}</span>
              <span className="tasks-item-when">{formatWhen(e.start_at)}</span>
            </div>
          ))}
        </section>
      )}
      {reminders.length > 0 && (
        <section className="tasks-section">
          <h3>Reminders</h3>
          {reminders.map((r) => (
            <div key={r.id} className="tasks-item">
              <span className="tasks-item-title">{r.title}</span>
              <span className="tasks-item-when">{formatWhen(r.due_at)}</span>
            </div>
          ))}
        </section>
      )}
      {drafts.length > 0 && (
        <section className="tasks-section">
          <h3>Email drafts</h3>
          {drafts.map((d) => (
            <div key={d.id} className="tasks-item">
              <span className="tasks-item-title">{d.subject || '(no subject)'}</span>
              <span className="tasks-item-when">to {d.to}</span>
            </div>
          ))}
        </section>
      )}
      {socialDrafts.length > 0 && (
        <section className="tasks-section">
          <h3>Social drafts</h3>
          {socialDrafts.map((d) => (
            <div key={d.id} className="tasks-item">
              <span className="tasks-item-title">{d.content}</span>
              <span className="tasks-item-when">{PROVIDER_LABELS[d.provider]}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
