/**
 * Inicialização do Firebase Admin SDK (uma única instância por processo).
 * Lê as credenciais via path para o JSON ou via base64 (env var).
 */
import fs from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { env } from '../config/env.js';

function loadServiceAccount() {
  if (env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const json = Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
    return JSON.parse(json);
  }
  if (env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    return JSON.parse(fs.readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
  }
  throw new Error('Faltam FIREBASE_SERVICE_ACCOUNT_PATH ou FIREBASE_SERVICE_ACCOUNT_BASE64');
}

if (getApps().length === 0) {
  initializeApp({ credential: cert(loadServiceAccount()) });
}

export const firestore = getFirestore();
export const firebaseAuth = getAuth();
