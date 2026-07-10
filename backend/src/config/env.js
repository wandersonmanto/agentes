/**
 * Validação e exposição das variáveis de ambiente.
 * Falha cedo se algo crítico estiver faltando.
 */
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  // API local de margem
  LOCAL_API_URL: z.string().url(),
  LOCAL_API_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  // Token compartilhado com n8n (proteger /agente/*/run)
  SYNC_TOKEN: z.string().min(16, 'SYNC_TOKEN precisa ter ao menos 16 chars'),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  // Firebase Admin
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_BASE64: z.string().optional(),

  // Cron interno (fallback caso n8n falhe). Vazio = desligado.
  SYNC_CRON: z.string().optional(),               // margem         (default: hourly)
  METAS_SYNC_CRON: z.string().optional(),         // metas          (default: diário 04:00 → '0 4 * * *')
  COMPARATIVO313_SYNC_CRON: z.string().optional(),// comparativo313 (default: diário 04:15 → '15 4 * * *')

  // Override opcional do endpoint do comparativo313
  // (default: deriva de LOCAL_API_URL trocando o path para /api/comparativo_new)
  COMPARATIVO313_API_URL: z.string().url().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Erro nas variáveis de ambiente:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const corsOrigins = env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
