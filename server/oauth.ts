import type { Express } from 'express';
import { randomBytes, createHash } from 'crypto';
import { upsertConnection, type SocialProvider } from './store.js';

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createPkcePair() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// In-memory CSRF state for the handful of seconds between redirecting to the
// provider and it calling us back — a single-process local app doesn't need
// this to survive a restart.
// Telegram and WhatsApp have no consumer OAuth flow — they connect by pasting
// credentials instead (see registerCredentialRoutes).
type OAuthProvider = Exclude<SocialProvider, 'telegram' | 'whatsapp'>;
const PROVIDER_CREDENTIAL_NAMES: Record<OAuthProvider, { clientId: string; clientSecret: string }> = {
  x: { clientId: 'TWITTER_CLIENT_ID', clientSecret: 'TWITTER_CLIENT_SECRET' },
  linkedin: { clientId: 'LINKEDIN_CLIENT_ID', clientSecret: 'LINKEDIN_CLIENT_SECRET' },
  facebook: { clientId: 'FACEBOOK_CLIENT_ID', clientSecret: 'FACEBOOK_CLIENT_SECRET' },
  instagram: { clientId: 'FACEBOOK_CLIENT_ID', clientSecret: 'FACEBOOK_CLIENT_SECRET' },
  tiktok: { clientId: 'TIKTOK_CLIENT_KEY', clientSecret: 'TIKTOK_CLIENT_SECRET' },
  youtube: { clientId: 'GOOGLE_CLIENT_ID', clientSecret: 'GOOGLE_CLIENT_SECRET' },
  gmail: { clientId: 'GOOGLE_CLIENT_ID', clientSecret: 'GOOGLE_CLIENT_SECRET' },
  yahoo: { clientId: 'YAHOO_CLIENT_ID', clientSecret: 'YAHOO_CLIENT_SECRET' },
};

type PendingAuth = { provider: OAuthProvider; codeVerifier?: string; createdAt: number };
const pendingAuth = new Map<string, PendingAuth>();
const PENDING_TTL_MS = 10 * 60 * 1000;

function rememberState(provider: OAuthProvider,codeVerifier?: string): string {
  const state = base64url(randomBytes(16));
  pendingAuth.set(state, { provider, codeVerifier, createdAt: Date.now() });
  return state;
}

function consumeState(state: string): PendingAuth | undefined {
  const entry = pendingAuth.get(state);
  if (!entry) return undefined;
  pendingAuth.delete(state);
  if (Date.now() - entry.createdAt > PENDING_TTL_MS) return undefined;
  return entry;
}

type ProviderConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  usesPkce: boolean;
  clientId: string | undefined;
  clientSecret: string | undefined;
  redirectUri: string;
  extraAuthorizeParams?: Record<string, string>;
  clientIdParam?: string;
  tokenClientIdParam?: string | null;
  tokenResponseData?: boolean;
  tokenAuthStyle?: 'basic';
  fetchHandle: (accessToken: string) => Promise<string>;
};

