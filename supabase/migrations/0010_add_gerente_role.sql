-- =====================================================================
-- Adiciona o papel 'gerente' ao enum papel_usuario.
--
-- Contexto (2026-05-18):
--   Para o agente metas, o WhatsApp deve ir para:
--     - diretor / supervisor : top 3 filiais em risco da rede inteira
--     - gerente              : a filial dele (somente quando em risco)
--
--   Antes deste enum, 'gerente' não existia. O backend já trata o gerente
--   como "não global" (cai no caminho de filtro por users.loja, igual ao
--   comprador), então não precisa de mudança de código no userFiliais.
--
--   `alter type ... add value` precisa rodar FORA de transação, por isso
--   essa migration fica em arquivo separado (igual fizemos no 0005).
-- =====================================================================

alter type papel_usuario add value if not exists 'gerente';
