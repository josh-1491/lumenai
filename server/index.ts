import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { TOOLS, executeTool } from './tools.js';
import { listReminders, listEvents, listDrafts, listConnections, listSocialDrafts, removeConnection } from './store.js';
import { registerOAuthRoutes, registerCredentialRoutes, getProviderStatus } from './oauth.js';

const app = express();
app.use(cors());
// Raised from the default 100kb to fit base64-encoded image/PDF attachments.
app.use(express.json({ limit: '25mb' }));

registerOAuthRoutes(app);
registerCredentialRoutes(app);

// resolves ANTHROPIC_API_KEY from the environment. Some API keys aren't scoped
// to a workspace and require an explicit anthropic-workspace-id header on every
// request — set ANTHROPIC_WORKSPACE_ID if the key errors with
// "This API key is not scoped to a workspace".
const client = new Anthropic({
  defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
    ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID }
    : undefined,
});

const SYSTEM_PROMPT =
  'You are Lumen, a helpful, concise AI assistant embedded in a chat web app. ' +
  'Format answers with Markdown when it helps readability (code blocks, lists). ' +
  'Users can attach images, PDFs, and text files to their messages — read them carefully before responding. ' +
  'You can also create reminders, schedule events, draft emails, and draft social media posts for a ' +
  'connected platform on the user\'s behalf using the provided tools — use them whenever the user asks for ' +
  'one of those things, rather than just describing what you would do. Today\'s date and time, for ' +
  'resolving relative dates like "tomorrow", is ' +
  new Date().toString() +
  '. draft_email and draft_social_post only save a draft for the user to review — neither one sends or ' +
  'publishes anything. Check list_connections before drafting a social post so you only draft for a ' +
  "platform the user has actually connected.";

type ChatMessage = Anthropic.MessageParam;
const MAX_TOOL_TURNS = 8;

app.post('/api/chat', async (req, res) => {
  const { messages: rawMessages } = req.body as { messages?: ChatMessage[] };
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return res.status(400).json({ error: 'messages[] is required.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const messages: ChatMessage[] = rawMessages.map((m) => ({ role: m.role, content: m.content }));

  try {
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const stream = client.messages.stream({
        model: 'claude-opus-5',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        thinking: { type: 'adaptive' },
        tools: TOOLS,
        messages,
      });

      stream.on('text', (delta) => {
        send('delta', { text: delta });
      });

      const message = await stream.finalMessage();

      if (message.stop_reason === 'refusal') {
        send('error', { message: 'The assistant declined to respond to that request.' });
        return;
      }

      // Server-side tool hit an internal iteration limit — not one of ours;
      // re-send the assistant's partial turn to let it continue.
      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }

      const toolUseBlocks = message.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0) {
        send('done', { stopReason: message.stop_reason });
        return;
      }

      // A tool input cut off at max_tokens can still parse as valid JSON —
      // never run a tool on input we know is truncated.
      if (message.stop_reason === 'max_tokens') {
        send('error', { message: 'Response was cut off while using a tool — please try again.' });
        return;
      }

      messages.push({ role: 'assistant', content: message.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        try {
          const result = await executeTool(block.name, block.input);
          send('tool', { name: block.name, input: block.input, result });
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
        } catch (toolError) {
          const errMsg = toolError instanceof Error ? toolError.message : 'Tool failed';
          send('tool', { name: block.name, input: block.input, error: errMsg });
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: errMsg });
        }
      }

      messages.push({ role: 'user', content: toolResults });
    }

    send('error', { message: 'Stopped after too many tool-use steps in a row.' });
  } catch (error) {
    const message =
      error instanceof Anthropic.AuthenticationError
        ? 'Server is missing a valid ANTHROPIC_API_KEY.'
        : error instanceof Anthropic.RateLimitError
          ? 'Rate limited — please try again in a moment.'
          : error instanceof Anthropic.APIError
            ? `API error: ${error.message}`
            : error instanceof Error
              ? error.message
              : 'Unknown error';
    send('error', { message });
  } finally {
    res.end();
  }
});

app.get('/api/reminders', async (_req, res) => {
  res.json(await listReminders());
});

app.get('/api/events', async (_req, res) => {
  res.json(await listEvents());
});

app.get('/api/drafts', async (_req, res) => {
  res.json(await listDrafts());
});

app.get('/api/social-drafts', async (_req, res) => {
  res.json(await listSocialDrafts());
});

app.get('/api/connections', async (_req, res) => {
  res.json(await listConnections());
});

app.get('/api/social-providers', (_req, res) => {
  res.json(getProviderStatus());
});

app.delete('/api/connections/:id', async (req, res) => {
  const ok = await removeConnection(req.params.id);
  if (!ok) return res.status(404).json({ error: 'No connection found with that id.' });
  res.json({ ok: true });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', hasApiKey: !!process.env.ANTHROPIC_API_KEY });
});

const port = process.env.PORT ? Number(process.env.PORT) : 8787;
app.listen(port, () => {
  console.log(`Lumen AI backend listening on http://localhost:${port}`);
});
