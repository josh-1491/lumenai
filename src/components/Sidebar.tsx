import { useState } from 'react';
import type { Conversation } from '../types';
import { TasksPanel } from './TasksPanel';
import { ConnectionsModal } from './ConnectionsModal';

type Props = {
  conversations: Conversation[];
  activeId: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  tasksRefreshKey: number;
};

export function Sidebar({ conversations, activeId, onSelect, onNewChat, tasksRefreshKey }: Props) {
  const [connectionsOpen, setConnectionsOpen] = useState(false);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img className="brand-mark" src="/favicon-sun.svg" alt="" />
        <span className="brand-word">Lumen</span>
      </div>

      <button type="button" className="new-chat-btn" onClick={onNewChat}>
        <span className="plus" aria-hidden="true">
          +
        </span>
        New chat
      </button>

      <nav className="conversation-list" aria-label="Conversations">
        {conversations.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`conversation-item${c.id === activeId ? ' is-active' : ''}`}
            onClick={() => onSelect(c.id)}
          >
            {c.title}
          </button>
        ))}
      </nav>

      <TasksPanel refreshKey={tasksRefreshKey} />

      <button type="button" className="connections-link" onClick={() => setConnectionsOpen(true)}>
        🔗 Connected accounts
      </button>

      {connectionsOpen && <ConnectionsModal onClose={() => setConnectionsOpen(false)} />}
    </aside>
  );
}
