"""Porta o mockup financeiro-fluxo-v3 para a tela /financeiro/fluxo do painel.
Gera: fluxo-fin.css (escopado em .ff1), fluxo-fin-markup.ts e fluxo-fin-motor.ts."""
import re, json

import os
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(RAIZ, "docs/mockups/financeiro-fluxo-v3-2026-10-08.html")
OUT = os.path.join(RAIZ, "components/financeiro/")
L = open(SRC, encoding="utf-8").read().split("\n")
txt = "\n".join(L)

def linhas(a, b):  # 1-based inclusive
    return "\n".join(L[a - 1:b])

# ───────────── CSS ─────────────
css = txt[txt.index("<style>") + 7:txt.index("</style>")]

def escopar(bloco):
    out, i, n = [], 0, len(bloco)
    while i < n:
        j = bloco.find("{", i)
        if j < 0:
            break
        sel = bloco[i:j].strip()
        if sel.startswith("@media"):
            # acha o fecho do @media
            prof, k = 1, j + 1
            while prof:
                if bloco[k] == "{": prof += 1
                elif bloco[k] == "}": prof -= 1
                k += 1
            inner = bloco[j + 1:k - 1]
            if "prefers-color-scheme" in sel:
                i = k; continue          # tema escuro vem dos tokens do painel
            out.append(sel + "{" + escopar(inner) + "}")
            i = k; continue
        if sel.startswith("@keyframes"):
            prof, k = 1, j + 1
            while prof:
                if bloco[k] == "{": prof += 1
                elif bloco[k] == "}": prof -= 1
                k += 1
            out.append(bloco[i:k]); i = k; continue
        k = bloco.index("}", j)
        corpo = bloco[j + 1:k]
        i = k + 1
        if sel.startswith(":root"):
            continue                       # tokens redefinidos abaixo
        novos = []
        for s in sel.split(","):
            s = s.strip()
            if not s: continue
            if s in ("body", "html", "html,body"):
                novos.append(".ff1")
            elif s == "*":
                novos.append(".ff1 *")
            else:
                novos.append(".ff1 " + s)
        out.append(",".join(novos) + "{" + corpo + "}")
    return "\n".join(out)

tokens = """/* Fluxo de Caixa do Financeiro — porte do mockup financeiro-fluxo-v3 (08/10/26).
   Escopado em .ff1; cores do tema do painel (claro/escuro e aparência por usuário). */
.ff1{
  --bg:transparent;--panel:var(--ww-panel);--panel2:var(--ww-panel-sunken);--line:var(--ww-border);--line2:var(--ww-border-strong);
  --tx:var(--ww-text);--tx2:var(--ww-text-muted);--tx3:var(--ww-text-faint);
  --cd:#f5a524;--sf:var(--ww-accent);--ww:#14b8a6;
  --in:#16a34a;--out:#dc2626;--prov:#a855f7;--amber:#f59e0b;--r:14px;
}
html.dark .ff1{--in:#22c55e;--out:#ef4444;--prov:#c084fc}
/* janelas por cima da tela sempre opacas (Benny) */
.ff1 .drawer,.ff1 .tip{background:var(--ww-panel);backdrop-filter:none;-webkit-backdrop-filter:none}
.ff1 .wrap{padding:4px 0 60px !important}
"""
corpo_css = escopar(css)
# o body do mockup pinta fundo e fonte — no painel o fundo é o da página
corpo_css = corpo_css.replace(".ff1{margin:0;background:var(--bg);", ".ff1{margin:0;background:transparent;")
open(OUT + "fluxo-fin.css", "w").write(tokens + corpo_css + "\n")

