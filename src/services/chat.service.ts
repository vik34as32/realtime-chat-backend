import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  FieldPath,
  FieldValue,
  Timestamp,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { pool } from '../config/db';
import { firestore } from '../config/firebase';
import type {
  ChatMessage,
  ChatSummary,
  CreateChatResult,
  LastSeenResult,
  MessageDirection,
  MessagePage,
  ReadReceiptResult,
} from '../types/chat.types';
import { HttpError } from '../utils/errors';

const LOCK_ATTEMPTS = 3;

interface IdRow extends RowDataPacket {
  id: number | string;
}

interface ChatListRow extends RowDataPacket {
  chatId: number | string;
  createdAt: Date | string;
  updatedAt: Date | string;
  memberIds: string | null;
}

export async function createOrGetChat(userAId: number, userBId: number): Promise<CreateChatResult> {
  if (userAId === userBId) {
    throw new HttpError(400, 'A user cannot create a chat with themselves');
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= LOCK_ATTEMPTS; attempt += 1) {
    try {
      return await createOrGetChatOnce(userAId, userBId);
    } catch (error) {
      if (!isLockError(error) || attempt === LOCK_ATTEMPTS) {
        throw error;
      }

      lastError = error;
      await delay(50);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to create chat');
}

export async function sendMessage(
  chatId: number,
  senderId: number,
  text: string,
): Promise<ChatMessage> {
  await assertChatMember(chatId, senderId);

  const messageRef = await messageCollection(chatId).add({
    senderId,
    text,
    createdAt: FieldValue.serverTimestamp(),
    readBy: [senderId],
  });

  try {
    await touchChat(chatId);
  } catch (error) {
    console.error('Message was saved, but the chat timestamp could not be updated');
    console.error(error);
  }

  const saved = await messageRef.get();
  if (!saved.exists) {
    throw new Error('Message was written but could not be read back');
  }

  return mapMessage(saved);
}

// Without a cursor, return the latest page. The page is still ordered oldest first.
// direction is used only when a cursor is present.
export async function getMessages(
  chatId: number,
  userId: number,
  limit: number,
  cursor: string | undefined,
  direction: MessageDirection,
): Promise<MessagePage> {
  await assertChatMember(chatId, userId);

  const messages = messageCollection(chatId);
  const pageSize = limit + 1;

  if (cursor === undefined) {
    const snapshot = await messages
      .orderBy('createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc')
      .limit(pageSize)
      .get();

    return mapPage(snapshot.docs, limit, true);
  }

  const decoded = decodeCursor(cursor);
  const cursorTimestamp = timestampFromCursor(decoded.createdAtMillis);

  if (direction === 'before') {
    const snapshot = await messages
      .orderBy('createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc')
      .startAfter(cursorTimestamp, decoded.messageId)
      .limit(pageSize)
      .get();

    return mapPage(snapshot.docs, limit, true);
  }

  const snapshot = await messages
    .orderBy('createdAt', 'asc')
    .orderBy(FieldPath.documentId(), 'asc')
    .startAfter(cursorTimestamp, decoded.messageId)
    .limit(pageSize)
    .get();

  return mapPage(snapshot.docs, limit, false);
}

export async function markMessageRead(
  chatId: number,
  messageId: string,
  userId: number,
): Promise<ReadReceiptResult> {
  await assertChatMember(chatId, userId);

  const messageRef = messageCollection(chatId).doc(messageId);
  const receiptRef = messageRef.collection('readReceipts').doc(String(userId));
  const messageSnap = await messageRef.get();

  if (!messageSnap.exists) {
    throw new HttpError(404, 'Message not found');
  }

  const currentReadBy = toNumberArray(messageSnap.get('readBy'));

  if (!currentReadBy.includes(userId)) {
    const batch = firestore.batch();
    batch.update(messageRef, {
      readBy: FieldValue.arrayUnion(userId),
    });
    batch.set(receiptRef, {
      userId,
      messageId,
      readAt: FieldValue.serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (error) {
      if (isFirestoreNotFound(error)) {
        throw new HttpError(404, 'Message not found');
      }
      throw error;
    }
  } else {
    const existingReceipt = await receiptRef.get();
    if (!existingReceipt.exists) {
      await receiptRef.set({
        userId,
        messageId,
        readAt: FieldValue.serverTimestamp(),
      });
    }
  }

  const [updatedMessage, receiptSnap] = await Promise.all([messageRef.get(), receiptRef.get()]);
  if (!updatedMessage.exists) {
    throw new HttpError(404, 'Message not found');
  }

  return {
    messageId,
    userId,
    readBy: toNumberArray(updatedMessage.get('readBy')),
    readAt: timestampToIso(receiptSnap.get('readAt')),
  };
}

export async function updateLastSeen(
  chatId: number,
  userId: number,
  messageId: string,
): Promise<LastSeenResult> {
  await assertChatMember(chatId, userId);

  const messageRef = messageCollection(chatId).doc(messageId);
  const lastSeenRef = firestore
    .collection('chats')
    .doc(String(chatId))
    .collection('lastSeen')
    .doc(String(userId));

  await firestore.runTransaction(async (transaction) => {
    const messageSnap = await transaction.get(messageRef);
    if (!messageSnap.exists) {
      throw new HttpError(404, 'Message not found');
    }

    const nextMillis = timestampMillis(messageSnap.get('createdAt'));
    if (nextMillis === null) {
      throw new HttpError(400, 'Message has no timestamp, so last seen cannot be updated safely');
    }

    const lastSeenSnap = await transaction.get(lastSeenRef);
    if (!lastSeenSnap.exists) {
      transaction.set(lastSeenRef, {
        userId,
        lastSeenMessageId: messageId,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    const currentMessageId = lastSeenSnap.get('lastSeenMessageId');
    if (currentMessageId === messageId) {
      return;
    }

    if (typeof currentMessageId === 'string' && currentMessageId !== '' && !currentMessageId.includes('/')) {
      const currentSnap = await transaction.get(messageCollection(chatId).doc(currentMessageId));
      if (currentSnap.exists) {
        const currentMillis = timestampMillis(currentSnap.get('createdAt'));
        if (currentMillis === null) {
          throw new HttpError(
            400,
            'Current last seen message has no timestamp, so last seen cannot be moved safely',
          );
        }

        const movedBackByTime = nextMillis < currentMillis;
        const sameTimeButOlderId = nextMillis === currentMillis && messageId < currentMessageId;
        if (movedBackByTime || sameTimeButOlderId) {
          throw new HttpError(400, 'Cannot move last seen backwards');
        }
      }
    }

    transaction.set(lastSeenRef, {
      userId,
      lastSeenMessageId: messageId,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  const saved = await lastSeenRef.get();
  if (!saved.exists) {
    throw new Error('Last seen was written but could not be read back');
  }

  const storedMessageId = saved.get('lastSeenMessageId');

  return {
    userId,
    lastSeenMessageId: typeof storedMessageId === 'string' ? storedMessageId : messageId,
    updatedAt: timestampToIso(saved.get('updatedAt')),
  };
}

export async function listUserChats(userId: number): Promise<ChatSummary[]> {
  const [userRows] = await pool.query<IdRow[]>('SELECT id FROM users WHERE id = ? LIMIT 1', [userId]);

  if (userRows.length === 0) {
    throw new HttpError(404, 'User not found');
  }

  const [rows] = await pool.query<ChatListRow[]>(
    `SELECT c.id AS chatId,
            c.created_at AS createdAt,
            c.updated_at AS updatedAt,
            GROUP_CONCAT(m.user_id ORDER BY m.user_id SEPARATOR ',') AS memberIds
     FROM chat_members mine
     INNER JOIN chats c ON c.id = mine.chat_id
     INNER JOIN chat_members m ON m.chat_id = c.id
     WHERE mine.user_id = ?
     GROUP BY c.id, c.created_at, c.updated_at
     ORDER BY c.updated_at DESC, c.id DESC`,
    [userId],
  );

  return rows.map((row) => ({
    chatId: asDatabaseId(row.chatId),
    memberIds: parseMemberIds(row.memberIds),
    createdAt: toIsoDate(row.createdAt),
    updatedAt: toIsoDate(row.updatedAt),
  }));
}

async function createOrGetChatOnce(userAId: number, userBId: number): Promise<CreateChatResult> {
  const lowId = Math.min(userAId, userBId);
  const highId = Math.max(userAId, userBId);
  const pairKey = `${lowId}:${highId}`;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Lock both users in id order so two concurrent requests cannot both insert.
    const [userRows] = await connection.query<IdRow[]>(
      'SELECT id FROM users WHERE id IN (?, ?) ORDER BY id FOR UPDATE',
      [lowId, highId],
    );

    if (userRows.length !== 2) {
      throw new HttpError(404, 'One or both users were not found');
    }

    const [chatRows] = await connection.query<IdRow[]>(
      'SELECT id FROM chats WHERE pair_key = ? LIMIT 1 FOR UPDATE',
      [pairKey],
    );

    const existingChat = chatRows[0];
    if (existingChat !== undefined) {
      await connection.commit();
      return { chatId: asDatabaseId(existingChat.id), created: false };
    }

    const [insertResult] = await connection.query<ResultSetHeader>(
      'INSERT INTO chats (pair_key) VALUES (?)',
      [pairKey],
    );

    const chatId = asDatabaseId(insertResult.insertId);

    await connection.query(
      'INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?), (?, ?)',
      [chatId, lowId, chatId, highId],
    );

    await connection.commit();
    return { chatId, created: true };
  } catch (error) {
    await safeRollback(connection);

    if (isDuplicateKeyError(error)) {
      const existingChatId = await findChatIdByPairKey(pairKey);
      if (existingChatId !== null) {
        return { chatId: existingChatId, created: false };
      }
    }

    throw error;
  } finally {
    connection.release();
  }
}

async function findChatIdByPairKey(pairKey: string): Promise<number | null> {
  const [rows] = await pool.query<IdRow[]>('SELECT id FROM chats WHERE pair_key = ? LIMIT 1', [pairKey]);
  const row = rows[0];
  if (row === undefined) {
    return null;
  }

  return asDatabaseId(row.id);
}

async function assertChatMember(chatId: number, userId: number): Promise<void> {
  const [memberRows] = await pool.query<IdRow[]>(
    'SELECT user_id AS id FROM chat_members WHERE chat_id = ? AND user_id = ? LIMIT 1',
    [chatId, userId],
  );

  if (memberRows.length > 0) {
    return;
  }

  const [chatRows] = await pool.query<IdRow[]>('SELECT id FROM chats WHERE id = ? LIMIT 1', [chatId]);
  if (chatRows.length === 0) {
    throw new HttpError(404, 'Chat not found');
  }

  const [userRows] = await pool.query<IdRow[]>('SELECT id FROM users WHERE id = ? LIMIT 1', [userId]);
  if (userRows.length === 0) {
    throw new HttpError(404, 'User not found');
  }

  throw new HttpError(403, 'You do not have access to this chat');
}

async function touchChat(chatId: number): Promise<void> {
  await pool.query('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [chatId]);
}

function messageCollection(chatId: number) {
  return firestore.collection('chats').doc(String(chatId)).collection('messages');
}

function mapPage(docs: QueryDocumentSnapshot[], limit: number, newestFirst: boolean): MessagePage {
  const hasMore = docs.length > limit;
  const pageDocs = hasMore ? docs.slice(0, limit) : docs.slice();

  // Firestore returned this page newest first. Reverse it so the client sees oldest first.
  if (newestFirst) {
    pageDocs.reverse();
  }

  const oldest = pageDocs[0];
  const newest = pageDocs[pageDocs.length - 1];

  return {
    messages: pageDocs.map((doc) => mapMessage(doc)),
    pagination: {
      limit,
      hasMore,
      olderCursor: cursorFromDoc(oldest),
      newerCursor: cursorFromDoc(newest),
    },
  };
}

function mapMessage(doc: DocumentSnapshot): ChatMessage {
  const senderId = doc.get('senderId');
  const text = doc.get('text');

  return {
    messageId: doc.id,
    senderId: typeof senderId === 'number' && Number.isSafeInteger(senderId) ? senderId : null,
    text: typeof text === 'string' ? text : '',
    createdAt: timestampToIso(doc.get('createdAt')),
    readBy: toNumberArray(doc.get('readBy')),
  };
}

function cursorFromDoc(doc: QueryDocumentSnapshot | undefined): string | null {
  if (doc === undefined) {
    return null;
  }

  const createdAtMillis = timestampMillis(doc.get('createdAt'));
  if (createdAtMillis === null) {
    return null;
  }

  return encodeCursor(createdAtMillis, doc.id);
}

function encodeCursor(createdAtMillis: number, messageId: string): string {
  return Buffer.from(JSON.stringify({ createdAtMillis, messageId }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAtMillis: number; messageId: string } {
  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid pagination cursor');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new HttpError(400, 'Invalid pagination cursor');
  }

  const record = parsed as Record<string, unknown>;
  const createdAtMillis = record.createdAtMillis;
  const messageId = record.messageId;

  if (typeof createdAtMillis !== 'number' || !Number.isSafeInteger(createdAtMillis)) {
    throw new HttpError(400, 'Invalid pagination cursor');
  }

  if (typeof messageId !== 'string' || messageId === '' || messageId.includes('/')) {
    throw new HttpError(400, 'Invalid pagination cursor');
  }

  return { createdAtMillis, messageId };
}

function timestampFromCursor(createdAtMillis: number): Timestamp {
  try {
    return Timestamp.fromMillis(createdAtMillis);
  } catch {
    throw new HttpError(400, 'Invalid pagination cursor');
  }
}

function timestampMillis(value: unknown): number | null {
  if (value instanceof Timestamp) {
    return value.toMillis();
  }

  return null;
}

function timestampToIso(value: unknown): string | null {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  return null;
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: number[] = [];
  for (const item of value) {
    if (typeof item === 'number' && Number.isInteger(item)) {
      ids.push(item);
    }
  }

  return ids;
}

function parseMemberIds(value: string | null): number[] {
  if (value === null || value.trim() === '') {
    return [];
  }

  const ids: number[] = [];
  for (const part of value.split(',')) {
    const id = Number(part);
    if (Number.isSafeInteger(id) && id > 0) {
      ids.push(id);
    }
  }

  return ids;
}

function toIsoDate(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Database returned an invalid timestamp');
  }

  return parsed.toISOString();
}

function asDatabaseId(value: number | string): number {
  const id = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('Database returned an invalid id');
  }

  return id;
}

async function safeRollback(connection: PoolConnection): Promise<void> {
  try {
    await connection.rollback();
  } catch (rollbackError) {
    console.error('Failed to roll back MySQL transaction');
    console.error(rollbackError);
  }
}

function mysqlCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }

  return typeof error.code === 'string' ? error.code : null;
}

function isLockError(error: unknown): boolean {
  const code = mysqlCode(error);
  return code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT';
}

function isDuplicateKeyError(error: unknown): boolean {
  return mysqlCode(error) === 'ER_DUP_ENTRY';
}

function isFirestoreNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return error.code === 5 || error.code === 'not-found';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
