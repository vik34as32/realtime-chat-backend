import { Router } from 'express';
import { createChat, getMessages, markRead, postMessage, updateLastSeen } from '../controllers/chat.controller';

export const chatRouter = Router();

chatRouter.post('/chat/create', createChat);
chatRouter.post('/chat/:chatId/message/send', postMessage);
chatRouter.get('/chat/:chatId/messages', getMessages);
chatRouter.post('/chat/:chatId/message/:messageId/read', markRead);
chatRouter.post('/chat/:chatId/lastseen', updateLastSeen);
