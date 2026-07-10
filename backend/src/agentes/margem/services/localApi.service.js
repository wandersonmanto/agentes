/**
 * Cliente HTTP para a API local de margem.
 */
import axios from 'axios';
import { env } from '../../../config/env.js';

const client = axios.create({
  baseURL: env.LOCAL_API_URL.replace(/\/api\/margem\/?$/, ''),
  timeout: env.LOCAL_API_TIMEOUT_MS,
});

export async function fetchMargem() {
  const { data } = await axios.get(env.LOCAL_API_URL, { timeout: env.LOCAL_API_TIMEOUT_MS });
  if (!Array.isArray(data)) {
    throw new Error('API local retornou formato inesperado (esperava array)');
  }
  return data;
}

export default client;
