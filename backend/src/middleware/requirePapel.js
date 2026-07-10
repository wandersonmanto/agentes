/**
 * Middleware: exige um ou mais papéis no usuário autenticado.
 * Uso: requirePapel('diretor', 'admin')
 */
export function requirePapel(...papeis) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
    if (!papeis.includes(req.user.papel)) {
      return res.status(403).json({ error: 'Permissão insuficiente' });
    }
    next();
  };
}
