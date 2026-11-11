import { useEffect, useState } from 'react';
import type { ConnectionProvider, SocialConnection } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';

const PROVIDER_LABELS: Record<ConnectionProvider, string> = {
  x: 'X (Twitter)',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  gmail: 'Gmail',
  yahoo: 'Yahoo Mail',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
};

// Telegram and WhatsApp connect by entering credentials; the rest redirect through OAuth.
type CredentialField = { key: string; label: string; placeholder: string; secret?: boolean };
const CREDENTIAL_FORMS: Partial<Record<ConnectionProvider, { fields: CredentialField[]; help: string }>> = {
  telegram: {
    fields: [{ key: 'botToken', label: 'Bot token', placeholder: '123456:ABC-DEF…', secret: true }],
    help: 'Create a bot with @BotFather on Telegram and paste the token it gives you.',
  },
  whatsapp: {
    fields: [
      { key: 'phoneNumberId', label: 'Phone number ID', placeholder: '1234567890' },
      { key: 'accessToken', label: 'Access token', placeholder: 'EAAG…', secret: true },
    ],
    help: 'From your WhatsApp Business Cloud API app in the Meta developer dashboard.',
  },
};

const PROVIDERS: ConnectionProvider[] = [
  'gmail',
  'yahoo',
  'telegram',
  'whatsapp',
  'x',
  'linkedin',
  'facebook',
  'instagram',
  'tiktok',
  'youtube',
];

const PROVIDER_SETUP_HINTS: Partial<Record<ConnectionProvider, string>> = {
  x: 'Set TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET; register /auth/x/callback.',
  linkedin: 'Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET; register /auth/linkedin/callback.',
  facebook: 'Set FACEBOOK_CLIENT_ID and FACEBOOK_CLIENT_SECRET; register /auth/facebook/callback.',
  instagram: 'Set FACEBOOK_CLIENT_ID and FACEBOOK_CLIENT_SECRET; register /auth/instagram/callback.',
  tiktok: 'Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET; register /auth/tiktok/callback.',
  youtube: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET; register /auth/youtube/callback.',
  gmail: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET; register /auth/gmail/callback.',
  yahoo: 'Set YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET; register /auth/yahoo/callback.',
};

export function ConnectionsModal({ onClose }: { onClose: () => void }) {
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [configured, setConfigured] = useState<Partial<Record<ConnectionProvider, boolean>>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ConnectionProvider | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [connectionsResponse, statusResponse] = await Promise.all([
        fetch(`${API_BASE}/api/connections`),
        fetch(`${API_BASE}/api/social-providers`),
      ]);
      if (!connectionsResponse.ok || !statusResponse.ok) {
        throw new Error('The server could not load connected accounts.');
      }
      const [conns, status] = await Promise.all([connectionsResponse.json(), statusResponse.json()]);
      setConnections(conns);
      setConfigured(status);
      setLoadError(null);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Could not load connected accounts.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function connect(provider: ConnectionProvider) {
    if (CREDENTIAL_FORMS[provider]) {
      setEditing(provider);
      setValues({});
      setError(null);
      return;
    }
    window.location.href = `${API_BASE}/auth/${provider}/start`;
  }

  async function submitCredentials(provider: ConnectionProvider) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/connections/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Server returned ${res.status}`);
        return;
      }
      setEditing(null);
      await refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSubmitting(false);
    }
  }

  async function disconnect(id: string) {
    try {
      const response = await fetch(`${API_BASE}/api/connections/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`Could not disconnect account (server returned ${response.status}).`);
      await refresh();
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Could not disconnect account.');
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Connected accounts</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {loading ? (
          <p className="modal-hint">Loading…</p>
        ) : loadError ? (
          <p className="connection-error">{loadError}</p>
        ) : (
          <div className="connections-list">
            {PROVIDERS.map((provider) => {
              const connection = connections.find((c) => c.provider === provider);
              const form = CREDENTIAL_FORMS[provider];
              const isConfigured = configured[provider] ?? false;
              return (
                <div key={provider}>
                  <div className="connection-row">
                    <div>
                      <div className="connection-name">{PROVIDER_LABELS[provider]}</div>
                      {connection ? (
                        <div className="connection-handle">{connection.handle}</div>
                      ) : !isConfigured ? (
                        <div className="connection-handle connection-handle-muted">
                          {PROVIDER_SETUP_HINTS[provider] ?? 'Not configured'}
                        </div>
                      ) : (
                        <div className="connection-handle connection-handle-muted">Not connected</div>
                      )}
                    </div>
                    {connection ? (
                      <button type="button" className="connection-btn" onClick={() => disconnect(connection.id)}>
                        Disconnect
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="connection-btn connection-btn-primary"
                        disabled={!isConfigured}
                        onClick={() => connect(provider)}
                      >
                        Connect
                      </button>
                    )}
                  </div>

                  {form && editing === provider && !connection && (
                    <form
                      className="connection-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        submitCredentials(provider);
                      }}
                    >
                      {form.fields.map((field) => (
                        <label key={field.key} className="connection-field">
                          <span>{field.label}</span>
                          <input
                            type={field.secret ? 'password' : 'text'}
                            placeholder={field.placeholder}
                            value={values[field.key] ?? ''}
                            onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                            autoComplete="off"
                            required
                          />
                        </label>
                      ))}
                      <p className="modal-hint">{form.help}</p>
                      {error && <p className="connection-error">{error}</p>}
                      <div className="connection-form-actions">
                        <button type="button" className="connection-btn" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                        <button type="submit" className="connection-btn connection-btn-primary" disabled={submitting}>
                          {submitting ? 'Connecting…' : 'Save'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="modal-hint">
          Once connected, Lumen can draft messages and posts for you to review — it never sends or posts on your
          behalf.
        </p>
      </div>
    </div>
  );
}
