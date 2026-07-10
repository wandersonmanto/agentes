/**
 * Cliente HTTP para a API local de comparativo (ruptura por filial).
 *
 * Endpoint:  http://192.168.118.50:3001/api/comparativo_new
 * Resposta:  array de objetos (1 linha = 1 produto × filial × depósito).
 */
import axios from 'axios';
import { env } from '../../../config/env.js';

const ENDPOINT_PATH = '/api/comparativo_new';

/**
 * URL completa do endpoint. Aceita override por env
 * (`COMPARATIVO313_API_URL`), caindo em LOCAL_API_URL com o path trocado.
 */
function buildUrl() {
  if (env.COMPARATIVO313_API_URL) return env.COMPARATIVO313_API_URL;
  return env.LOCAL_API_URL.replace(/\/api\/[^/]+\/?$/, '') + ENDPOINT_PATH;
}

export async function fetchComparativo() {
  const url = buildUrl();
  const { data } = await axios.get(url, { timeout: env.LOCAL_API_TIMEOUT_MS });
  if (!Array.isArray(data)) {
    throw new Error(`API local (${url}) retornou formato inesperado — esperava array`);
  }
  return data;
}
