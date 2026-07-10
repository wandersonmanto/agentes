/**
 * Busca o perfil interno (papel, nome, usuario_id) do usuário logado.
 * Cacheia em memória pra não bater toda vez.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from './useAuth';

let cache = null;

export function useMe() {
  const { user } = useAuth();
  const [me, setMe] = useState(cache);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    if (!user || cache) return;
    api.get('/api/me')
      .then(r => { cache = r.data; setMe(cache); })
      .catch(err => console.error('useMe', err))
      .finally(() => setLoading(false));
  }, [user]);

  return { me, loading };
}

export function clearMeCache() { cache = null; }
