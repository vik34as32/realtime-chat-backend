import type { NextFunction, Request, Response } from 'express';
import * as chatService from '../services/chat.service';
import { loginUser, registerUser } from '../services/user.service';
import type { ChatSummary, PublicUser, SuccessResponse } from '../types/chat.types';
import { getLoggedInUser } from '../utils/auth';
import { HttpError } from '../utils/errors';
import { readJsonObject, requiredText } from '../utils/validate';

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = readJsonObject(req.body);
    const profileValue = body.profileUrl ?? body.profile_url ?? '';
    if (typeof profileValue !== 'string') {
      throw new HttpError(400, 'profileUrl must be a string');
    }

    const account = await registerUser({
      name: requiredText(body.name, 'name'),
      email: requiredText(body.email, 'email'),
      phone: requiredText(body.phone, 'phone'),
      profileUrl: profileValue.trim(),
      password: requiredText(body.password, 'password'),
    });

    const response: SuccessResponse<{ token: string; user: PublicUser }> = {
      success: true,
      data: account,
    };
    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = readJsonObject(req.body);
    const account = await loginUser(
      requiredText(body.email, 'email'),
      requiredText(body.password, 'password'),
    );
    const response: SuccessResponse<{ token: string; user: PublicUser }> = {
      success: true,
      data: account,
    };
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

export async function listChats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const me = await getLoggedInUser(req);
    const chats = await chatService.listUserChats(me.id);
    const response: SuccessResponse<{ chats: ChatSummary[] }> = {
      success: true,
      data: { chats },
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}
