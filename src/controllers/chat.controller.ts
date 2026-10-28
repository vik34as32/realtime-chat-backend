import type { NextFunction, Request, Response } from 'express';
import * as chatService from '../services/chat.service';
import type {
  ChatMessage,
  LastSeenResult,
  MessagePage,
  ReadReceiptResult,
  SuccessResponse,
} from '../types/chat.types';
import { getLoggedInUser } from '../utils/auth';
import {
  parseCursor,
  parseDirection,
  parseLimit,
  parseMessageId,
  parseMessageText,
  parseRouteId,
  parseUserId,
  readJsonObject,
} from '../utils/validate';

export async function createChat(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const me = await getLoggedInUser(req);
    const body = readJsonObject(req.body);
    const otherUserId = parseUserId(body.userId, 'userId');
    const result = await chatService.createOrGetChat(me.id, otherUserId);
    const response: SuccessResponse<{ chatId: number }> = {
      success: true,
      data: { chatId: result.chatId },
    };

    res.status(result.created ? 201 : 200).json(response);
  } catch (error) {
    next(error);
  }
}

export async function postMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const me = await getLoggedInUser(req);
    const chatId = parseRouteId(req.params.chatId, 'chatId');
    const body = readJsonObject(req.body);
    const text = parseMessageText(body.text);
    const message = await chatService.sendMessage(chatId, me.id, text);
    const response: SuccessResponse<ChatMessage> = {
      success: true,
      data: message,
    };

    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
}

export async function getMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const me = await getLoggedInUser(req);
    const chatId = parseRouteId(req.params.chatId, 'chatId');
    const limit = parseLimit(req.query.limit);
    const cursor = parseCursor(req.query.cursor);
    const direction = parseDirection(req.query.direction) ?? 'before';
    const page = await chatService.getMessages(chatId, me.id, limit, cursor, direction);
    const response: SuccessResponse<MessagePage> = {
      success: true,
      data: page,
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

export async function markRead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const me = await getLoggedInUser(req);
    const chatId = parseRouteId(req.params.chatId, 'chatId');
    const messageId = parseMessageId(req.params.messageId);
    const receipt = await chatService.markMessageRead(chatId, messageId, me.id);
    const response: SuccessResponse<ReadReceiptResult> = {
      success: true,
      data: receipt,
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

export async function updateLastSeen(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const me = await getLoggedInUser(req);
    const chatId = parseRouteId(req.params.chatId, 'chatId');
    const body = readJsonObject(req.body);
    const messageId = parseMessageId(body.messageId);
    const lastSeen = await chatService.updateLastSeen(chatId, me.id, messageId);
    const response: SuccessResponse<LastSeenResult> = {
      success: true,
      data: lastSeen,
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}
