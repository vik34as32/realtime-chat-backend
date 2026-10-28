import { Router } from 'express';
import { listChats, login, register } from '../controllers/user.controller';

export const userRouter = Router();

userRouter.post('/user/register', register);
userRouter.post('/user/login', login);
userRouter.get('/user/chats', listChats);