function buildProviderConfigs(): Record<OAuthProvider, ProviderConfig> {
  const apiBase = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 8787}`;
  return {
    x: {
      authorizeUrl: 'https://twitter.com/i/oauth2/authorize',
      tokenUrl: 'https://api.twitter.com/2/oauth2/token',
      scope: 'tweet.read tweet.write users.read offline.access',
      usesPkce: true,
      clientId: process.env.TWITTER_CLIENT_ID,
      clientSecret: process.env.TWITTER_CLIENT_SECRET,
      redirectUri: process.env.TWITTER_REDIRECT_URI ?? `${apiBase}/auth/x/callback`,
      fetchHandle: async (accessToken) => {
        const res = await fetch('https://api.twitter.com/2/users/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error(`X profile lookup failed: ${res.status}`);
        const body = (await res.json()) as { data?: { username?: string } };
        return body.data?.username ? `@${body.data.username}` : 'Connected X account';
      },
    },
    linkedin: {
      authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
      tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
      scope: 'openid profile w_member_social email',
      usesPkce: false,
      clientId: process.env.LINKEDIN_CLIENT_ID,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
      redirectUri: process.env.LINKEDIN_REDIRECT_URI ?? `${apiBase}/auth/linkedin/callback`,
      fetchHandle: async (accessToken) => {
        const res = await fetch('https://api.linkedin.com/v2/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error(`LinkedIn profile lookup failed: ${res.status}`);
        const body = (await res.json()) as { name?: string; email?: string };
        return body.name ?? body.email ?? 'Connected LinkedIn account';
      },
    },
    facebook: {
      authorizeUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
      tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
      scope: 'public_profile,email',
      usesPkce: false,
      clientId: process.env.FACEBOOK_CLIENT_ID,
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
      redirectUri: process.env.FACEBOOK_REDIRECT_URI ?? `${apiBase}/auth/facebook/callback`,
      fetchHandle: async (accessToken) => {
        const res = await fetch(
          `https://graph.facebook.com/me?fields=name&access_token=${encodeURIComponent(accessToken)}`
        );
        if (!res.ok) throw new Error(`Facebook profile lookup failed: ${res.status}`);
        const body = (await res.json()) as { name?: string };
        return body.name ?? 'Connected Facebook account';
      },
    },
    // Instagram's business API is Facebook Login with Instagram-specific scopes —
    // same app/credentials as `facebook`, just a distinct redirect URI and scope.
    instagram: {
      authorizeUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
      tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
      scope: 'instagram_basic,pages_show_list,business_management',
      usesPkce: false,
      clientId: process.env.FACEBOOK_CLIENT_ID,
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
      redirectUri: process.env.INSTAGRAM_REDIRECT_URI ?? `${apiBase}/auth/instagram/callback`,
      fetchHandle: async (accessToken) => {
        try {
          const pagesRes = await fetch(
            `https://graph.facebook.com/me/accounts?access_token=${encodeURIComponent(accessToken)}`
          );
          const pagesBody = (await pagesRes.json()) as { data?: { id: string }[] };
          for (const page of pagesBody.data ?? []) {
            const igRes = await fetch(
              `https://graph.facebook.com/${page.id}?fields=instagram_business_account{username}&access_token=${encodeURIComponent(accessToken)}`
            );
            const igBody = (await igRes.json()) as { instagram_business_account?: { username?: string } };
            const username = igBody.instagram_business_account?.username;
            if (username) return `@${username}`;
          }
        } catch {
          // Fall through — still a valid connection even if we can't resolve
          // a linked Instagram business account yet.
        }
        return 'Connected Instagram account';
      },
    },
    youtube: {
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/youtube.readonly',
      usesPkce: false,
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.YOUTUBE_REDIRECT_URI ?? `${apiBase}/auth/youtube/callback`,
      // Needed to get a refresh_token back from Google on first consent.
      extraAuthorizeParams: { access_type: 'offline', prompt: 'consent' },
      fetchHandle: async (accessToken) => {
        const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error(`YouTube channel lookup failed: ${res.status}`);
        const body = (await res.json()) as { items?: { snippet?: { title?: string } }[] };
        return body.items?.[0]?.snippet?.title ?? 'Connected YouTube channel';
      },
    },
    tiktok: {
      authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
      tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
      scope: 'user.info.basic',
      usesPkce: false,
      clientId: process.env.TIKTOK_CLIENT_KEY,
      clientSecret: process.env.TIKTOK_CLIENT_SECRET,
      redirectUri: process.env.TIKTOK_REDIRECT_URI ?? `${apiBase}/auth/tiktok/callback`,
      clientIdParam: 'client_key',
      tokenResponseData: true,
      fetchHandle: async (accessToken) => {
        const res = await fetch(
          'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name',
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!res.ok) throw new Error(`TikTok profile lookup failed: ${res.status}`);
        const body = (await res.json()) as {
          data?: { user?: { display_name?: string } };
          error?: { message?: string };
        };
        if (body.error?.message) throw new Error(`TikTok profile lookup failed: ${body.error.message}`);
        return body.data?.user?.display_name ?? 'Connected TikTok account';
      },
    },
    gmail: {
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose',
      usesPkce: false,
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GMAIL_REDIRECT_URI ?? `${apiBase}/auth/gmail/callback`,
      extraAuthorizeParams: { access_type: 'offline', prompt: 'consent' },
      fetchHandle: async (accessToken) => {
        const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error(`Gmail profile lookup failed: ${res.status}`);
        const body = (await res.json()) as { emailAddress?: string };
        return body.emailAddress ?? 'Connected Gmail account';
      },
    },
    yahoo: {
      authorizeUrl: 'https://api.login.yahoo.com/oauth2/request_auth',
      tokenUrl: 'https://api.login.yahoo.com/oauth2/get_token',
      scope: 'mail-r',
      usesPkce: false,
      clientId: process.env.YAHOO_CLIENT_ID,
      clientSecret: process.env.YAHOO_CLIENT_SECRET,
      redirectUri: process.env.YAHOO_REDIRECT_URI ?? `${apiBase}/auth/yahoo/callback`,
      tokenClientIdParam: null,
      tokenAuthStyle: 'basic',
      fetchHandle: async () => 'Yahoo Mail account',
    },
  };
}

