import type { Request } from 'express';
import { findUserById } from '../services/user.service';
import type { PublicUser } from '../types/chat.types';
import { HttpError } from './errors';
import { readUserId } from './jwt';

export async function getLoggedInUser(req: Request): Promise<PublicUser> {
  const header = req.header('authorization');
  if (!header) {
    throw new HttpError(401, 'Please login first');
  }

  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : header.trim();
  if (!token) {
    throw new HttpError(401, 'Please login first');
  }

  const userId = readUserId(token);
  if (userId === null) {
    throw new HttpError(401, 'Please login first');
  }

  const user = await findUserById(userId);
  if (!user) {
    throw new HttpError(401, 'Please login first');
  }

  return user;
}
