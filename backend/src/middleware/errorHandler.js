/**
 * Handler central de erros — sempre o ÚLTIMO middleware registrado.
 */
export function errorHandler(err, req, res, _next) {
  req.log?.error({ err }, 'Unhandled error');
  const status = err.status || 500;
  res.status(status).json({
    error: err.publicMessage || 'Erro interno',
    detail: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
}
