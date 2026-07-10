import { useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { clearMeCache } from './useMe';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, u => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  async function login(email, password) {
    const result = await signInWithEmailAndPassword(auth, email.trim(), password);
    return result.user;
  }

  async function logout() {
    clearMeCache();
    await signOut(auth);
  }

  async function resetPassword(email) {
    return sendPasswordResetEmail(auth, email.trim());
  }

  return { user, loading, login, logout, resetPassword };
}
