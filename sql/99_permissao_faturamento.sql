-- 06/10/26: Faturamento ganha permissão própria (faturamento.acesso), separada de
-- "Incluir / excluir título" do Financeiro. Concedida a Fernanda, BPO financeiro e David
-- (quem já faturava continua: admins passam sempre).
insert into platform.permissoes_catalogo (chave, modulo, rotulo, descricao, ordem)
values ('faturamento.acesso','faturamento','Abrir e emitir no Faturamento','Carteira de PV/OS, emissão de NF-e, recibo e registro de NFS-e', 10)
on conflict (chave) do nothing;
