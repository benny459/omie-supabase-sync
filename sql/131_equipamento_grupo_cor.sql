-- 131 · Cor dos grupos de equipamento (08/10/26, spec B.2 "versão 3")
--
-- A lista de materiais mostra os equipamentos como chips coloridos; a mesma cor aparece na
-- borda esquerda das linhas e no cabeçalho do grupo. A cor é estável: paleta de 8, pela ordem
-- de criação no cadastro (platform.equipamento_grupo.id). Grupo que não está no cadastro (nome
-- livre) usa a paleta pela ordem dos grupos no projeto — a tela funciona sem esta migração.
--
-- NÃO APLICADA — aplicar só depois do "aprovado" do Benny (preview em localhost).

alter table platform.equipamento_grupo add column if not exists cor text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'equipamento_grupo_cor_chk') then
    alter table platform.equipamento_grupo
      add constraint equipamento_grupo_cor_chk check (cor is null or cor ~ '^#[0-9a-fA-F]{6}$');
  end if;
end $$;

-- mesma paleta de web/components/projeto/MateriaisGrade.tsx (CORES_GRUPO)
with paleta as (
  select array['#6ea8ff','#3ddc97','#f5b547','#b48cff','#ff8fa3','#5fd4e8','#ffb36e','#9ad36e'] as c
), ordem as (
  select id, row_number() over (order by id) - 1 as n from platform.equipamento_grupo
)
update platform.equipamento_grupo g
   set cor = (select c[(o.n % 8) + 1] from paleta)
  from ordem o
 where o.id = g.id and g.cor is null;

-- grupo novo no cadastro ganha a próxima cor da paleta
create or replace function platform._equipamento_grupo_cor() returns trigger
language plpgsql as $$
declare paleta text[] := array['#6ea8ff','#3ddc97','#f5b547','#b48cff','#ff8fa3','#5fd4e8','#ffb36e','#9ad36e'];
        n bigint;
begin
  if new.cor is null then
    select count(*) into n from platform.equipamento_grupo;
    new.cor := paleta[(n % 8) + 1];
  end if;
  return new;
end $$;
drop trigger if exists equipamento_grupo_cor on platform.equipamento_grupo;
create trigger equipamento_grupo_cor before insert on platform.equipamento_grupo
  for each row execute function platform._equipamento_grupo_cor();

comment on column platform.equipamento_grupo.cor is
  'Cor do grupo na lista de materiais (chip, borda da linha e cabeçalho do grupo). Paleta de 8 por ordem de criação.';

notify pgrst, 'reload schema';
