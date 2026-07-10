/**
 * Select com busca e múltipla seleção (checkboxes).
 * options: [{ cod, nome }]. value: array de cod. onChange(arrayDeCod).
 */
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';

export function MultiSelect({ label, options = [], value = [], onChange, placeholder = 'Todos' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const selected = new Set(value);
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? options.filter(o => (`${o.cod} ${o.nome || ''}`).toLowerCase().includes(needle))
    : options;

  function toggle(cod) {
    const next = new Set(selected);
    if (next.has(cod)) next.delete(cod); else next.add(cod);
    onChange([...next]);
  }

  const resumo = value.length === 0
    ? placeholder
    : value.length === 1
      ? (options.find(o => o.cod === value[0])?.nome || value[0])
      : `${value.length} selecionados`;

  return (
    <div className="block" ref={ref}>
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      <div className="relative">
        <button type="button" onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-left focus:outline-none focus:ring-2 focus:ring-sky-200">
          <span className={(value.length ? 'text-slate-800' : 'text-slate-400') + ' truncate'}>{resumo}</span>
          <span className="flex items-center gap-1 shrink-0">
            {value.length > 0 && (
              <X size={14} className="text-slate-400 hover:text-slate-700"
                 onClick={(e) => { e.stopPropagation(); onChange([]); }} />
            )}
            <ChevronDown size={16} className="text-slate-400" />
          </span>
        </button>

        {open && (
          <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
            <div className="p-2 border-b border-slate-100">
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar..."
                className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-200" />
            </div>
            <div className="max-h-60 overflow-y-auto py-1">
              {filtered.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">Nada encontrado</p>}
              {filtered.map(o => {
                const on = selected.has(o.cod);
                return (
                  <button key={o.cod} type="button" onClick={() => toggle(o.cod)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-slate-50">
                    <span className={'flex h-4 w-4 items-center justify-center rounded border shrink-0 ' +
                      (on ? 'bg-sky-600 border-sky-600 text-white' : 'border-slate-300')}>
                      {on && <Check size={12} />}
                    </span>
                    <span className="truncate">
                      <span className="font-mono text-xs text-slate-500 mr-1">{o.cod}</span>{o.nome}
                    </span>
                  </button>
                );
              })}
            </div>
            {value.length > 0 && (
              <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 text-xs">
                <span className="text-slate-500">{value.length} selecionado(s)</span>
                <button type="button" onClick={() => onChange([])} className="text-sky-700 hover:underline">Limpar</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