export function getProviderStatus(): Record<SocialProvider, boolean> {
  const providers = buildProviderConfigs();
  return {
    x: !!providers.x.clientId && !!providers.x.clientSecret,
    linkedin: !!providers.linkedin.clientId && !!providers.linkedin.clientSecret,
    facebook: !!providers.facebook.clientId && !!providers.facebook.clientSecret,
    instagram: !!providers.instagram.clientId && !!providers.instagram.clientSecret,
    youtube: !!providers.youtube.clientId && !!providers.youtube.clientSecret,
    tiktok: !!providers.tiktok.clientId && !!providers.tiktok.clientSecret,
    gmail: !!providers.gmail.clientId && !!providers.gmail.clientSecret,
    yahoo: !!providers.yahoo.clientId && !!providers.yahoo.clientSecret,
    // Credential-based: always available, the user supplies the keys in the UI.
    telegram: true,
    whatsapp: true,
  };
}

export function registerCredentialRoutes(app: Express) {
  // Telegram: user creates a bot with @BotFather and pastes its token.
  app.post('/api/connections/telegram', async (req, res) => {
    const token = typeof req.body?.botToken === 'string' ? req.body.botToken.trim() : '';
    if (!token) return res.status(400).json({ error: 'Bot token is required.' });

    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getMe`);
      const body = (await tgRes.json()) as { ok: boolean; result?: { username?: string }; description?: string };
      if (!tgRes.ok || !body.ok) {
        return res.status(400).json({ error: body.description ?? 'Telegram rejected that bot token.' });
      }
      const handle = body.result?.username ? `@${body.result.username}` : 'Telegram bot';
      res.json(await upsertConnection('telegram', handle, token));
    } catch (err) {
      console.error('Telegram connect failed:', err);
      res.status(502).json({ error: 'Could not reach Telegram.' });
    }
  });

  // WhatsApp: WhatsApp Business Cloud API — user supplies a phone number id and access token
  // from their Meta developer app.
  app.post('/api/connections/whatsapp', async (req, res) => {
    const phoneNumberId = typeof req.body?.phoneNumberId === 'string' ? req.body.phoneNumberId.trim() : '';
    const accessToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
    if (!phoneNumberId || !accessToken) {
      return res.status(400).json({ error: 'Phone number ID and access token are required.' });
    }
    if (!/^\d+$/.test(phoneNumberId)) {
      return res.status(400).json({ error: 'Phone number ID should be numeric.' });
    }

    try {
      const waRes = await fetch(
        `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const body = (await waRes.json()) as {
        display_phone_number?: string;
        verified_name?: string;
        error?: { message?: string };
      };
      if (!waRes.ok) {
        return res.status(400).json({ error: body.error?.message ?? 'WhatsApp rejected those credentials.' });
      }
      const handle = body.display_phone_number ?? body.verified_name ?? 'WhatsApp number';
      res.json(await upsertConnection('whatsapp', handle, accessToken, undefined, phoneNumberId));
    } catch (err) {
      console.error('WhatsApp connect failed:', err);
      res.status(502).json({ error: 'Could not reach WhatsApp.' });
    }
  });
}

