import type { ChatMessage } from '../types';

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`message-row${isUser ? ' is-user' : ''}`}>
      {!isUser && <span className="avatar avatar-assistant" aria-hidden="true" />}
      <div className={`bubble${isUser ? ' bubble-user' : ' bubble-assistant'}`}>
        {message.attachments && message.attachments.length > 0 && (
          <div className="message-attachments">
            {message.attachments.map((a) =>
              a.kind === 'image' ? (
                <img
                  key={a.id}
                  src={`data:${a.mediaType};base64,${a.data}`}
                  alt={a.name}
                  className="message-attachment-thumb"
                />
              ) : (
                <span key={a.id} className="message-attachment-file">
                  <span aria-hidden="true">{a.kind === 'pdf' ? '📄' : '📝'}</span>
                  {a.name}
                </span>
              )
            )}
          </div>
        )}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="tool-calls">
            {message.toolCalls.map((t) => (
              <span key={t.id} className={`tool-call-chip${t.error ? ' is-error' : ''}`}>
                {t.error ? `⚠️ ${t.name} failed: ${t.error}` : `✓ ${t.summary}`}
              </span>
            ))}
          </div>
        )}
        {message.content || (message.pending ? <span className="typing-dots" aria-label="Thinking">●●●</span> : '')}
      </div>
      {isUser && <span className="avatar avatar-user" aria-hidden="true" />}
    </div>
  );
}
