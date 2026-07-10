import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

const ERRO_AMIGAVEL = {
  'auth/invalid-credential':      'E-mail ou senha incorretos.',
  'auth/invalid-email':           'E-mail em formato inválido.',
  'auth/user-disabled':           'Conta desativada. Fale com o administrador.',
  'auth/user-not-found':          'Usuário não encontrado.',
  'auth/wrong-password':          'Senha incorreta.',
  'auth/too-many-requests':       'Muitas tentativas. Aguarde alguns minutos.',
  'auth/operation-not-allowed':   'Provedor desabilitado no Firebase. Avise o administrador.',
  'auth/missing-password':        'Informe a senha.',
};

export function Login() {
  const { login, resetPassword } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState('');
  const [info, setInfo]         = useState('');
  const [loading, setLoading]   = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(''); setInfo(''); setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(ERRO_AMIGAVEL[err.code] || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function onForgotPassword() {
    setError(''); setInfo('');
    if (!email) { setError('Informe o e-mail antes de pedir reset de senha.'); return; }
    try {
      await resetPassword(email);
      setInfo('Enviamos um e-mail com instruções para redefinir a senha.');
    } catch (err) {
      setError(ERRO_AMIGAVEL[err.code] || err.message);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <form
        onSubmit={onSubmit}
        className="bg-white shadow-md rounded-xl p-8 w-full max-w-sm space-y-4"
      >
        <div className="text-center">
          <h1 className="text-xl font-semibold text-slate-900">Plataforma de Agentes</h1>
          <p className="text-sm text-slate-500 mt-1">Entre com sua conta corporativa.</p>
        </div>

        <div>
          <label htmlFor="email" className="text-sm font-medium text-slate-700">E-mail</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div>
          <label htmlFor="password" className="text-sm font-medium text-slate-700">Senha</label>
          <div className="mt-1 relative">
            <input
              id="password"
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <button
              type="button"
              onClick={() => setShowPw(s => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              title={showPw ? 'Ocultar senha' : 'Mostrar senha'}
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !email || !password}
          className="w-full bg-slate-900 text-white rounded-md py-2.5 text-sm hover:bg-slate-800 disabled:opacity-60"
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>

        <button
          type="button"
          onClick={onForgotPassword}
          className="w-full text-xs text-slate-500 hover:text-slate-900"
        >
          Esqueci minha senha
        </button>

        {error && <p className="text-sm text-red-600 text-center">{error}</p>}
        {info  && <p className="text-sm text-emerald-700 text-center">{info}</p>}
      </form>
    </div>
  );
}