# ───────────── marcação ─────────────
ini = txt.index('<section id="v-fluxo">')
fim = txt.index("</section>", ini) + len("</section>")
secao = txt[ini:fim]
drawer = txt[txt.index("<!-- drawer de lançamentos -->"):txt.index("<!-- modal confirmar provisão -->")]
cab = """<div class="wrap">
  <div class="top">
    <div>
      <div class="k">Financeiro</div>
      <h1 id="ttl">Fluxo de Caixa</h1>
      <div class="sub" id="ffSub">Fluxo por empresa · bancos unificados · realizado (extrato) + títulos em aberto + contratos a faturar</div>
    </div>
  </div>
  <div class="carregando" id="ffCarregando" style="padding:40px 0;color:var(--tx3)">Carregando o fluxo…</div>
  <div id="ffErro"></div>
"""
markup = cab + secao.replace('<section id="v-fluxo">', '<section id="v-fluxo" class="hide">') + "\n</div>\n" + drawer + '<div class="toast" id="toast"></div>\n'
# textos do mockup que não valem com dados reais
markup = markup.replace('<span>Linha cheia = realizado · Área azul = cenário base · Faixa = incerteza histórica (desvio previsto × realizado) · ◆ = evento simulado</span>',
                        '<span>Linha cheia = realizado · Área azul = cenário base · Faixa = incerteza (estimada em 4,5% do giro até haver histórico previsto × realizado) · ◆ = evento simulado</span>')
assert '<span class="tog" data-tg="ghost"><i></i>Previsto original</span>' in markup
markup = markup.replace('<span class="tog" data-tg="ghost"><i></i>Previsto original</span>',
                        '<span class="tog hide" data-tg="ghost" id="ffGhost"><i></i>Previsto original</span>')
open(OUT + "fluxo-fin-markup.ts", "w").write(
    "// Marcação do mockup financeiro-fluxo-v3 (08/10/26) — gerada; os ids são os do mockup.\n"
    "export const MARKUP_FLUXO = " + json.dumps(markup, ensure_ascii=False) + ";\n")

# ───────────── motor ─────────────
s = linhas(376, 955)   # utilidades … dia a dia (o recorte da Pagar/provisões fica para a P1)

def troca(a, b, n=1):
    global s
    assert s.count(a) >= 1, "não achei: " + a[:90]
    s = s.replace(a, b, n)

troca("const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];",
      "const $=s=>root.querySelector(s), $$=s=>[...root.querySelectorAll(s)];")
troca("const HOJE=new Date(2026,9,8);", "let HOJE=(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),d.getDate())})();")
troca("let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;",
      "let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647; // só para cores/ids locais")

# dados de exemplo → vazios; o carregamento real preenche (ver init no fim)
a = s.index("/* ───────────── dados de exemplo ─────────────")
b = s.index("/* ───────────── estado ───────────── */")
s = s[:a] + """/* ───────────── dados (reais) ─────────────
   Vêm de /api/financeiro/fluxo (sql/140) no init(), no fim deste arquivo. */
const EMP={CD:{nome:'CDG Projetos',cor:'var(--cd)'},SF:{nome:'SafeWater',cor:'var(--sf)'},WW:{nome:'WaterWorks',cor:'var(--ww)'}};
let CONTAS=[];
const GRUPOS={
 E:['Contratos recorrentes','Faturamento OS / vendas','Outras entradas','Intercompany','Transferência'],
 S:['Pessoal e PJ','Fornecedores e matéria-prima','Impostos e guias','Locação de veículos','Administrativo e consumo','Financeiras','Intercompany','Transferência']
};
let L=[]; let nid=1;
let TEM_SNAP=false;

""" + s[b:]

# transferência: some só quando o outro lado também está marcado (sem par conhecido = interna)
troca("return L.filter(x=>S.emps.has(x.emp)&&S.contas.has(x.conta)&&!(S.inter&&x.transf)&&(S.prov||!x.prov))",
      "return L.filter(x=>S.emps.has(x.emp)&&S.contas.has(x.conta)&&!(S.inter&&x.transf&&(x.par==null||S.contas.has(x.par)))&&(S.prov||!x.prov))")

# previsto original: só com snapshot (nada de Δ inventado)
troca("${cols.map((b,i)=>cell(b,b[nat],b[nat+'p'],S.ghost||b.past?b[nat+'o']:null,`data-cell=\"${i}|${nat}|\"`)).join('')}",
      "${cols.map((b,i)=>cell(b,b[nat],b[nat+'p'],TEM_SNAP&&(S.ghost||b.past)?b[nat+'o']:null,`data-cell=\"${i}|${nat}|\"`)).join('')}")
