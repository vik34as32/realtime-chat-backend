export interface SuccessResponse<T> {
  success: true;
  data: T;
}

export interface PublicUser {
  id: number;
  name: string;
  email: string;
  phone: string;
  profileUrl: string;
}

export interface CreateChatResult {
  chatId: number;
  created: boolean;
}

export interface ChatMessage {
  messageId: string;
  senderId: number | null;
  text: string;
  createdAt: string | null;
  readBy: number[];
}

export interface MessagePage {
  messages: ChatMessage[];
  pagination: {
    limit: number;
    hasMore: boolean;
    olderCursor: string | null;
    newerCursor: string | null;
  };
}

export interface ReadReceiptResult {
  messageId: string;
  userId: number;
  readBy: number[];
  readAt: string | null;
}

export interface LastSeenResult {
  userId: number;
  lastSeenMessageId: string;
  updatedAt: string | null;
}

export interface ChatSummary {
  chatId: number;
  memberIds: number[];
  createdAt: string;
  updatedAt: string;
}

export type MessageDirection = 'before' | 'after';
