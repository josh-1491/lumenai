import { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatThread } from './components/ChatThread';
import { ChatInput } from './components/ChatInput';
import { streamChat } from './api';
import type { Attachment, Conversation } from './types';
import './App.css';

function newConversation(): Conversation {
  return { id: crypto.randomUUID(), title: 'New chat', messages: [] };
}

const PROVIDER_NAMES: Record<string, string> = {
  x: 'X',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  gmail: 'Gmail',
  yahoo: 'Yahoo Mail',
};

function App() {
  const [conversations, setConversations] = useState<Conversation[]>([newConversation()]);
  const [activeId, setActiveId] = useState(conversations[0].id);
  const [sending, setSending] = useState(false);
  const [tasksVersion, setTasksVersion] = useState(0);
  const [connectBanner, setConnectBanner] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const connectError = params.get('connectError');
    if (connected) {
      setConnectBanner(`Connected ${PROVIDER_NAMES[connected] ?? connected}.`);
      setTasksVersion((v) => v + 1);
    } else if (connectError) {
      setConnectBanner(`Couldn't connect that account (${connectError}).`);
    }
    if (connected || connectError) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const active = conversations.find((c) => c.id === activeId)!;

  function updateActive(updater: (c: Conversation) => Conversation) {
    setConversations((prev) => prev.map((c) => (c.id === activeId ? updater(c) : c)));
  }

  async function handleSend(text: string, attachments: Attachment[]) {
    const userMsg = {
      id: crypto.randomUUID(),
      role: 'user' as const,
      content: text,
      attachments: attachments.length > 0 ? attachments : undefined,
    };
    const assistantId = crypto.randomUUID();
    const title = text.trim() || (attachments[0] ? attachments[0].name : 'New chat');

    updateActive((c) => ({
      ...c,
      title: c.messages.length === 0 ? title.slice(0, 40) : c.title,
      messages: [...c.messages, userMsg, { id: assistantId, role: 'assistant', content: '', pending: true }],
    }));

    setSending(true);
    const historyForRequest = [...active.messages, userMsg];

    const result = await streamChat(
      historyForRequest,
      (delta) => {
        updateActive((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + delta, pending: false } : m
          ),
        }));
      },
      (tool) => {
        updateActive((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === assistantId
              ? { ...m, pending: false, toolCalls: [...(m.toolCalls ?? []), tool] }
              : m
          ),
        }));
        setTasksVersion((v) => v + 1);
      }
    );

    if (!result.ok) {
      updateActive((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === assistantId ? { ...m, content: `⚠️ ${result.error}`, pending: false } : m
        ),
      }));
    }
    setSending(false);
  }

  function handleNewChat() {
    const fresh = newConversation();
    setConversations((prev) => [fresh, ...prev]);
    setActiveId(fresh.id);
  }

  return (
    <div className="app-shell">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNewChat={handleNewChat}
        tasksRefreshKey={tasksVersion}
      />
      <main className="main-panel">
        {connectBanner && (
          <div className="connect-banner">
            {connectBanner}
            <button type="button" onClick={() => setConnectBanner(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
        <ChatThread messages={active.messages} />
        <ChatInput onSend={handleSend} disabled={sending} />
      </main>
    </div>
  );
}

export default App;
