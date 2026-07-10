/**
 * Rota /api/me — devolve o perfil de quem está logado.
 * Usada pelo frontend pra exibir nome, papel e habilitar UIs condicionais.
 */
import { Router } from 'express';
import { authFirebase } from '../middleware/authFirebase.js';

export const meRouter = Router();

meRouter.get('/', authFirebase, (req, res) => {
  res.json({
    usuario_id: req.user.usuario_id,
    nome: req.user.nome,
    email_login: req.user.email_login,
    papel: req.user.papel,
  });
});