troca("${cols.map((b,i)=>cell(b,b['g'+nat][g]||0,b['g'+nat+'p'][g]||0,b.past?b['g'+nat+'o'][g]||0:null,`data-cell=\"${i}|${nat}|${g}\"`)).join('')}",
      "${cols.map((b,i)=>cell(b,b['g'+nat][g]||0,b['g'+nat+'p'][g]||0,TEM_SNAP&&b.past?b['g'+nat+'o'][g]||0:null,`data-cell=\"${i}|${nat}|${g}\"`)).join('')}")
# grupos sem movimento na janela não viram linha vazia
troca("if(open) for(const g of GRUPOS[nat]) h+=",
      "if(open) for(const g of GRUPOS[nat].filter(g=>cols.some(b=>b['g'+nat][g]))) h+=")
troca("const sc=$('.scroll'),th=$$('#tbl th.today')[0];", "const sc=$('#tbl').parentElement,th=$$('#tbl th.today')[0];")

# gaveta: título em aberto abre a edição
troca("$('#dwB').innerHTML=`<table class=\"list num\"><thead><tr><th>Data</th><th>Contraparte</th><th>Status</th><th class=\"r\">Valor</th></tr></thead><tbody>${it.map(x=>`<tr class=\"${x.prov?'row-prov':''}\">",
      "$('#dwB').innerHTML=`<table class=\"list num\"><thead><tr><th>Data</th><th>Contraparte</th><th>Status</th><th class=\"r\">Valor</th></tr></thead><tbody>${it.map(x=>`<tr class=\"${x.prov?'row-prov':''}\" ${x.status==='aberto'&&x.ref&&/^[opr]:/.test(x.ref)&&o.podeEditar?`data-ed=\"${x.ref}\" style=\"cursor:pointer\" title=\"Abrir o título\"`:''}>")
troca("  $('#drawer').classList.add('open');\n}",
      "  $$('#dwB tr[data-ed]').forEach(tr=>tr.onclick=()=>o.onEditar(tr.dataset.ed));\n  $('#drawer').classList.add('open');\n}")
troca("const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([rows.map(r=>Array.isArray(r)?r.join(';'):r).join('\\n')],{type:'text/csv'}));a.download='fluxo-caixa.csv';a.click();toast('CSV gerado')};",
      "const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\\ufeff'+rows.map(r=>Array.isArray(r)?r.join(';'):r).join('\\n')],{type:'text/csv;charset=utf-8'}));a.download='fluxo-caixa.csv';a.click();toast('CSV gerado')};")

# recebíveis vencidos reais
troca("const REC_VENC=[];for(let i=0;i<26;i++)REC_VENC.push({id:9000+i,emp:'SF',nat:'E',grupo:'Faturamento OS / vendas',data:addD(HOJE,-5-Math.floor(rnd()*80)),valor:Math.round(2500+rnd()*11000),status:'aberto',conta:4,contraparte:'Cliente em atraso',doc:'Recibo '+(300+i)});",
      "let REC_VENC=[];")
# eventos e cenários: do banco (os três padrão ficam sempre)
a = s.index("let EVENTOS=[")
b = s.index("let evSeq=7;")
s = s[:a] + "let EVENTOS=[];\n" + s[b:]
troca(" {id:'sw',nome:'Plano SW + antecipação',cor:PALETA[2],vis:false,lev:{...LEV0,post:15},ev:new Set([1,2,3,4,5])},\n", "")
troca("Object.assign(S,{edit:'cons',colchao:100000,", "Object.assign(S,{edit:'cons',colchao:(()=>{try{return Number(localStorage.getItem('ff1.colchao'))||100000}catch{return 100000}})(),")
troca("$('#colIn').onchange=e=>{S.colchao=Number(e.target.value.replace(/\\D/g,''))||0;renderSim()};",
      "$('#colIn').onchange=e=>{S.colchao=Number(e.target.value.replace(/\\D/g,''))||0;try{localStorage.setItem('ff1.colchao',String(S.colchao))}catch{}renderSim()};")
