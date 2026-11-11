import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { Attachment } from '../types';

type Props = {
  onSend: (text: string, attachments: Attachment[]) => void;
  disabled: boolean;
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const TEXT_EXTENSIONS = /\.(txt|md|csv|json|ts|tsx|js|jsx|py|java|c|cpp|h|hpp|css|html|yml|yaml|sh|rb|go|rs)$/i;

function readFileAsAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf';
    const isText = !isImage && !isPdf && (file.type.startsWith('text/') || TEXT_EXTENSIONS.test(file.name));

    if (!isImage && !isPdf && !isText) {
      reject(new Error(`${file.name}: unsupported file type.`));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Couldn't read ${file.name}.`));

    if (isText) {
      reader.onload = () => {
        resolve({
          id: crypto.randomUUID(),
          name: file.name,
          mediaType: 'text/plain',
          kind: 'text',
          data: reader.result as string,
        });
      };
      reader.readAsText(file);
    } else {
      reader.onload = () => {
        const result = reader.result as string;
        const data = result.slice(result.indexOf(',') + 1);
        resolve({
          id: crypto.randomUUID(),
          name: file.name,
          mediaType: file.type,
          kind: isImage ? 'image' : 'pdf',
          data,
        });
      };
      reader.readAsDataURL(file);
    }
  });
}

export function ChatInput({ onSend, disabled }: Props) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function submit() {
    const trimmed = value.trim();
    if ((!trimmed && attachments.length === 0) || disabled) return;
    onSend(trimmed, attachments);
    setValue('');
    setAttachments([]);
    setError(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  async function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        setError(`${file.name} is over the 10MB attachment limit.`);
        continue;
      }
      try {
        const attachment = await readFileAsAttachment(file);
        setError(null);
        setAttachments((prev) => [...prev, attachment]);
      } catch (err) {
        setError(err instanceof Error ? err.message : `Couldn't read ${file.name}.`);
      }
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="chat-input-bar">
      {attachments.length > 0 && (
        <div className="attachment-tray">
          {attachments.map((a) => (
            <div key={a.id} className="attachment-chip">
              {a.kind === 'image' ? (
                <img
                  src={`data:${a.mediaType};base64,${a.data}`}
                  alt={a.name}
                  className="attachment-thumb"
                />
              ) : (
                <span className="attachment-file-icon" aria-hidden="true">
                  {a.kind === 'pdf' ? '📄' : '📝'}
                </span>
              )}
              <span className="attachment-name">{a.name}</span>
              <button
                type="button"
                className="attachment-remove"
                onClick={() => removeAttachment(a.id)}
                aria-label={`Remove ${a.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <p className="attachment-error">{error}</p>}
      <div className="chat-input-shell">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={handleFiles}
          accept="image/*,application/pdf,text/*,.md,.ts,.tsx,.js,.jsx,.py,.json,.csv,.yml,.yaml"
        />
        <button
          type="button"
          className="attach-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          aria-label="Attach files"
        >
          +
        </button>
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder="Message Lumen…"
          rows={1}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            autoGrow();
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        <button
          type="button"
          className="send-btn"
          onClick={submit}
          disabled={disabled || (!value.trim() && attachments.length === 0)}
          aria-label="Send message"
        >
          ↑
        </button>
      </div>
      <p className="input-hint">Lumen can make mistakes. Check important info.</p>
    </div>
  );
}
