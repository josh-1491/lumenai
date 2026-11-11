export type Role = 'user' | 'assistant';

export type Attachment = {
  id: string;
  name: string;
  mediaType: string;
  // 'image' | 'pdf': `data` is base64. 'text': `data` is raw decoded text.
  kind: 'image' | 'pdf' | 'text';
  data: string;
};

export type ToolCall = {
  id: string;
  name: string;
  summary: string;
  error?: string;
};

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  attachments?: Attachment[];
  toolCalls?: ToolCall[];
  pending?: boolean;
};

export type Reminder = { id: string; title: string; due_at: string; notes?: string };
export type ScheduledEvent = { id: string; title: string; start_at: string; end_at?: string; notes?: string };
export type EmailDraft = { id: string; to: string; subject: string; body: string };

export type SocialProvider = 'x' | 'linkedin' | 'facebook' | 'instagram' | 'tiktok' | 'youtube';
export type ConnectionProvider = SocialProvider | 'gmail' | 'yahoo' | 'telegram' | 'whatsapp';
export type SocialConnection = { id: string; provider: ConnectionProvider; handle: string; connected_at: string };
export type SocialPostDraft = { id: string; provider: SocialProvider; content: string };

export type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
};