troca("let rz;window.addEventListener('resize',()=>{clearTimeout(rz);rz=setTimeout(renderSim,120)});",
      "let rz;const onResize=()=>{clearTimeout(rz);rz=setTimeout(()=>{if(vivo&&CONTAS.length)renderSim()},120)};window.addEventListener('resize',onResize);")
troca("document.addEventListener('click',e=>{if(!$('#popContas').contains(e.target))$('#popContas').classList.remove('open')});",
      "const onDocClick=e=>{const p=$('#popContas');if(p&&!p.contains(e.target))p.classList.remove('open')};document.addEventListener('click',onDocClick);")

# eventos: criar / excluir / lançar gravam no servidor
troca("const e={id:evSeq++,desc,nat:$('#eNat').value,valor:v,data:$('#eData').value||'2026-11-10',rep:+$('#eRep').value,emp:$('#eEmp').value};EVENTOS.push(e);\n    let alvo=c;if(c.fixo){alvo=novoCen('Cenário '+(CENS.length));}\n    alvo.ev.add(e.id);alvo.vis=true;S.edit=alvo.id;renderEditor();renderSim();toast('Evento adicionado a '+alvo.nome)};",
      "const novo={descricao:desc,natureza:$('#eNat').value,valor:v,data:$('#eData').value||iso(addD(HOJE,30)),repeticoes:+$('#eRep').value,empresa:$('#eEmp').value};\n    api({acao:'criar_evento',evento:novo}).then(j=>{const x=j.evento;const e={id:+x.id,desc:x.descricao,nat:x.natureza,valor:+x.valor,data:String(x.data).slice(0,10),rep:+x.repeticoes,emp:x.empresa};EVENTOS.push(e);\n    let alvo=c;if(c.fixo){alvo=novoCen('Cenário '+(CENS.length));}\n    alvo.ev.add(e.id);alvo.vis=true;S.edit=alvo.id;renderEditor();renderSim();toast('Evento adicionado a '+alvo.nome+' — salve o cenário para guardar')}).catch(er=>toast(er.message))};")
troca("$$('#cenEdit [data-del]').forEach(b=>b.onclick=()=>{const id=+b.dataset.del;EVENTOS=EVENTOS.filter(e=>e.id!==id);CENS.forEach(c=>c.ev.delete(id));renderEditor();renderSim()});",
      "$$('#cenEdit [data-del]').forEach(b=>b.onclick=()=>{const id=+b.dataset.del;api({acao:'excluir_evento',id}).then(()=>{EVENTOS=EVENTOS.filter(e=>e.id!==id);CENS.forEach(c=>c.ev.delete(id));renderEditor();renderSim()}).catch(er=>toast(er.message))});")
troca("$$('#cenEdit [data-lan]').forEach(a=>a.onclick=ev=>{ev.preventDefault();toast('Abre \"+ Nova conta\" já preenchida, marcada como valor estimado')});",
      "$$('#cenEdit [data-lan]').forEach(a=>a.onclick=ev=>{ev.preventDefault();const e=EVENTOS.find(x=>x.id===+a.dataset.lan);if(e)o.onLancar({tipo:e.nat==='E'?'receber':'pagar',empresa:e.emp,valor:e.valor,vencimento:e.data,obs:e.desc+' (do simulador do fluxo)',recorrencia:e.rep})});")
# cenário: salvar / excluir / compartilhar no servidor
troca("const dl=$('#delCen');if(dl)dl.onclick=()=>{CENS=CENS.filter(x=>x!==c);S.edit='base';renderEditor();renderSim()};",
      "const dl=$('#delCen');if(dl)dl.onclick=()=>{const fim=()=>{CENS=CENS.filter(x=>x!==c);S.edit='base';renderEditor();renderSim()};if(c.salvo)api({acao:'excluir_cenario',id:c.id}).then(()=>{fim();toast('Cenário excluído')}).catch(er=>toast(er.message));else fim()};")