export function registerOAuthRoutes(app: Express) {
  const providers = buildProviderConfigs();
  const appBase = process.env.APP_BASE_URL ?? 'http://localhost:5173';

  app.get('/auth/:provider/start', (req, res) => {
    const provider = req.params.provider as OAuthProvider;
    const config = providers[provider];
    if (!config) return res.status(404).send('Unknown provider');
    const credentialNames = PROVIDER_CREDENTIAL_NAMES[provider];
    const missingCredentials = [
      !config.clientId ? credentialNames.clientId : undefined,
      !config.clientSecret ? credentialNames.clientSecret : undefined,
    ].filter((name): name is string => Boolean(name));
    if (missingCredentials.length > 0) {
      return res
        .status(400)
        .send(
          `${provider} isn't configured on this server — add ${missingCredentials.join(' and ')} to .env.`
        );
    }

    const pkce = config.usesPkce ? createPkcePair() : undefined;
    const state = rememberState(provider, pkce?.verifier);

    const params = new URLSearchParams({
      response_type: 'code',
      redirect_uri: config.redirectUri,
      state,
    });
    if (config.scope) params.set('scope', config.scope);
    params.set(config.clientIdParam ?? 'client_id', config.clientId!);
    if (pkce) {
      params.set('code_challenge', pkce.challenge);
      params.set('code_challenge_method', 'S256');
    }
    for (const [key, value] of Object.entries(config.extraAuthorizeParams ?? {})) {
      params.set(key, value);
    }

    res.redirect(`${config.authorizeUrl}?${params.toString()}`);
  });

  app.get('/auth/:provider/callback', async (req, res) => {
    const provider = req.params.provider as OAuthProvider;
    const config = providers[provider];
    if (!config) return res.status(404).send('Unknown provider');

    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
    if (error) return res.redirect(`${appBase}/?connectError=${encodeURIComponent(error)}`);

    const pending = state ? consumeState(state) : undefined;
    if (!code || !pending || pending.provider !== provider) {
      return res.redirect(`${appBase}/?connectError=invalid_state`);
    }

    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
      });
      if (config.tokenClientIdParam !== null) {
        body.set(config.tokenClientIdParam ?? config.clientIdParam ?? 'client_id', config.clientId!);
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };

      if (pending.codeVerifier) {
        body.set('code_verifier', pending.codeVerifier);
      }
      if (config.tokenAuthStyle === 'basic' || pending.codeVerifier) {
        if (config.clientSecret) {
          headers.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;
        }
      } else if (config.clientSecret) {
        body.set('client_secret', config.clientSecret);
      }

      const tokenRes = await fetch(config.tokenUrl, { method: 'POST', headers, body });
      if (!tokenRes.ok) {
        throw new Error(`Token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
      }
      const tokenBody = (await tokenRes.json()) as {
        access_token?: string;
        refresh_token?: string;
        data?: { access_token?: string; refresh_token?: string };
        error?: { message?: string };
      };
      const tokenData = config.tokenResponseData ? tokenBody.data : tokenBody;
      const accessToken = tokenData?.access_token;
      if (!accessToken) {
        throw new Error(tokenBody.error?.message ?? 'Token response did not include an access token.');
      }

      const handle = await config.fetchHandle(accessToken);
      await upsertConnection(provider, handle, accessToken, tokenData?.refresh_token);

      res.redirect(`${appBase}/?connected=${provider}`);
    } catch (err) {
      console.error(`OAuth callback failed for ${provider}:`, err);
      res.redirect(`${appBase}/?connectError=${encodeURIComponent(provider)}`);
    }
  });
}
