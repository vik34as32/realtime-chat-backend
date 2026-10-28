import fs from 'fs';
import path from 'path';
import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

interface ServiceAccountJson {
  project_id: string;
  client_email: string;
  private_key: string;
}

function isServiceAccountJson(value: unknown): value is ServiceAccountJson {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.project_id === 'string' &&
    record.project_id.length > 0 &&
    typeof record.client_email === 'string' &&
    record.client_email.length > 0 &&
    typeof record.private_key === 'string' &&
    record.private_key.length > 0
  );
}

function loadServiceAccount(filePath: string): ServiceAccount {
  const absolutePath = path.resolve(filePath);
  let fileContents: string;

  try {
    fileContents = fs.readFileSync(absolutePath, 'utf8');
  } catch {
    throw new Error(
      'Firebase service account file could not be read. Check FIREBASE_SERVICE_ACCOUNT_PATH.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContents);
  } catch {
    throw new Error('Firebase service account file contains invalid JSON.');
  }

  if (!isServiceAccountJson(parsed)) {
    throw new Error(
      'Firebase service account file must include project_id, client_email, and private_key.',
    );
  }

  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
  };
}

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (serviceAccountPath === undefined || serviceAccountPath.trim() === '') {
  throw new Error('Missing required environment variable: FIREBASE_SERVICE_ACCOUNT_PATH');
}

const serviceAccount = loadServiceAccount(serviceAccountPath);

if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

export const firestore = getFirestore();