troca("const sv=$('#saveCen');if(sv)sv.onclick=()=>toast('Cenário salvo (finance.fluxo_cenarios)');",
      "const sv=$('#saveCen');if(sv)sv.onclick=()=>{api({acao:'salvar_cenario',cenario:{id:c.salvo?c.id:undefined,nome:c.nome,cor:c.cor,alavancas:c.lev,eventos:[...c.ev],empresas:[...S.emps],compartilhado:!!c.share}}).then(j=>{const antes=c.id;c.id=j.cenario.id;c.salvo=true;if(S.edit===antes)S.edit=c.id;renderEditor();toast('Cenário salvo'+(c.share?' · visível para o financeiro':''))}).catch(er=>toast(er.message))};")
troca("const sh=$('#shareTog');if(sh)sh.onclick=()=>{sh.classList.toggle('on');toast(sh.classList.contains('on')?'Visível para o financeiro':'Só para você')};",
      "const sh=$('#shareTog');if(sh){sh.classList.toggle('on',!!c.share);sh.onclick=()=>{c.share=!c.share;sh.classList.toggle('on',c.share);toast((c.share?'Visível para o financeiro':'Só para você')+' — salve para valer')}}")

# empresa: pré-marca os bancos com saldo ≠ 0 + o padrão (e lembra a escolha por empresa)
troca("S.emps=new Set([c]);S.contas=new Set(CONTAS.filter(x=>x.emp===c&&x.saldo!==0||x.emp===c&&x.pad).map(x=>x.id));S.zoom=null;renderAll()});",
      "S.emps=new Set([c]);S.contas=contasIniciais(c);S.zoom=null;guardarEscolha();renderAll()});")
troca("$$('#bancos .bk').forEach(b=>b.onclick=()=>{const id=+b.dataset.c;if(S.contas.has(id)){if(S.contas.size===1){toast('Deixe pelo menos um banco');return}S.contas.delete(id)}else S.contas.add(id);renderAll()});",
      "$$('#bancos .bk').forEach(b=>b.onclick=()=>{const id=+b.dataset.c;if(S.contas.has(id)){if(S.contas.size===1){toast('Deixe pelo menos um banco');return}S.contas.delete(id)}else S.contas.add(id);guardarEscolha();renderAll()});")
troca("S.emps=new Set(['SF']);S.contas=new Set(CONTAS.filter(c=>c.emp==='SF').map(c=>c.id));", "")
troca('<input id="eData" type="date" value="2026-11-10">', '<input id="eData" type="date" value="${iso(addD(HOJE,30))}">')

cabeca = r"""// @ts-nocheck — porte direto do script do mockup financeiro-fluxo-v3 (08/10/26, Benny).
// O mockup é imperativo (innerHTML + handlers); aqui fica igual, mas:
//  · dados reais de /api/financeiro/fluxo (sql/140): contas e saldo de hoje,
//    realizado (razão), a pagar/receber em aberto, contratos a faturar (provisionado)
//    e recebíveis vencidos (fora do Base, só na alavanca "recuperar vencidos");
//  · cenários e linhas de simulação gravados em finance.fluxo_cenarios/eventos;
//  · transferência entre bancos escolhidos some só quando os DOIS lados estão marcados;
//  · "Previsto original" (Δ) só aparece quando houver foto diária (finance.fluxo_snapshot);
//  · tudo escopado no contentor (root). Gerado por gerar_fluxo.py — mantenha o porte fiel.
type Opts = {
  root: HTMLElement;
  podeEditar: boolean;
  onEditar: (ref: string) => void;
  onLancar: (x: { tipo: "pagar" | "receber"; empresa: string; valor: number; vencimento: string; obs: string; recorrencia: number }) => void;
};

export function montarFluxo(o: Opts) {
const root = o.root;
let vivo = true;
async function api(corpo){const r=await fetch('/api/financeiro/fluxo/cenarios',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(corpo)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j}
"""

