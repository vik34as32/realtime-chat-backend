import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../config/db';
import type { PublicUser } from '../types/chat.types';
import { HttpError } from '../utils/errors';
import { signToken } from '../utils/jwt';
import { hashPassword, passwordsMatch } from '../utils/password';

interface UserRow extends RowDataPacket {
  id: number | string;
  name: string;
  email: string;
  phone: string;
  profile_url: string;
  password_hash: string;
}

export interface AccountInput {
  name: string;
  email: string;
  phone: string;
  profileUrl: string;
  password: string;
}

export async function registerUser(input: AccountInput): Promise<{ token: string; user: PublicUser }> {
  const email = input.email.toLowerCase();
  const [existing] = await pool.query<UserRow[]>(
    'SELECT id FROM users WHERE email = ? OR phone = ? LIMIT 1',
    [email, input.phone],
  );

  if (existing.length > 0) {
    throw new HttpError(400, 'An account with this email or phone already exists');
  }

  let result: ResultSetHeader;
  try {
    const [insertResult] = await pool.query<ResultSetHeader>(
      `INSERT INTO users (name, email, phone, profile_url, password_hash)
       VALUES (?, ?, ?, ?, ?)`,
      [input.name, email, input.phone, input.profileUrl, hashPassword(input.password)],
    );
    result = insertResult;
  } catch (error) {
    if (isDuplicateAccount(error)) {
      throw new HttpError(400, 'An account with this email or phone already exists');
    }
    throw error;
  }

  return {
    token: signToken(result.insertId),
    user: {
      id: result.insertId,
      name: input.name,
      email,
      phone: input.phone,
      profileUrl: input.profileUrl,
    },
  };
}

export async function loginUser(
  email: string,
  password: string,
): Promise<{ token: string; user: PublicUser }> {
  const [rows] = await pool.query<UserRow[]>(
    `SELECT id, name, email, phone, profile_url, password_hash
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [email.toLowerCase()],
  );

  const row = rows[0];
  if (!row || !passwordsMatch(password, row.password_hash)) {
    throw new HttpError(401, 'Email or password is incorrect');
  }

  return {
    token: signToken(toPublicUser(row).id),
    user: toPublicUser(row),
  };
}

export async function findUserById(userId: number): Promise<PublicUser | null> {
  const [rows] = await pool.query<UserRow[]>(
    `SELECT id, name, email, phone, profile_url
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [userId],
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return toPublicUser(row);
}

function isDuplicateAccount(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY';
}

function toPublicUser(row: UserRow): PublicUser {
  const id = typeof row.id === 'number' ? row.id : Number(row.id);
  return {
    id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    profileUrl: row.profile_url,
  };
}