rodape = r"""
/* ───────────── carregamento real ───────────── */
const dt=s=>{const [y,m,d]=String(s).slice(0,10).split('-').map(Number);return new Date(y,m-1,d)};
function contasIniciais(emp){
  try{const g=JSON.parse(localStorage.getItem('ff1.contas.'+emp)||'null');if(Array.isArray(g)){const ok=g.filter(id=>CONTAS.some(c=>c.id===id&&c.emp===emp));if(ok.length)return new Set(ok)}}catch{}
  return new Set(CONTAS.filter(x=>x.emp===emp&&(x.saldo!==0||x.pad)).map(x=>x.id));
}
function guardarEscolha(){try{const e=[...S.emps][0];localStorage.setItem('ff1.contas.'+e,JSON.stringify([...S.contas]));localStorage.setItem('ff1.emp',e)}catch{}}
async function init(){
  try{
    const h0=new Date();const de=new Date(h0.getFullYear(),h0.getMonth()-6,1),ate=new Date(h0.getFullYear(),h0.getMonth()+7,0);
    const [r1,r2]=await Promise.all([
      fetch(`/api/financeiro/fluxo?de=${iso(de)}&ate=${iso(ate)}`,{cache:'no-store'}),
      fetch('/api/financeiro/fluxo/cenarios',{cache:'no-store'}),
    ]);
    const j=await r1.json();if(!r1.ok)throw new Error(j.error||('HTTP '+r1.status));
    const jc=await r2.json().catch(()=>({cenarios:[],eventos:[]}));
    if(!vivo)return;
    HOJE=dt(j.hoje);TEM_SNAP=!!j.snapshot;
    const pad=j.conta_padrao||{};
    const usadas=new Set();
    L=(j.lancs||[]).map(x=>{const emp=x[0];const conta=x[6]!=null?Number(x[6]):Number(pad[emp]||0);usadas.add(conta);
      return {id:nid++,emp,nat:x[1],grupo:x[2],data:dt(x[3]),valor:Number(x[4]),status:x[5]==='R'?'realizado':'aberto',conta,contraparte:x[7]||'—',prov:!!x[8],doc:x[9]||null,transf:!!x[10],par:x[11]!=null?Number(x[11]):null,ref:x[12]||null}});
    CONTAS=(j.contas||[]).map(c=>({id:Number(c.id),emp:c.emp,nome:c.nome,saldo:Number(c.saldo)||0,pad:Number(pad[c.emp])===Number(c.id)}))
      .filter(c=>c.saldo!==0||c.pad||usadas.has(c.id));
    REC_VENC=(j.rec_venc||[]).map((x,i)=>({id:i+1,emp:x[0],nat:'E',grupo:x[1],data:dt(x[2]),valor:Number(x[3]),status:'aberto',conta:x[4]!=null?Number(x[4]):Number(pad[x[0]]||0),contraparte:x[5]||'—',doc:x[6]||null,ref:x[7]||null}));
    EVENTOS=(jc.eventos||[]).map(x=>({id:Number(x.id),desc:x.descricao,nat:x.natureza,valor:Number(x.valor),data:String(x.data).slice(0,10),rep:Number(x.repeticoes)||1,emp:x.empresa}));
    for(const c of (jc.cenarios||[]))CENS.push({id:c.id,nome:c.nome,cor:c.cor,vis:true,salvo:true,share:!!c.compartilhado,lev:{...LEV0,...(c.alavancas||{})},ev:new Set((c.eventos||[]).map(Number))});
    let emp='SF';try{const g=localStorage.getItem('ff1.emp');if(g&&EMP[g])emp=g}catch{}
    S.emps=new Set([emp]);S.contas=contasIniciais(emp);
    if(TEM_SNAP)$('#ffGhost').classList.remove('hide');
    $('#ffSub').textContent='Fluxo por empresa · bancos unificados · dados de '+HOJE.toLocaleDateString('pt-BR')+' · realizado (extrato) + títulos em aberto + contratos a faturar';
    $('#ffCarregando').classList.add('hide');$('#v-fluxo').classList.remove('hide');
    renderAll();
  }catch(e){
    $('#ffCarregando').classList.add('hide');
    $('#ffErro').innerHTML=`<div class="card" style="color:var(--out)">Não foi possível carregar o fluxo: ${String(e.message||e)} — recarregue a página (F5).</div>`;
  }
}
init();

return {
  destruir(){vivo=false;window.removeEventListener('resize',onResize);document.removeEventListener('click',onDocClick)},
  recarregar(){location.reload()},
};
}
"""
open(OUT + "fluxo-fin-motor.ts", "w").write(cabeca + s + rodape)
print("ok", len(corpo_css), len(markup), len(s))
