// @ts-nocheck — porte direto do script do mockup financeiro-fluxo-v3 (08/10/26, Benny).
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
/* ───────────── utilidades ───────────── */
const $=s=>root.querySelector(s), $$=s=>[...root.querySelectorAll(s)];
let HOJE=(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),d.getDate())})();
const iso=d=>d.toISOString().slice(0,10);
const addD=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const addM=(d,n)=>new Date(d.getFullYear(),d.getMonth()+n,d.getDate());
const brl=v=>v.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0});
const brl2=v=>v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const k=v=>{const a=Math.abs(v);const s=v<0?'−':'';return a>=1e6?s+(a/1e6).toFixed(2).replace('.',',')+' mi':a>=1e3?s+Math.round(a/1e3)+'k':s+Math.round(a)};
const dBR=d=>d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
const MES=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647; // só para cores/ids locais
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2200)}

/* ───────────── dados (reais) ─────────────
   Vêm de /api/financeiro/fluxo (sql/140) no init(), no fim deste arquivo. */
const EMP={CD:{nome:'CDG Projetos',cor:'var(--cd)'},SF:{nome:'SafeWater',cor:'var(--sf)'},WW:{nome:'WaterWorks',cor:'var(--ww)'}};
let CONTAS=[];
const GRUPOS={
 E:['Contratos recorrentes','Faturamento OS / vendas','Outras entradas','Intercompany','Transferência'],
 S:['Pessoal e PJ','Fornecedores e matéria-prima','Impostos e guias','Locação de veículos','Administrativo e consumo','Financeiras','Intercompany','Transferência']
};
let L=[]; let nid=1;
let TEM_SNAP=false;

/* ───────────── estado ───────────── */
const S={emps:new Set(['CD','SF','WW']),contas:new Set(CONTAS.map(c=>c.id)),j:[-3,3],g:'semana',prov:true,venc:true,inter:true,ghost:false,abertos:new Set()};

/* ───────────── filtros UI ───────────── */
function renderChips(){
  $('#empChips').innerHTML=Object.entries(EMP).map(([c,e])=>`<button class="chip ${S.emps.has(c)?'on':''}" data-e="${c}" style="margin-right:6px"><i class="dot" style="background:${e.cor}"></i>${c} · ${e.nome}</button>`).join('');
  $$('#empChips .chip').forEach(b=>b.onclick=()=>{const c=b.dataset.e;
    if(S.emps.has(c)){if(S.emps.size===1)return;S.emps.delete(c);CONTAS.filter(x=>x.emp===c).forEach(x=>S.contas.delete(x.id))}
    else{S.emps.add(c);CONTAS.filter(x=>x.emp===c).forEach(x=>S.contas.add(x.id))}
    renderAll()});
}
function renderContas(){
  const vis=CONTAS.filter(c=>S.emps.has(c.emp));
  $('#acctList').innerHTML=[...S.emps].map(e=>`<div class="mini" style="margin:6px 8px 2px;font-weight:700"><i class="dot" style="background:${EMP[e].cor}"></i>${EMP[e].nome}</div>`+
    vis.filter(c=>c.emp===e).map(c=>`<label><input type="checkbox" data-c="${c.id}" ${S.contas.has(c.id)?'checked':''}>${c.nome}${c.pad?' <span class="mini">· padrão</span>':''}<span class="bal num ${c.saldo<0?'neg':''}">${brl(c.saldo)}</span></label>`).join('')).join('');
  $$('#acctList input').forEach(i=>i.onchange=()=>{const id=+i.dataset.c;i.checked?S.contas.add(id):S.contas.delete(id);renderAll(false)});
  const sel=vis.filter(c=>S.contas.has(c.id)).length;
  $('#contasLbl').textContent=sel===vis.length?'todas ('+sel+')':sel+' de '+vis.length;
}
$('#btnContas').onclick=e=>{e.stopPropagation();$('#popContas').classList.toggle('open')};
const onDocClick=e=>{const p=$('#popContas');if(p&&!p.contains(e.target))p.classList.remove('open')};document.addEventListener('click',onDocClick);
$('#cTodas').onclick=()=>{CONTAS.filter(c=>S.emps.has(c.emp)).forEach(c=>S.contas.add(c.id));renderAll(false)};
$('#cNenhuma').onclick=()=>{S.contas.clear();renderAll(false)};
$$('#segJanela button').forEach(b=>b.onclick=()=>{$$('#segJanela button').forEach(x=>x.classList.remove('on'));b.classList.add('on');S.j=b.dataset.j.split(',').map(Number);S.zoom=null;renderAll()});
$$('#segGran button').forEach(b=>b.onclick=()=>{$$('#segGran button').forEach(x=>x.classList.remove('on'));b.classList.add('on');S.g=b.dataset.g;renderAll()});
$$('.tog').forEach(t=>t.onclick=()=>{t.classList.toggle('on');S[t.dataset.tg]=t.classList.contains('on');renderAll()});

/* ───────────── motor do fluxo ───────────── */
function lancFiltrados(){
  return L.filter(x=>S.emps.has(x.emp)&&S.contas.has(x.conta)&&!(S.inter&&x.transf&&(x.par==null||S.contas.has(x.par)))&&(S.prov||!x.prov))
   .map(x=>{ if(x.status==='aberto'&&x.data<HOJE){ return S.venc?{...x,dataEf:HOJE,late:true}:null } return {...x,dataEf:x.data} }).filter(Boolean);
}
function buckets(){
  const ini=S.j[0]===0?HOJE:addM(new Date(HOJE.getFullYear(),HOJE.getMonth(),1),S.j[0]);
  const fim=S.j[0]===0?addD(HOJE,90):addD(addM(new Date(HOJE.getFullYear(),HOJE.getMonth()+1,1),S.j[1]),-1);
  const out=[];let d=new Date(ini);
  if(S.g==='dia'){while(d<=fim){out.push({a:new Date(d),b:new Date(d),lbl:dBR(d)});d=addD(d,1)}}
  else if(S.g==='semana'){d=addD(d,-((d.getDay()+6)%7));while(d<=fim){const b=addD(d,6);out.push({a:new Date(d),b,lbl:dBR(d)});d=addD(d,7)}}
  else{d=new Date(d.getFullYear(),d.getMonth(),1);while(d<=fim){const b=new Date(d.getFullYear(),d.getMonth()+1,0);out.push({a:new Date(d),b,lbl:MES[d.getMonth()]+'/'+String(d.getFullYear()).slice(2)});d=new Date(d.getFullYear(),d.getMonth()+1,1)}}
  out.forEach(x=>{x.past=x.b<HOJE;x.cur=x.a<=HOJE&&x.b>=HOJE});
  return {ini:out[0].a,fim:out[out.length-1].b,list:out};
}
function saldoHoje(){return CONTAS.filter(c=>S.emps.has(c.emp)&&S.contas.has(c.id)).reduce((a,c)=>a+c.saldo,0)}
function calc(){
  const B=buckets(), xs=lancFiltrados(); const day=d=>new Date(d.getFullYear(),d.getMonth(),d.getDate());
  B.list.forEach(b=>{b.items=[];b.E=0;b.S=0;b.Ep=0;b.Sp=0;b.Eo=0;b.So=0;b.gE={};b.gS={};b.gEp={};b.gSp={};b.gEo={};b.gSo={}});
  for(const x of xs){const d=day(x.dataEf);const b=B.list.find(b=>d>=b.a&&d<=b.b);if(!b)continue;b.items.push(x);
    const E=x.nat==='E';const key=E?'E':'S';b[key]+=x.valor;b['g'+key][x.grupo]=(b['g'+key][x.grupo]||0)+x.valor;
    if(x.prov){b[key+'p']+=x.valor;b['g'+key+'p'][x.grupo]=(b['g'+key+'p'][x.grupo]||0)+x.valor}
    if(x.status==='realizado'){b[key+'o']+=x.previstoOrig||x.valor;b['g'+key+'o'][x.grupo]=(b['g'+key+'o'][x.grupo]||0)+(x.previstoOrig||x.valor)}}
  // saldo: âncora = saldo de hoje; para trás desfaz realizados, para frente soma abertos
  const sh=saldoHoje(); const realPos=xs.filter(x=>x.status==='realizado'&&day(x.dataEf)>=B.ini).reduce((a,x)=>a+(x.nat==='E'?x.valor:-x.valor),0);
  let s=sh-realPos; // saldo no início da janela
  B.list.forEach(b=>{
    if(b.cur){ // mistura: realizados do período + abertos
      b.ini=s; b.fimSaldo=s+b.E-b.S; }
    else {b.ini=s;b.fimSaldo=s+b.E-b.S}
    s=b.fimSaldo});
  return {B,xs,sh};
}

/* ───────────── render ───────────── */
function renderAll(full=true){renderChips();renderContas();const R=calc();renderKpis(R);renderChart(R);renderSide(R);renderTable(R);}
function renderKpis({B,xs,sh}){
  const past=xs.filter(x=>x.status==='realizado'&&x.dataEf>=B.ini);
  const fut=xs.filter(x=>x.status==='aberto'&&x.dataEf<=B.fim);
  const sum=(a,n)=>a.filter(x=>x.nat===n).reduce((s,x)=>s+x.valor,0);
  const rE=sum(past,'E'),rS=sum(past,'S'),fE=sum(fut,'E'),fS=sum(fut,'S');
  const provS=fut.filter(x=>x.prov&&x.nat==='S').reduce((a,x)=>a+x.valor,0),provE=fut.filter(x=>x.prov&&x.nat==='E').reduce((a,x)=>a+x.valor,0);
  const futB=B.list.filter(b=>!b.past);let min=futB[0]||B.list[0];futB.forEach(b=>{if(b.fimSaldo<min.fimSaldo)min=b});
  const fim=B.list[B.list.length-1].fimSaldo;
  const late=xs.filter(x=>x.late).reduce((a,x)=>a+(x.nat==='S'?x.valor:0),0);
  const card=(l,v,s,cls='')=>`<div class="card kpi"><div class="l">${l}</div><div class="v num ${cls}">${v}</div><div class="s">${s}</div></div>`;
  $('#kpis').innerHTML=
    card('Saldo hoje · contas selecionadas',brl(sh),S.contas.size+' contas · Omie/OFX até 07/10',sh<0?'neg':'')+
    card('Realizado na janela',brl(rE-rS),`<span class="pos">+${k(rE)}</span> entradas · <span class="neg">−${k(rS)}</span> saídas`,rE-rS<0?'neg':'pos')+
    card('A realizar na janela',brl(fE-fS),`<span class="pos">+${k(fE)}</span> · <span class="neg">−${k(fS)}</span>${S.venc&&late?` · inclui ${k(late)} vencidos`:''}`,fE-fS<0?'neg':'pos')+
    card('Saldo projetado no fim',brl(fim),'em '+B.fim.toLocaleDateString('pt-BR'),fim<0?'neg':'')+
    card('Menor saldo projetado',brl(min?min.fimSaldo:0),min?(S.g==='dia'?'em ':'período de ')+min.lbl:'',min&&min.fimSaldo<0?'neg':'')+
    card('Provisionado no futuro',`<span class="pv">${k(provS+provE)}</span>`,`saídas ${k(provS)} · entradas ${k(provE)} · ${fS?Math.round(provS/fS*100):0}% das saídas`);
}
function renderChart({B}){
  const W=Math.max(760,B.list.length*(S.g==='dia'?14:S.g==='semana'?34:70)),H=300,pl=54,pr=14,pt=14,pb=34;
  const maxV=Math.max(1,...B.list.map(b=>Math.max(b.E,b.S,S.ghost?Math.max(b.Eo,b.So):0)));
  const sal=B.list.map(b=>b.fimSaldo);const smin=Math.min(0,...sal),smax=Math.max(0,...sal);
  const bw=(W-pl-pr)/B.list.length;const y=v=>pt+(H-pt-pb)*(1-v/maxV);const ys=v=>pt+(H-pt-pb)*(1-(v-smin)/((smax-smin)||1));
  let g=`<svg width="${W}" height="${H}" role="img" aria-label="Fluxo de caixa"><defs>
   <pattern id="hi" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="5" fill="var(--in)"/></pattern>
   <pattern id="ho" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="5" fill="var(--out)"/></pattern></defs>`;
  for(let i=0;i<=4;i++){const v=maxV*i/4;g+=`<line x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${pl-6}" y="${y(v)+3}" text-anchor="end">${k(v)}</text>`}
  B.list.forEach((b,i)=>{const x=pl+i*bw,w=Math.max(3,bw*.36);const op=b.past?1:.78;
    if(b.past)g+=`<rect x="${x}" y="${pt}" width="${bw}" height="${H-pt-pb}" fill="var(--panel2)" opacity=".5"/>`;
    const eR=b.E-b.Ep,sR=b.S-b.Sp;
    g+=`<rect x="${x+bw*.12}" y="${y(eR)}" width="${w}" height="${y(0)-y(eR)}" fill="var(--in)" opacity="${op}" rx="2"/>`;
    if(b.Ep)g+=`<rect x="${x+bw*.12}" y="${y(b.E)}" width="${w}" height="${y(eR)-y(b.E)}" fill="url(#hi)" stroke="var(--in)" stroke-width=".8"/>`;
    g+=`<rect x="${x+bw*.52}" y="${y(sR)}" width="${w}" height="${y(0)-y(sR)}" fill="var(--out)" opacity="${op}" rx="2"/>`;
    if(b.Sp)g+=`<rect x="${x+bw*.52}" y="${y(b.S)}" width="${w}" height="${y(sR)-y(b.S)}" fill="url(#ho)" stroke="var(--out)" stroke-width=".8"/>`;
    if(S.ghost&&b.past){g+=`<rect x="${x+bw*.12}" y="${y(b.Eo)}" width="${w}" height="${y(0)-y(b.Eo)}" fill="none" stroke="var(--tx2)" stroke-dasharray="3 2"/><rect x="${x+bw*.52}" y="${y(b.So)}" width="${w}" height="${y(0)-y(b.So)}" fill="none" stroke="var(--tx2)" stroke-dasharray="3 2"/>`}
    const step=Math.ceil(B.list.length/(W/60));if(i%step===0)g+=`<text x="${x+bw/2}" y="${H-pb+16}" text-anchor="middle">${b.lbl}</text>`;
    g+=`<rect x="${x}" y="${pt}" width="${bw}" height="${H-pt-pb}" fill="transparent" data-b="${i}" style="cursor:pointer"><title>${b.lbl}\nEntradas ${brl(b.E)} (prov. ${brl(b.Ep)})\nSaídas ${brl(b.S)} (prov. ${brl(b.Sp)})\nSaldo ${brl(b.fimSaldo)}</title></rect>`;
  });
  // linha de saldo: passado sólido, futuro tracejado
  const pts=B.list.map((b,i)=>[pl+i*bw+bw/2,ys(b.fimSaldo),b.past]);
  const iCur=Math.max(0,B.list.findIndex(b=>!b.past));
  const path=a=>a.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  g+=`<path d="${path(pts.slice(0,iCur+1))}" fill="none" stroke="var(--sf)" stroke-width="2.4"/>`;
  g+=`<path d="${path(pts.slice(iCur))}" fill="none" stroke="var(--sf)" stroke-width="2.4" stroke-dasharray="5 4"/>`;
  if(smin<0)g+=`<line x1="${pl}" x2="${W-pr}" y1="${ys(0)}" y2="${ys(0)}" stroke="var(--out)" stroke-dasharray="2 3" opacity=".6"/>`;
  const xc=pl+iCur*bw;g+=`<line x1="${xc}" x2="${xc}" y1="${pt}" y2="${H-pb}" stroke="var(--sf)"/><text x="${xc+4}" y="${pt+10}" style="fill:var(--sf);font-weight:700">hoje</text>`;
  const sx=W-pr;g+=`<text x="${sx}" y="${ys(smax)+3}" text-anchor="end" style="fill:var(--sf)">saldo ${k(smax)}</text>`;
  $('#chart').innerHTML=g+'</svg>';
  $$('#chart rect[data-b]').forEach(r=>r.onclick=()=>abrirBucket(B.list[+r.dataset.b]));
}
function renderSide({xs,B}){
  // provisionados que vencem em 7 dias e ainda sem documento
  const pend=L.filter(x=>x.prov&&x.nat==='S'&&x.status==='aberto'&&S.emps.has(x.emp)&&x.data>=HOJE&&x.data<=addD(HOJE,7)).sort((a,b)=>a.data-b.data);
  const byG={};xs.filter(x=>x.status==='aberto'&&x.nat==='S'&&x.dataEf<=addD(HOJE,30)).forEach(x=>byG[x.grupo]=(byG[x.grupo]||0)+x.valor);
  const top=Object.entries(byG).sort((a,b)=>b[1]-a[1]).slice(0,6);
  $('#side').innerHTML=`<h4>Saídas dos próximos 30 dias</h4>${top.map(([g,v])=>`<div class="it"><span>${g}</span><b class="num">${brl(v)}</b></div>`).join('')}
   <h4 style="margin-top:18px">Provisões aguardando documento · 7d <span class="badge b-prov">${pend.length}</span></h4>
   ${pend.slice(0,6).map(x=>`<div class="it"><span>${dBR(x.data)} · ${x.contraparte}<div class="mini">${x.emp} · ${x.grupo}</div></span><b class="num pv">${brl(x.valor)}</b></div>`).join('')||'<div class="mini">Nada pendente.</div>'}
   <button class="btn sm" style="margin-top:10px;width:100%" onclick="irPara('pagar','aguard')">Confirmar provisões →</button>`;
}
function renderTable({B}){
  $('#tblGran').textContent={dia:'por dia',semana:'por semana',mes:'por mês'}[S.g];
  const cols=B.list; const cls=b=>(b.past?'past':'')+(b.cur?' today':'');
  const cell=(b,v,vp,vo,click)=>{const showO=b.past&&vo!=null&&vo!==0;const d=showO?v-vo:0;
    return `<td class="c ${cls(b)}" ${click}>${v?k(v):'<span class="muted">—</span>'}${vp?`<span class="var pv"><i>${k(vp)} prov.</i></span>`:''}${showO?`<span class="var ${Math.abs(d)/vo>.1?(d>0?'neg':'pos'):''}">Δ ${d>0?'+':''}${k(d)}</span>`:''}</td>`};
  let h=`<thead><tr><th style="min-width:220px"></th>${cols.map(b=>`<th class="${cls(b)}">${b.lbl}${b.cur?' •':''}</th>`).join('')}</tr></thead><tbody>`;
  h+=`<tr class="tot"><td>Saldo inicial</td>${cols.map(b=>`<td class="${cls(b)} ${b.ini<0?'neg':''}">${k(b.ini)}</td>`).join('')}</tr>`;
  for(const nat of ['E','S']){
    const open=S.abertos.has(nat);
    h+=`<tr class="grp"><td style="cursor:pointer" data-x="${nat}">${open?'▾':'▸'} ${nat==='E'?'<span class="pos">Entradas</span>':'<span class="neg">Saídas</span>'}</td>${cols.map((b,i)=>cell(b,b[nat],b[nat+'p'],TEM_SNAP&&(S.ghost||b.past)?b[nat+'o']:null,`data-cell="${i}|${nat}|"`)).join('')}</tr>`;
    if(open) for(const g of GRUPOS[nat].filter(g=>cols.some(b=>b['g'+nat][g]))) h+=`<tr class="sub"><td>${g}</td>${cols.map((b,i)=>cell(b,b['g'+nat][g]||0,b['g'+nat+'p'][g]||0,TEM_SNAP&&b.past?b['g'+nat+'o'][g]||0:null,`data-cell="${i}|${nat}|${g}"`)).join('')}</tr>`;
  }
  h+=`<tr class="grp"><td>Resultado do período</td>${cols.map(b=>{const v=b.E-b.S;return `<td class="${cls(b)} ${v<0?'neg':'pos'}">${k(v)}</td>`}).join('')}</tr>`;
  h+=`<tr class="tot"><td>Saldo final</td>${cols.map(b=>`<td class="${cls(b)} ${b.fimSaldo<0?'neg':''}">${k(b.fimSaldo)}</td>`).join('')}</tr></tbody>`;
  $('#tbl').innerHTML=h;
  $$('#tbl td[data-x]').forEach(t=>t.onclick=()=>{const n=t.dataset.x;S.abertos.has(n)?S.abertos.delete(n):S.abertos.add(n);renderTable(calc())});
  $$('#tbl td[data-cell]').forEach(t=>t.onclick=()=>{const [i,nat,g]=t.dataset.cell.split('|');abrirBucket(B.list[+i],nat,g)});
  const sc=$('#tbl').parentElement,th=$$('#tbl th.today')[0];if(th&&sc.scrollLeft===0)sc.scrollLeft=Math.max(0,th.offsetLeft-420);
}
function abrirBucket(b,nat,g){
  let it=b.items.slice();if(nat)it=it.filter(x=>x.nat===nat);if(g)it=it.filter(x=>x.grupo===g);
  it.sort((a,b)=>a.dataEf-b.dataEf);
  $('#dwK').textContent=b.past?'Realizado':'Projetado';
  $('#dwT').textContent=(S.g==='dia'?b.lbl:b.lbl+' → '+dBR(b.b))+(g?' · '+g:nat?' · '+(nat==='E'?'Entradas':'Saídas'):'');
  const tE=it.filter(x=>x.nat==='E').reduce((a,x)=>a+x.valor,0),tS=it.filter(x=>x.nat==='S').reduce((a,x)=>a+x.valor,0);
  $('#dwS').innerHTML=`${it.length} lançamentos · <span class="pos">+${brl(tE)}</span> · <span class="neg">−${brl(tS)}</span>`;
  const cn=id=>{const c=CONTAS.find(c=>c.id===id);return c?c.emp+' · '+c.nome:''};
  $('#dwB').innerHTML=`<table class="list num"><thead><tr><th>Data</th><th>Contraparte</th><th>Status</th><th class="r">Valor</th></tr></thead><tbody>${it.map(x=>`<tr class="${x.prov?'row-prov':''}" ${x.status==='aberto'&&x.ref&&/^[opr]:/.test(x.ref)&&o.podeEditar?`data-ed="${x.ref}" style="cursor:pointer" title="Abrir o título"`:''}><td>${dBR(x.dataEf)}${x.late?`<div class="mini">venc ${dBR(x.data)}</div>`:''}</td><td>${x.contraparte}<div class="mini">${x.grupo} · ${cn(x.conta)}${x.doc?' · '+x.doc:''}</div></td><td>${x.status==='realizado'?'<span class="badge b-real">realizado</span>':x.prov?'<span class="badge b-prov">provisionado</span>':x.late?'<span class="badge b-late">vencido</span>':'<span class="badge" style="background:var(--panel2)">a realizar</span>'}</td><td class="r ${x.nat==='E'?'pos':'neg'}">${x.nat==='E'?'+':'−'}${brl2(x.valor)}</td></tr>`).join('')}</tbody></table>`;
  $$('#dwB tr[data-ed]').forEach(tr=>tr.onclick=()=>o.onEditar(tr.dataset.ed));
  $('#drawer').classList.add('open');
}
$('#dwX').onclick=()=>$('#drawer').classList.remove('open');
$('#csv').onclick=()=>{const {B}=calc();const rows=[['periodo','inicio','fim','saldo_inicial','entradas','entradas_prov','saidas','saidas_prov','saldo_final']];
  B.list.forEach(b=>rows.push([b.lbl,iso(b.a),iso(b.b),b.ini,b.E,b.Ep,b.S,b.Sp,b.fimSaldo].join(';')));
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>Array.isArray(r)?r.join(';'):r).join('\n')],{type:'text/csv;charset=utf-8'}));a.download='fluxo-caixa.csv';a.click();toast('CSV gerado')};

/* ═════════════ FLUXO v2 · cenários e linhas de simulação ═════════════
   Nada aqui grava título: cenário = alavancas + eventos hipotéticos aplicados
   sobre os lançamentos reais (finance.fluxo_cenarios no banco). */
// contas a RECEBER vencidas (Safe) — fora do base; entram só pela alavanca "recuperar vencidos"
let REC_VENC=[];
const LEV0={atraso:0,inad:0,rec:0,recDias:30,desp:0,prov:0,post:0};
const PALETA=['#f59e0b','#10b981','#a855f7','#ec4899','#06b6d4','#84cc16'];
let EVENTOS=[];
let evSeq=7;
let CENS=[
 {id:'base',nome:'Base',cor:'var(--sf)',vis:true,fixo:true,lev:{...LEV0},ev:new Set()},
 {id:'cons',nome:'Conservador',cor:PALETA[0],vis:true,lev:{...LEV0,atraso:15,inad:5,desp:5,prov:8},ev:new Set()},
 {id:'otim',nome:'Otimista',cor:PALETA[1],vis:true,lev:{...LEV0,rec:60,recDias:45},ev:new Set()},
];
Object.assign(S,{edit:'cons',colchao:(()=>{try{return Number(localStorage.getItem('ff1.colchao'))||100000}catch{return 100000}})(),fg:'auto',vista:'ambos',zoom:null,zero:false,banda:true});
const LEVS=[
 {k:'atraso',l:'Atraso dos clientes',min:0,max:60,st:1,u:' dias',d:'Empurra todas as entradas em aberto.'},
 {k:'inad',l:'Inadimplência',min:0,max:25,st:1,u:'%',d:'Parte das entradas que não entra.'},
 {k:'rec',l:'Recuperar vencidos a receber',min:0,max:100,st:5,u:'%',d:'',dyn:1},
 {k:'recDias',l:'…ao longo de',min:10,max:120,st:5,u:' dias',d:'Distribui a recuperação a partir de hoje.'},
 {k:'desp',l:'Variação das despesas',min:-20,max:20,st:1,u:'%',d:'Aplica em todas as saídas em aberto.'},
 {k:'prov',l:'Provisões acima do previsto',min:-10,max:30,st:1,u:'%',d:'Só nas saídas provisionadas (consumo, PJ…).'},
 {k:'post',l:'Postergar fornecedores',min:0,max:45,st:5,u:' dias',d:'Negociar prazo em matéria-prima/fornecedores.'},
];
const cen=id=>CENS.find(c=>c.id===id);
const sgn=v=>(v>0?'+':'')+v;

function janela(){const B=buckets();return {ini:new Date(B.ini.getFullYear(),B.ini.getMonth(),B.ini.getDate()),fim:B.fim}}
function sim(c){
  const {ini,fim}=janela();const N=Math.round((fim-ini)/864e5)+1;const it=HOJE-ini;const iH=Math.round(it/864e5);
  const ix=d=>Math.round((new Date(d.getFullYear(),d.getMonth(),d.getDate())-ini)/864e5);
  const E=new Float64Array(N),Sd=new Float64Array(N),EP=new Float64Array(N),SP=new Float64Array(N);const marks=[];const its=[];
  const xs=lancFiltrados();const lv=c.lev;
  let realPos=0;
  for(const x of xs){let d=x.dataEf,v=x.valor;
    if(x.status==='realizado'){if(d>=ini)realPos+=x.nat==='E'?v:-v}
    else{ if(x.nat==='E'){d=addD(d,lv.atraso);v*=1-lv.inad/100}
          else{v*=1+lv.desp/100;if(x.prov)v*=1+lv.prov/100;if(lv.post&&x.grupo==='Fornecedores e matéria-prima'&&!x.late)d=addD(d,lv.post)} }
    const i=ix(d);if(i<0||i>=N)continue;its.push({i,nat:x.nat,v,x,mov:x.status==='aberto'&&+d!==+x.dataEf});if(x.nat==='E'){E[i]+=v;if(x.prov)EP[i]+=v}else{Sd[i]+=v;if(x.prov)SP[i]+=v}}
  if(lv.rec>0)for(const x of REC_VENC){if(!S.emps.has(x.emp)||!S.contas.has(x.conta))continue;const i=ix(addD(HOJE,1+(x.id*7)%lv.recDias));if(i>=0&&i<N){E[i]+=x.valor*lv.rec/100;its.push({i,nat:'E',v:x.valor*lv.rec/100,x,rec:1})}}
  for(const e of EVENTOS){if(!c.ev.has(e.id)||!S.emps.has(e.emp))continue;const d0=new Date(e.data+'T12:00');
    for(let k=0;k<e.rep;k++){const i=ix(addM(d0,k));if(i<0||i>=N)continue;if(e.nat==='E')E[i]+=e.valor;else Sd[i]+=e.valor;marks.push({i,e});its.push({i,nat:e.nat,v:e.valor,e})}}
  const sal=new Float64Array(N);let s=saldoHoje()-realPos;let gross=0;const band=new Float64Array(N);
  for(let i=0;i<N;i++){s+=E[i]-Sd[i];sal[i]=s;if(i>=iH){gross+=E[i]+Sd[i];band[i]=gross*0.045}}
  let min=Infinity,minI=iH,abaixo=0;for(let i=iH;i<N;i++){if(sal[i]<min){min=sal[i];minI=i}if(sal[i]<S.colchao)abaixo++}
  const fE=E.slice(iH).reduce((a,b)=>a+b,0),fS=Sd.slice(iH).reduce((a,b)=>a+b,0);
  return {c,ini,N,iH,E,S:Sd,EP,SP,sal,band,min,minI,final:sal[N-1],abaixo,need:Math.max(0,S.colchao-min),fE,fS,marks,its};
}

let RES=[];
function renderAll(){renderChips();renderContas();renderSim();renderEditor();renderTable(calc())}
function renderSim(){
  RES=CENS.map(sim);const base=RES[0];const ed=RES.find(r=>r.c.id===S.edit)||base;
  // KPIs
  const card=(l,v,s,c='')=>`<div class="card kpi"><div class="l">${l}</div><div class="v num ${c}">${v}</div><div class="s">${s}</div></div>`;
  const dia=r=>addD(r.ini,r.minI).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'});
  const sh=saldoHoje();
  $('#kpis2').innerHTML=card('Saldo hoje · '+[...S.emps][0]+' unificado',brl(sh),S.contas.size+' bancos somados',sh<0?'neg':'')+
    card('Base · saldo no fim',brl(base.final),'em '+addD(base.ini,base.N-1).toLocaleDateString('pt-BR'),base.final<0?'neg':'')+
    card('Base · menor saldo',brl(base.min),dia(base),base.min<S.colchao?'neg':'')+
    card('A realizar · base',`<span class="pos">+${k(base.fE)}</span> <span class="neg">−${k(base.fS)}</span>`,'provisionado: '+k(base.EP.slice(base.iH).reduce((a,b)=>a+b,0)+base.SP.slice(base.iH).reduce((a,b)=>a+b,0)))+
    `<div class="card kpi"><div class="l">Colchão mínimo de caixa</div><input class="num" id="colIn" value="${S.colchao.toLocaleString('pt-BR')}"><div class="s">linha tracejada âmbar no gráfico</div></div>`;
  $('#colIn').onchange=e=>{S.colchao=Number(e.target.value.replace(/\D/g,''))||0;try{localStorage.setItem('ff1.colchao',String(S.colchao))}catch{}renderSim()};
  // cabeçalho do herói
  $('#heroCen').textContent=ed.c.nome;$('#heroV').textContent=brl(ed.final);$('#heroV').className='hero-v num'+(ed.final<0?' neg':'');
  const dv=ed.final-base.final;
  $('#heroS').innerHTML=(ed===base?'':`<b class="${dv<0?'neg':'pos'}">${dv>0?'+':''}${brl(dv)}</b> vs base · `)+`menor saldo ${brl(ed.min)} em ${dia(ed)}`+(ed.need?` · <b class="neg">faltam ${brl(ed.need)} para o colchão</b>`:'');
  $('#cenLegend').innerHTML=CENS.map(c=>`<button class="${c.vis?'on':''}" data-v="${c.id}"><i style="background:${c.cor}"></i>${c.nome}</button>`).join('');
  $$('#cenLegend button').forEach(b=>b.onclick=()=>{const c=cen(b.dataset.v);c.vis=!c.vis;renderSim()});
  drawHero();drawFlows(ed,base);renderCmp();renderDia();
}
function faixa(N,iH){if(S.zoom){const a=Math.max(0,Math.min(S.zoom[0],N-2)),z=Math.min(N-1,Math.max(S.zoom[1],a+1));return [a,z]}
  if(S.vista==='passado')return [0,Math.max(1,iH)];if(S.vista==='futuro')return [Math.min(iH,N-2),N-1];return [0,N-1]}
function drawHero(semBrush){
  const wrap=$('#heroWrap');const W=Math.max(320,wrap.clientWidth),H=Math.round(Math.min(440,Math.max(300,W*.42)));
  const vis=RES.filter(r=>r.c.vis);const b=RES[0];const N=b.N,iH=b.iH;const ed=RES.find(r=>r.c.id===S.edit)||b;
  const [a,z]=faixa(N,iH);
  const pl=8,pr=66,pt=16,pb=26,barH=Math.round(H*.2),gap=14;const yTop=pt,yBot=H-pb-barH-gap;
  // escala ajustada à faixa visível
  let lo=Infinity,hi=-Infinity;const acc=v=>{if(v<lo)lo=v;if(v>hi)hi=v};
  for(let i=a;i<=z;i++){if(i<=iH)acc(b.sal[i]);if(i>=iH)vis.forEach(r=>{acc(r.sal[i]);if(r===b&&S.banda){acc(b.sal[i]+b.band[i]);acc(b.sal[i]-b.band[i])}})}
  if(S.zero){lo=Math.min(lo,0,S.colchao);hi=Math.max(hi,0,S.colchao)}
  else{const span=hi-lo||1;if(S.colchao>lo-span*.25&&S.colchao<hi+span*.25){lo=Math.min(lo,S.colchao);hi=Math.max(hi,S.colchao)}}
  const pad=(hi-lo)*.08||1000;lo-=pad;hi+=pad;
  const X=i=>pl+(W-pl-pr)*(i-a)/(z-a),Y=v=>yTop+(yBot-yTop)*(1-(v-lo)/(hi-lo));
  const line=(arr,f,t)=>{f=Math.max(f,a);t=Math.min(t,z);if(t<f)return '';let p='';for(let i=f;i<=t;i++)p+=(i===f?'M':'L')+X(i).toFixed(1)+' '+Y(arr[i]).toFixed(1);return p};
  let g=`<svg width="${W}" height="${H}" id="heroSvg"><defs>
    <linearGradient id="ga" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--sf)" stop-opacity=".22"/><stop offset="1" stop-color="var(--sf)" stop-opacity="0"/></linearGradient>
    <linearGradient id="gp" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--tx2)" stop-opacity=".14"/><stop offset="1" stop-color="var(--tx2)" stop-opacity="0"/></linearGradient>
    <clipPath id="clipP"><rect x="${pl}" y="${yTop}" width="${W-pl-pr}" height="${yBot-yTop}"/></clipPath></defs>`;
  for(let t=0;t<=5;t++){const v=lo+(hi-lo)*t/5;g+=`<line x1="${pl}" x2="${W-pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-dasharray="${t?'2 4':''}"/><text x="${W-pr+8}" y="${Y(v)+3}">${k(v)}</text>`}
  // eixo x: meses em janela longa, dias em janela curta
  const dias=z-a;const passo=dias<=21?1:dias<=60?7:0;
  for(let i=a;i<=z;i++){const d=addD(b.ini,i);const marca=passo?((passo===1)||(d.getDay()===1)):d.getDate()===1;
    if(marca){g+=`<line x1="${X(i)}" x2="${X(i)}" y1="${yTop}" y2="${H-pb}" stroke="var(--line)" opacity=".55"/><text x="${X(i)+3}" y="${H-pb+16}">${passo?dBR(d):MES[d.getMonth()]+(d.getMonth()===0?'/'+String(d.getFullYear()).slice(2):'')}</text>`}}
  g+=`<g clip-path="url(#clipP)">`;
  if(lo<0)g+=`<rect x="${pl}" y="${Y(0)}" width="${W-pl-pr}" height="${Math.max(0,yBot-Y(0))}" fill="var(--out)" opacity=".06"/><line x1="${pl}" x2="${W-pr}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--out)" opacity=".5"/>`;
  if(a<iH){g+=`<rect x="${pl}" y="${yTop}" width="${X(Math.min(iH,z))-pl}" height="${yBot-yTop}" fill="var(--panel2)" opacity=".35"/>`;
    g+=`<path d="${line(b.sal,0,iH)} L${X(Math.min(iH,z))} ${yBot} L${X(a)} ${yBot}Z" fill="url(#gp)"/><path d="${line(b.sal,0,iH)}" fill="none" stroke="var(--tx2)" stroke-width="2"/>`}
  if(b.c.vis&&z>=iH){const f=Math.max(iH,a);
    if(S.banda){let up='',dn='';for(let i=f;i<=z;i++)up+=(i===f?'M':'L')+X(i).toFixed(1)+' '+Y(b.sal[i]+b.band[i]).toFixed(1);for(let i=z;i>=f;i--)dn+='L'+X(i).toFixed(1)+' '+Y(b.sal[i]-b.band[i]).toFixed(1);g+=`<path d="${up}${dn}Z" fill="var(--sf)" opacity=".08"/>`}
    g+=`<path d="${line(b.sal,iH,N-1)} L${X(z)} ${yBot} L${X(f)} ${yBot}Z" fill="url(#ga)"/>`}
  if(S.colchao>=lo&&S.colchao<=hi)g+=`<line x1="${pl}" x2="${W-pr}" y1="${Y(S.colchao)}" y2="${Y(S.colchao)}" stroke="var(--amber)" stroke-dasharray="6 5" stroke-width="1.4"/><text x="${pl+4}" y="${Y(S.colchao)-5}" style="fill:var(--amber);font-weight:700">colchão ${k(S.colchao)}</text>`;
  if(z>=iH)vis.slice().reverse().forEach(r=>{const base=r.c.id==='base';
    g+=`<path d="${line(r.sal,iH,N-1)}" fill="none" stroke="${r.c.cor}" stroke-width="${base?2.6:2}" stroke-linejoin="round"/>`;
    if(r.minI>=a&&r.minI<=z)g+=`<circle cx="${X(r.minI)}" cy="${Y(r.min)}" r="4" fill="var(--panel)" stroke="${r.c.cor}" stroke-width="2"/>`;
    if(z===N-1)g+=`<circle cx="${X(N-1)}" cy="${Y(r.final)}" r="3" fill="${r.c.cor}"/>`;
    r.marks.forEach(m=>{if(m.i<a||m.i>z)return;const x=X(m.i),y=Y(r.sal[m.i]);g+=`<path d="M${x} ${y-6} L${x+5} ${y} L${x} ${y+6} L${x-5} ${y}Z" fill="${m.e.nat==='E'?'var(--in)':'var(--out)'}" stroke="var(--panel)" stroke-width="1.2"><title>${m.e.desc} · ${m.e.nat==='E'?'+':'−'}${brl(m.e.valor)}</title></path>`})});
  g+=`</g>`;
  if(colchaoFora(lo,hi))g+=`<text x="${pl+4}" y="${S.colchao<lo?yBot-4:yTop+12}" style="fill:var(--amber);font-weight:700">colchão ${k(S.colchao)} ${S.colchao<lo?'↓':'↑'} fora da escala</text>`;
  // variação diária (barras do resultado do dia)
  const vb0=yBot+gap,vb1=H-pb,vm=(vb0+vb1)/2;const fonte=ed;let mx=1;for(let i=a;i<=z;i++)mx=Math.max(mx,Math.abs(fonte.E[i]-fonte.S[i]));
  g+=`<text x="${pl}" y="${vb0-3}" style="font-weight:700">variação diária${fonte!==b?' · '+fonte.c.nome:''}</text><line x1="${pl}" x2="${W-pr}" y1="${vm}" y2="${vm}" stroke="var(--line2)"/><text x="${W-pr+8}" y="${vb0+8}">+${k(mx)}</text><text x="${W-pr+8}" y="${vb1}">−${k(mx)}</text>`;
  const bwD=Math.max(1,(W-pl-pr)/(z-a+1)*.7);
  for(let i=a;i<=z;i++){const v=fonte.E[i]-fonte.S[i];if(!v)continue;const h=Math.abs(v)/mx*(vb1-vb0)/2;g+=`<rect x="${X(i)-bwD/2}" y="${v>0?vm-h:vm}" width="${bwD}" height="${Math.max(1,h)}" fill="${v>0?'var(--in)':'var(--out)'}" opacity="${i<iH?.45:.9}" rx="${bwD>4?1.5:0}"/>`}
  if(iH>=a&&iH<=z)g+=`<line x1="${X(iH)}" x2="${X(iH)}" y1="${yTop}" y2="${H-pb}" stroke="var(--tx)" opacity=".5"/><text x="${X(iH)+5}" y="${yTop+10}" style="fill:var(--tx);font-weight:700">hoje</text>`;
  g+=`<line id="cross" x1="0" x2="0" y1="${yTop}" y2="${H-pb}" stroke="var(--tx3)" stroke-dasharray="3 3" style="display:none"/><g id="crossDots"></g>`;
  g+=`<rect x="${pl}" y="${yTop}" width="${W-pl-pr}" height="${H-pb-yTop}" fill="transparent" id="hit" style="cursor:crosshair"/></svg>`;
  $('#hero').innerHTML=g;
  const hit=$('#hit'),tip=$('#tip'),cross=$('#cross');
  const idxAt=ev=>{const rc=$('#heroSvg').getBoundingClientRect();return Math.max(a,Math.min(z,a+Math.round((ev.clientX-rc.left-pl)/(W-pl-pr)*(z-a))))};
  hit.onmousemove=ev=>{const i=idxAt(ev);const d=addD(b.ini,i);cross.setAttribute('x1',X(i));cross.setAttribute('x2',X(i));cross.style.display='';
    $('#crossDots').innerHTML=(i<iH?[b]:vis).map(r=>`<circle cx="${X(i)}" cy="${Y(r.sal[i])}" r="4" fill="${i<iH?'var(--tx2)':r.c.cor}" stroke="var(--panel)" stroke-width="2"/>`).join('');
    const ant=i>0?b.sal[i-1]:b.sal[i];
    const rows=(i<iH?[b]:vis).map(r=>{const dv=r.sal[i]-b.sal[i];return `<div class="r"><span><i style="background:${i<iH?'var(--tx2)':r.c.cor}"></i>${i<iH?'Realizado':r.c.nome}</span><b class="num ${r.sal[i]<0?'neg':''}">${brl(r.sal[i])}${r.c.id!=='base'&&i>=iH&&Math.abs(dv)>1?` <span class="mini ${dv<0?'neg':'pos'}">${dv>0?'+':''}${k(dv)}</span>`:''}</b></div>`}).join('');
    const net=fonte.E[i]-fonte.S[i];
    tip.innerHTML=`<div class="mini" style="margin-bottom:4px;font-weight:700">${d.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short',year:'numeric'})}${i<iH?' · realizado':''}</div>${rows}<div class="r mini" style="border-top:1px solid var(--line);margin-top:4px;padding-top:4px"><span>Entradas · saídas do dia</span><span><span class="pos">+${brl(fonte.E[i])}</span> · <span class="neg">−${brl(fonte.S[i])}</span></span></div><div class="r"><span class="mini">Variação do dia</span><b class="num ${net<0?'neg':'pos'}">${net>0?'+':''}${brl(net)}</b></div>`;
    tip.style.display='block';const tw=tip.offsetWidth;let lx=X(i)+14;if(lx+tw>W)lx=X(i)-tw-14;tip.style.left=lx+'px';tip.style.top='10px'};
  hit.onmouseleave=()=>{tip.style.display='none';cross.style.display='none';$('#crossDots').innerHTML=''};
  hit.onclick=ev=>{const i=idxAt(ev);const dd=addD(b.ini,i);
    const items=lancFiltrados().filter(x=>{const q=x.dataEf;return q.getFullYear()===dd.getFullYear()&&q.getMonth()===dd.getMonth()&&q.getDate()===dd.getDate()});
    abrirBucket({items,past:dd<HOJE,lbl:dBR(dd),b:dd})};
  // roda do mouse = zoom no ponto
  hit.onwheel=ev=>{ev.preventDefault();const i=idxAt(ev);const f=ev.deltaY>0?1.25:.8;let na=Math.round(i-(i-a)*f),nz=Math.round(i+(z-i)*f);na=Math.max(0,na);nz=Math.min(N-1,nz);if(nz-na<7)return;S.zoom=[na,nz];renderVista()};
  if(!semBrush)drawBrush(a,z);
  const zl=$('#zoomLbl');zl.innerHTML=`${addD(b.ini,a).toLocaleDateString('pt-BR')} → ${addD(b.ini,z).toLocaleDateString('pt-BR')} · ${z-a+1} dias`+(S.zoom?` · <a href="#" id="zoomReset" style="color:var(--sf)">desfazer zoom</a>`:'');
  const zr=$('#zoomReset');if(zr)zr.onclick=e=>{e.preventDefault();S.zoom=null;renderVista()};
}
function colchaoFora(lo,hi){return S.colchao<lo||S.colchao>hi}
function renderVista(){drawHero();const ed=RES.find(r=>r.c.id===S.edit)||RES[0];drawFlows(ed,RES[0]);renderDia();
  $$('#segVista button').forEach(x=>x.classList.toggle('on',!S.zoom&&x.dataset.v===S.vista))}
// navegador (brush): arraste para escolher o trecho; puxe as bordas para ajustar
function drawBrush(a,z){
  const b=RES[0];const W=Math.max(320,$('#heroWrap').clientWidth),H=54,pl=8,pr=66;const N=b.N;
  let lo=Infinity,hi=-Infinity;for(const v of b.sal){if(v<lo)lo=v;if(v>hi)hi=v}
  const X=i=>pl+(W-pl-pr)*i/(N-1),Y=v=>6+(H-12)*(1-(v-lo)/((hi-lo)||1));
  let p='';for(let i=0;i<N;i++)p+=(i?'L':'M')+X(i).toFixed(1)+' '+Y(b.sal[i]).toFixed(1);
  const x0=X(a),x1=X(z);
  $('#brush').innerHTML=`<svg width="${W}" height="${H}" id="brushSvg" style="cursor:crosshair">
    <rect x="${pl}" y="0" width="${W-pl-pr}" height="${H}" rx="8" fill="var(--panel2)"/>
    <path d="${p}" fill="none" stroke="var(--tx3)" stroke-width="1.2"/>
    <line x1="${X(b.iH)}" x2="${X(b.iH)}" y1="0" y2="${H}" stroke="var(--tx2)" stroke-dasharray="2 2"/>
    <rect x="${pl}" y="0" width="${Math.max(0,x0-pl)}" height="${H}" fill="var(--bg)" opacity=".55"/>
    <rect x="${x1}" y="0" width="${Math.max(0,W-pr-x1)}" height="${H}" fill="var(--bg)" opacity=".55"/>
    <rect id="bSel" x="${x0}" y="1" width="${Math.max(2,x1-x0)}" height="${H-2}" rx="6" fill="var(--sf)" fill-opacity=".08" stroke="var(--sf)" stroke-width="1.5" style="cursor:grab"/>
    <rect id="bL" x="${x0-4}" y="${H/2-12}" width="8" height="24" rx="3" fill="var(--sf)" style="cursor:ew-resize"/>
    <rect id="bR" x="${x1-4}" y="${H/2-12}" width="8" height="24" rx="3" fill="var(--sf)" style="cursor:ew-resize"/>
  </svg>`;
  const svg=$('#brushSvg');const toI=cx=>{const rc=svg.getBoundingClientRect();return Math.max(0,Math.min(N-1,Math.round((cx-rc.left-pl)/(W-pl-pr)*(N-1))))};
  let mode=null,start=0,za=a,zz=z;
  const sel=(na,nz)=>{const x0=X(na),x1=X(nz);$('#bSel').setAttribute('x',x0);$('#bSel').setAttribute('width',Math.max(2,x1-x0));$('#bL').setAttribute('x',x0-4);$('#bR').setAttribute('x',x1-4)};
  const down=(m)=>ev=>{ev.preventDefault();ev.stopPropagation();mode=m;start=toI(ev.clientX);za=a;zz=z;if(m==='new'){za=zz=start}
    const mv=e=>{const i=toI(e.clientX);let na=za,nz=zz;
      if(mode==='move'){const d=i-start;na=za+d;nz=zz+d;if(na<0){nz-=na;na=0}if(nz>N-1){na-=nz-(N-1);nz=N-1}}
      else if(mode==='L')na=Math.min(i,zz-3);else if(mode==='R')nz=Math.max(i,za+3);else{na=Math.min(start,i);nz=Math.max(start,i)}
      if(nz-na>=3){S.zoom=[na,nz];sel(na,nz);drawHero(true);const ed=RES.find(r=>r.c.id===S.edit)||RES[0];drawFlows(ed,RES[0])}};
    const up=()=>{document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);mode=null;renderVista()};
    document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up)};
  $('#bSel').onmousedown=(z-a)>=(N-1)*.95?down('new'):down('move');$('#bL').onmousedown=down('L');$('#bR').onmousedown=down('R');svg.onmousedown=down('new');
  svg.ondblclick=()=>{S.zoom=null;renderVista()};
}
function drawFlows(r,b){
  const wrap=$('#heroWrap');const W=Math.max(320,wrap.clientWidth);
  const [fa,fz]=faixa(r.N,r.iH);const nD=fz-fa+1;const gran=S.fg==='auto'?(nD<=35?'dia':nD/7>20?'mes':'semana'):S.fg;
  $$('#segFlow button').forEach(x=>x.classList.toggle('on',x.dataset.f===S.fg));
  // períodos
  const per=[];
  if(gran==='dia'){for(let i=fa;i<=fz;i++)per.push([i,i])}
  else if(gran==='semana'){for(let i=fa;i<=fz;i+=7)per.push([i,Math.min(fz,i+6)])}
  else{let i=fa;while(i<=fz){const d=addD(r.ini,i);const fimM=new Date(d.getFullYear(),d.getMonth()+1,0);const j=Math.min(fz,i+Math.round((fimM-d)/864e5));per.push([i,j]);i=j+1}}
  const P=per.map(([a,z])=>{let e=0,s=0,eb=0,sb=0,ep=0,sp=0;for(let j=a;j<=z;j++){e+=r.E[j];s+=r.S[j];eb+=b.E[j];sb+=b.S[j];ep+=r.EP[j];sp+=r.SP[j]}
    const d=addD(r.ini,a);return {a,z,e,s,eb,sb,ep,sp,past:z<r.iH,cur:a<=r.iH&&z>=r.iH,
      lbl:gran==='mes'?MES[d.getMonth()]+(d.getMonth()===0?'/'+String(d.getFullYear()).slice(2):''):dBR(d)}});
  // totais (de hoje até o fim)
  const tE=P.reduce((q,p)=>q+p.e,0),tS=P.reduce((q,p)=>q+p.s,0);
  $('#flowsTot').innerHTML=`<span><span class="mini">Entradas no trecho</span><b class="pos num">${brl(tE)}</b></span><span><span class="mini">Saídas no trecho</span><b class="neg num">${brl(tS)}</b></span><span><span class="mini">Resultado</span><b class="num ${tE-tS<0?'neg':'pos'}">${tE-tS>0?'+':''}${brl(tE-tS)}</b></span>`;
  $('#flowsLbl').textContent=(r===b?'cenário base':r.c.nome+' · contorno tracejado = base')+' · '+({dia:'por dia',semana:'por semana',mes:'por mês'}[gran])+' · mesmo trecho do gráfico acima';
  const P0=P.filter(p=>p.e||p.s||p.eb||p.sb);P.length=0;P.push(...P0);const Wf=Math.max(W,P.length*(gran==='dia'?46:52)+70);
  const H=Math.round(Math.min(340,Math.max(240,W*.26))),pl=8,pr=62,pt=24,pb=44;
  const mx=Math.max(1,...P.map(p=>Math.max(p.e,p.s,r===b?0:Math.max(p.eb,p.sb))));
  const bw=(Wf-pl-pr)/P.length;const mid=pt+(H-pt-pb)/2;const half=(H-pt-pb)/2-14;const y=v=>v/mx*half;
  const showLbl=true, fs=bw>=60?11.5:10.5;
  let g=`<svg width="${Wf}" height="${H}" id="flowSvg"><defs>
    <pattern id="fhi" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="5" fill="var(--in)"/></pattern>
    <pattern id="fho" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="5" fill="var(--out)"/></pattern></defs>`;
  [1,.5].forEach(f=>{g+=`<line x1="${pl}" x2="${Wf-pr}" y1="${mid-y(mx*f)}" y2="${mid-y(mx*f)}" stroke="var(--line)" stroke-dasharray="2 4"/><text x="${Wf-pr+8}" y="${mid-y(mx*f)+3}">+${k(mx*f)}</text><line x1="${pl}" x2="${Wf-pr}" y1="${mid+y(mx*f)}" y2="${mid+y(mx*f)}" stroke="var(--line)" stroke-dasharray="2 4"/><text x="${Wf-pr+8}" y="${mid+y(mx*f)+3}">−${k(mx*f)}</text>`});
  P.forEach((p,n)=>{const x0=pl+n*bw;const x=x0+bw*.16,ww=bw*.68,cx=x0+bw/2;const op=p.past?.5:1;
    if(p.past)g+=`<rect x="${x0}" y="${pt-18}" width="${bw}" height="${H-pt-pb+30}" fill="var(--panel2)" opacity=".35"/>`;
    if(p.cur)g+=`<rect x="${x0}" y="${pt-18}" width="${bw}" height="${H-pt-pb+30}" fill="var(--sf)" opacity=".06"/>`;
    const eR=p.e-p.ep,sR=p.s-p.sp;
    g+=`<rect x="${x}" y="${mid-y(eR)}" width="${ww}" height="${y(eR)}" rx="3" fill="var(--in)" opacity="${op}"/>`;
    if(p.ep>0)g+=`<rect x="${x}" y="${mid-y(p.e)}" width="${ww}" height="${y(p.ep)}" fill="url(#fhi)" stroke="var(--in)" stroke-width=".8" opacity="${op}"/>`;
    g+=`<rect x="${x}" y="${mid}" width="${ww}" height="${y(sR)}" rx="3" fill="var(--out)" opacity="${op}"/>`;
    if(p.sp>0)g+=`<rect x="${x}" y="${mid+y(sR)}" width="${ww}" height="${y(p.sp)}" fill="url(#fho)" stroke="var(--out)" stroke-width=".8" opacity="${op}"/>`;
    if(r!==b&&!p.past)g+=`<rect x="${x}" y="${mid-y(p.eb)}" width="${ww}" height="${y(p.eb)}" fill="none" stroke="var(--tx2)" stroke-dasharray="3 2"/><rect x="${x}" y="${mid}" width="${ww}" height="${y(p.sb)}" fill="none" stroke="var(--tx2)" stroke-dasharray="3 2"/>`;
    if(showLbl){
      if(p.e)g+=`<text x="${cx}" y="${mid-y(p.e)-5}" text-anchor="middle" style="fill:var(--in);font-weight:700;font-size:${fs}px">${k(p.e)}</text>`;
      if(p.s)g+=`<text x="${cx}" y="${mid+y(p.s)+13}" text-anchor="middle" style="fill:var(--out);font-weight:700;font-size:${fs}px">${k(p.s)}</text>`;}
    const net=p.e-p.s;
    g+=`<text x="${cx}" y="${H-pb+18}" text-anchor="middle" style="font-size:${fs}px;${p.cur?'fill:var(--tx);font-weight:700':''}">${p.lbl}</text>`;
    if(showLbl||n%2===0)g+=`<text x="${cx}" y="${H-pb+33}" text-anchor="middle" style="font-size:${fs}px;font-weight:700;fill:${net<0?'var(--out)':'var(--in)'}">${net>0?'+':''}${k(net)}</text>`;
    g+=`<rect x="${x0}" y="${pt-18}" width="${bw}" height="${H-pt+10}" fill="transparent" data-p="${n}" style="cursor:pointer"><title>${p.lbl}${p.past?' (realizado)':''}
Entradas ${brl(p.e)}${p.ep?' · provisionado '+brl(p.ep):''}
Saídas ${brl(p.s)}${p.sp?' · provisionado '+brl(p.sp):''}
Resultado ${brl(net)}${r!==b&&!p.past?'\nBase: +'+brl(p.eb)+' / −'+brl(p.sb):''}</title></rect>`});
  g+=`<line x1="${pl}" x2="${Wf-pr}" y1="${mid}" y2="${mid}" stroke="var(--line2)"/><text x="${Wf-pr+8}" y="${H-pb+33}" style="font-weight:700">resultado</text></svg>`;
  const fl=$('#flows');fl.innerHTML=g;const ic=P.findIndex(p=>p.cur);if(Wf>W&&ic>=0)fl.scrollLeft=Math.max(0,pl+ic*bw-W*.35);
  $$('#flowSvg rect[data-p]').forEach(el=>el.onclick=()=>{const p=P[+el.dataset.p];const a=addD(r.ini,p.a),z=addD(r.ini,p.z);
    const items=lancFiltrados().filter(x=>x.dataEf>=a&&x.dataEf<addD(z,1));abrirBucket({items,past:p.past,lbl:dBR(a),b:z})});
}
function renderCmp(){
  const b=RES[0];const dia=r=>addD(r.ini,r.minI).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'});
  const rows=[
    ['Saldo no fim da janela',r=>`<b class="${r.final<0?'neg':''}">${brl(r.final)}</b>`],
    ['Δ vs base',r=>r.c.id==='base'?'<span class="muted">—</span>':`<span class="${r.final-b.final<0?'neg':'pos'}">${r.final-b.final>0?'+':''}${brl(r.final-b.final)}</span>`],
    ['Menor saldo',r=>`<span class="${r.min<S.colchao?'neg':''}">${brl(r.min)}</span><div class="mini">${dia(r)}</div>`],
    ['Dias abaixo do colchão',r=>r.abaixo?`<b class="neg">${r.abaixo}</b>`:'<span class="pos">0</span>'],
    ['Necessidade de caixa',r=>r.need?`<b class="neg">${brl(r.need)}</b>`:'<span class="pos">—</span>'],
    ['Entradas a realizar',r=>brl(r.fE)],['Saídas a realizar',r=>brl(r.fS)],
  ];
  $('#cmp').innerHTML=`<thead><tr><th></th>${RES.map(r=>`<th class="r" style="${r.c.vis?'':'opacity:.5'}"><span class="cmp-sw" style="background:${r.c.cor}"></span>${r.c.nome}</th>`).join('')}</tr></thead><tbody>${rows.map(([l,f])=>`<tr><td>${l}</td>${RES.map(r=>`<td class="r" style="${r.c.vis?'':'opacity:.5'}">${f(r)}</td>`).join('')}</tr>`).join('')}</tbody>`;
}
function renderEditor(){
  $('#cenTabs').innerHTML=CENS.map(c=>`<button class="${c.id===S.edit?'on':''}" data-e="${c.id}"><span class="cmp-sw" style="background:${c.cor};margin:0"></span>${c.nome}</button>`).join('');
  $$('#cenTabs button').forEach(b=>b.onclick=()=>{S.edit=b.dataset.e;renderEditor();renderSim()});
  const c=cen(S.edit);const venc=REC_VENC.filter(x=>S.emps.has(x.emp)).reduce((a,x)=>a+x.valor,0);
  let h='';
  if(c.fixo){h+=`<div class="alert ok" style="margin-top:0">O <b>Base</b> é o fluxo como está nos títulos (com as chaves acima). Para simular, <b>duplique</b> ou escolha outro cenário.</div>`}
  else{
    h+=`<div class="row2" style="grid-template-columns:1fr 70px;gap:8px"><input class="nm" id="cNome" value="${c.nome}" style="background:var(--panel2);border:1px solid var(--line2);border-radius:8px;padding:7px 9px"><input type="color" id="cCor" value="${c.cor.startsWith('#')?c.cor:'#f59e0b'}" style="width:100%;height:34px;border:1px solid var(--line2);border-radius:8px;background:none"></div>`;
    h+=`<div class="sec">Alavancas<button class="btn sm ghost" id="zerar">zerar</button></div>`;
    h+=LEVS.map(L=>`<div class="lev" style="--cc:${c.cor}"><div class="h"><span>${L.l}</span><b id="lv_${L.k}">${L.k==='recDias'?'':sgn(c.lev[L.k])}${L.k==='recDias'?c.lev[L.k]:''}${L.u}</b></div><input type="range" min="${L.min}" max="${L.max}" step="${L.st}" value="${c.lev[L.k]}" data-l="${L.k}" style="--p:${(c.lev[L.k]-L.min)/(L.max-L.min)*100}%"><div class="d">${L.dyn?'Vencidos a receber hoje: '+brl(venc)+' (fora do base).':L.d}</div></div>`).join('');
  }
  h+=`<div class="sec">Linhas de simulação (eventos)<button class="btn sm ghost" id="addEv">+ evento</button></div>
   <div class="evform" id="evForm">
     <input id="eDesc" placeholder="Descrição — ex.: novo contrato hospital X">
     <div class="row2"><select id="eNat"><option value="E">Entrada</option><option value="S">Saída</option></select><input id="eVal" placeholder="Valor R$" inputmode="decimal"></div>
     <div class="row2"><input id="eData" type="date" value="${iso(addD(HOJE,30))}"><select id="eRep"><option value="1">uma vez</option><option value="3">mensal ×3</option><option value="6">mensal ×6</option><option value="12">mensal ×12</option></select></div>
     <select id="eEmp">${[...S.emps].map(e=>`<option>${e}</option>`).join('')}</select>
     <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:8px"><button class="btn sm" id="eCancel">cancelar</button><button class="btn sm pri" id="eOk">adicionar ${c.fixo?'(em novo cenário)':'a '+c.nome}</button></div>
   </div>`;
  h+=EVENTOS.map(e=>`<div class="ev"><input type="checkbox" data-ev="${e.id}" ${c.ev.has(e.id)?'checked':''} ${c.fixo?'disabled':''}><div><div class="t">${e.desc}</div><div class="mini">${e.emp} · ${new Date(e.data+'T12:00').toLocaleDateString('pt-BR')}${e.rep>1?' · mensal ×'+e.rep:''} · <a href="#" data-lan="${e.id}" style="color:var(--sf)" title="Cria a conta no + Nova conta, marcada como valor estimado">lançar</a></div></div><div style="text-align:right"><b class="${e.nat==='E'?'pos':'neg'} num">${e.nat==='E'?'+':'−'}${k(e.valor)}</b><br><button class="x" data-del="${e.id}" title="remover">×</button></div></div>`).join('');
  if(!c.fixo)h+=`<div style="display:flex;gap:8px;margin-top:14px"><button class="btn sm" id="delCen" style="color:var(--out)">Excluir</button><span style="flex:1"></span><span class="tog" id="shareTog"><i></i>compartilhar</span><button class="btn sm pri" id="saveCen">Salvar cenário</button></div>`;
  $('#cenEdit').innerHTML=h;
  $$('#cenEdit input[type=range]').forEach(r=>r.oninput=()=>{const L=r.dataset.l;const D0=LEVS.find(x=>x.k===L);r.style.setProperty('--p',(r.value-D0.min)/(D0.max-D0.min)*100+'%');c.lev[L]=+r.value;const D=LEVS.find(x=>x.k===L);$('#lv_'+L).textContent=(L==='recDias'?r.value:sgn(+r.value))+D.u;c.vis=true;renderSim()});
  $$('#cenEdit [data-ev]').forEach(cb=>cb.onchange=()=>{const id=+cb.dataset.ev;cb.checked?c.ev.add(id):c.ev.delete(id);c.vis=true;renderSim()});
  $$('#cenEdit [data-del]').forEach(b=>b.onclick=()=>{const id=+b.dataset.del;api({acao:'excluir_evento',id}).then(()=>{EVENTOS=EVENTOS.filter(e=>e.id!==id);CENS.forEach(c=>c.ev.delete(id));renderEditor();renderSim()}).catch(er=>toast(er.message))});
  $$('#cenEdit [data-lan]').forEach(a=>a.onclick=ev=>{ev.preventDefault();const e=EVENTOS.find(x=>x.id===+a.dataset.lan);if(e)o.onLancar({tipo:e.nat==='E'?'receber':'pagar',empresa:e.emp,valor:e.valor,vencimento:e.data,obs:e.desc+' (do simulador do fluxo)',recorrencia:e.rep})});
  const nm=$('#cNome');if(nm)nm.oninput=()=>{c.nome=nm.value||'Cenário';renderSim();$$('#cenTabs button.on')[0].lastChild.textContent=c.nome};
  const cc=$('#cCor');if(cc)cc.oninput=()=>{c.cor=cc.value;renderSim();renderEditorTabsOnly()};
  const z=$('#zerar');if(z)z.onclick=()=>{c.lev={...LEV0};renderEditor();renderSim()};
  $('#addEv').onclick=()=>$('#evForm').classList.toggle('open');
  $('#eCancel').onclick=()=>$('#evForm').classList.remove('open');
  $('#eOk').onclick=()=>{const v=parseV($('#eVal').value);const desc=$('#eDesc').value.trim();if(!desc||!v){toast('Descrição e valor');return}
    const novo={descricao:desc,natureza:$('#eNat').value,valor:v,data:$('#eData').value||iso(addD(HOJE,30)),repeticoes:+$('#eRep').value,empresa:$('#eEmp').value};
    api({acao:'criar_evento',evento:novo}).then(j=>{const x=j.evento;const e={id:+x.id,desc:x.descricao,nat:x.natureza,valor:+x.valor,data:String(x.data).slice(0,10),rep:+x.repeticoes,emp:x.empresa};EVENTOS.push(e);
    let alvo=c;if(c.fixo){alvo=novoCen('Cenário '+(CENS.length));}
    alvo.ev.add(e.id);alvo.vis=true;S.edit=alvo.id;renderEditor();renderSim();toast('Evento adicionado a '+alvo.nome+' — salve o cenário para guardar')}).catch(er=>toast(er.message))};
  const dl=$('#delCen');if(dl)dl.onclick=()=>{const fim=()=>{CENS=CENS.filter(x=>x!==c);S.edit='base';renderEditor();renderSim()};if(c.salvo)api({acao:'excluir_cenario',id:c.id}).then(()=>{fim();toast('Cenário excluído')}).catch(er=>toast(er.message));else fim()};
  const sv=$('#saveCen');if(sv)sv.onclick=()=>{api({acao:'salvar_cenario',cenario:{id:c.salvo?c.id:undefined,nome:c.nome,cor:c.cor,alavancas:c.lev,eventos:[...c.ev],empresas:[...S.emps],compartilhado:!!c.share}}).then(j=>{const antes=c.id;c.id=j.cenario.id;c.salvo=true;if(S.edit===antes)S.edit=c.id;renderEditor();toast('Cenário salvo'+(c.share?' · visível para o financeiro':''))}).catch(er=>toast(er.message))};
  const sh=$('#shareTog');if(sh){sh.classList.toggle('on',!!c.share);sh.onclick=()=>{c.share=!c.share;sh.classList.toggle('on',c.share);toast((c.share?'Visível para o financeiro':'Só para você')+' — salve para valer')}}
}
function renderEditorTabsOnly(){$$('#cenTabs button').forEach(b=>{const c=cen(b.dataset.e);b.querySelector('.cmp-sw').style.background=c.cor})}
function novoCen(nome,base){const usados=CENS.map(c=>c.cor);const cor=PALETA.find(p=>!usados.includes(p))||PALETA[CENS.length%PALETA.length];
  const c={id:'c'+Date.now()+Math.floor(rnd()*99),nome,cor,vis:true,lev:base?{...base.lev}:{...LEV0},ev:new Set(base?base.ev:[])};CENS.push(c);return c}
$('#novoCen').onclick=()=>{const c=novoCen('Cenário '+CENS.length);S.edit=c.id;renderEditor();renderSim()};
$('#dupCen').onclick=()=>{const o=cen(S.edit);const c=novoCen(o.nome+' (cópia)',o);S.edit=c.id;renderEditor();renderSim()};
$$('#segFlow button').forEach(b=>b.onclick=()=>{S.fg=b.dataset.f;renderSim()});
$$('#segVista button').forEach(b=>b.onclick=()=>{S.vista=b.dataset.v;S.zoom=null;renderVista()});
let rz;const onResize=()=>{clearTimeout(rz);rz=setTimeout(()=>{if(vivo&&CONTAS.length)renderSim()},120)};window.addEventListener('resize',onResize);

/* ── Fluxo por EMPRESA: escolhe uma empresa e unifica os bancos marcados dela ── */

function renderChips(){
  $('#empChips').innerHTML=`<div class="seg">${Object.entries(EMP).map(([c,e])=>`<button class="${S.emps.has(c)?'on':''}" data-e="${c}"><i class="dot" style="background:${e.cor}"></i>${c} · ${e.nome}</button>`).join('')}</div>`;
  $$('#empChips button').forEach(b=>b.onclick=()=>{const c=b.dataset.e;if(S.emps.has(c))return;
    S.emps=new Set([c]);S.contas=contasIniciais(c);S.zoom=null;guardarEscolha();renderAll()});
}
function renderContas(){
  const emp=[...S.emps][0];const cs=CONTAS.filter(c=>c.emp===emp);const sel=cs.filter(c=>S.contas.has(c.id));
  const tot=sel.reduce((a,c)=>a+c.saldo,0);
  $('#bancos').innerHTML=`<span class="lbl">Bancos unificados</span>`+cs.map(c=>`<button class="bk ${S.contas.has(c.id)?'on':''}" data-c="${c.id}"><span class="ck">${S.contas.has(c.id)?'✓':''}</span><span>${c.nome}${c.pad?' <span class="mini">· padrão</span>':''}<b class="num ${c.saldo<0?'neg':''}">${brl(c.saldo)}</b></span></button>`).join('')+
    `<span class="bk-tot"><span class="mini">${sel.length} de ${cs.length} bancos · saldo unificado</span><b class="num ${tot<0?'neg':''}">${brl(tot)}</b></span>`;
  $$('#bancos .bk').forEach(b=>b.onclick=()=>{const id=+b.dataset.c;if(S.contas.has(id)){if(S.contas.size===1){toast('Deixe pelo menos um banco');return}S.contas.delete(id)}else S.contas.add(id);guardarEscolha();renderAll()});
}
/* ── Dia a dia do trecho escolhido (vista/zoom) ── */
Object.assign(S,{soMov:true,diaAbertos:new Set()});
function renderDia(){
  if(!RES.length)return;const b=RES[0];const r=RES.find(x=>x.c.id===S.edit)||b;const N=b.N,iH=b.iH;const [a,z]=faixa(N,iH);
  const outro=r!==b;let rows=[];
  for(let i=a;i<=z;i++){const ini=i?r.sal[i-1]:r.sal[0]-(r.E[0]-r.S[0]);const mov=r.E[i]||r.S[i];if(S.soMov&&!mov&&i!==iH)continue;rows.push(i)}
  let tE=0,tS=0;for(let i=a;i<=z;i++){tE+=r.E[i];tS+=r.S[i]}
  const dias=z-a+1,abaixo=rows.filter(i=>i>=iH&&r.sal[i]<S.colchao).length;
  $('#diaHead').innerHTML=`<b style="font-size:15px">Dia a dia</b><div class="mini">${addD(b.ini,a).toLocaleDateString('pt-BR')} → ${addD(b.ini,z).toLocaleDateString('pt-BR')} · ${dias} dias · ${r.c.nome}${outro?' (Δ contra o Base)':''} · segue a vista e o zoom do gráfico</div>`;
  $('#diaTot').innerHTML=`<span><span class="mini">Entradas</span><b class="pos num">${brl(tE)}</b></span><span><span class="mini">Saídas</span><b class="neg num">${brl(tS)}</b></span><span><span class="mini">Resultado</span><b class="num ${tE-tS<0?'neg':'pos'}">${tE-tS>0?'+':''}${brl(tE-tS)}</b></span><span><span class="mini">Saldo inicial → final</span><b class="num">${k(a?r.sal[a-1]:r.sal[0])} → ${k(r.sal[z])}</b></span>`;
  let mxS=1,mnS=0;rows.forEach(i=>{mxS=Math.max(mxS,r.sal[i]);mnS=Math.min(mnS,r.sal[i])});
  const barra=v=>{const w=(v-mnS)/((mxS-mnS)||1)*100;return `<div class="sbar"><i style="width:${Math.max(1,w)}%;background:${v<0?'var(--out)':v<S.colchao?'var(--amber)':'var(--sf)'}"></i></div>`};
  const sem=['dom','seg','ter','qua','qui','sex','sáb'];
  let h=`<thead><tr><th>Data</th><th class="r">Saldo inicial</th><th class="r">Entradas</th><th class="r">Saídas</th><th class="r">Variação</th><th class="r">Saldo final</th>${outro?'<th class="r">Δ base</th>':''}<th style="width:140px"></th><th></th></tr></thead><tbody>`;
  for(const i of rows){const d=addD(b.ini,i);const ini=i?r.sal[i-1]:r.sal[i]-(r.E[i]-r.S[i]);const net=r.E[i]-r.S[i];const past=i<iH;const open=S.diaAbertos.has(i);
    const its=r.its.filter(t=>t.i===i);const fds=d.getDay()===0||d.getDay()===6;
    h+=`<tr class="dr ${past?'past':''} ${i===iH?'hoje':''} ${r.sal[i]<S.colchao&&!past?'low':''}" data-i="${i}">
      <td><span class="car">${its.length?(open?'▾':'▸'):''}</span><b>${dBR(d)}</b> <span class="mini">${sem[d.getDay()]}${fds?' · fim de semana':''}${i===iH?' · <b style="color:var(--sf)">hoje</b>':''}${past?' · realizado':''}</span></td>
      <td class="r">${brl(ini)}</td>
      <td class="r pos">${r.E[i]?'+'+brl(r.E[i]):'<span class="muted">—</span>'}${r.EP[i]?`<span class="var pv"><i>${k(r.EP[i])} prov.</i></span>`:''}</td>
      <td class="r neg">${r.S[i]?'−'+brl(r.S[i]):'<span class="muted">—</span>'}${r.SP[i]?`<span class="var pv"><i>${k(r.SP[i])} prov.</i></span>`:''}</td>
      <td class="r"><b class="${net<0?'neg':net>0?'pos':'muted'}">${net?(net>0?'+':'')+brl(net):'—'}</b></td>
      <td class="r"><b class="${r.sal[i]<0?'neg':''}">${brl(r.sal[i])}</b></td>
      ${outro?`<td class="r ${r.sal[i]-b.sal[i]<0?'neg':'pos'}">${Math.abs(r.sal[i]-b.sal[i])>1?(r.sal[i]-b.sal[i]>0?'+':'')+k(r.sal[i]-b.sal[i]):'<span class="muted">—</span>'}</td>`:''}
      <td>${barra(r.sal[i])}</td><td class="mini">${its.length?its.length+' lanç.':''}</td></tr>`;
    if(open){its.sort((p,q)=>(p.nat===q.nat?q.v-p.v:p.nat==='E'?-1:1));
      h+=`<tr class="sub-l"><td colspan="${outro?9:8}"><div class="lancs">${its.map(t=>{const x=t.x,e=t.e;const nome=e?e.desc:x.contraparte;const sub=e?'evento simulado · '+r.c.nome:(x.grupo+(x.doc?' · '+x.doc:'')+(t.rec?' · recuperação simulada':'')+(t.mov?' · data movida pelo cenário (orig. '+dBR(x.dataEf)+')':'')+(x.late?' · vencido em '+dBR(x.data):''));
        const tag=e?'<span class="badge" style="background:color-mix(in srgb,'+r.c.cor+' 18%,transparent);color:var(--tx)">◆ simulado</span>':x.status==='realizado'?'<span class="badge b-real">realizado</span>':x.prov?'<span class="badge b-prov">provisionado</span>':x.late?'<span class="badge b-late">vencido</span>':'<span class="badge" style="background:var(--panel2)">a realizar</span>';
        return `<div class="ln"><span>${tag}</span><span><b>${nome}</b><div class="mini">${sub}</div></span><b class="num ${t.nat==='E'?'pos':'neg'}">${t.nat==='E'?'+':'−'}${brl(t.v)}</b></div>`}).join('')}</div></td></tr>`}}
  if(!rows.length)h+=`<tr><td colspan="9" class="muted">Sem movimento no trecho.</td></tr>`;
  $('#diaTbl').innerHTML=h+'</tbody>';
  $$('#diaTbl tr.dr').forEach(tr=>tr.onclick=()=>{const i=+tr.dataset.i;S.diaAbertos.has(i)?S.diaAbertos.delete(i):S.diaAbertos.add(i);renderDia()});
  const hj=$('#diaTbl tr.hoje'),sc=$('#diaScroll');if(hj&&!S._diaRolou){sc.scrollTop=Math.max(0,hj.offsetTop-120);S._diaRolou=true}
  $('#diaMov').classList.toggle('on',S.soMov);
}
$('#diaMov').onclick=()=>{S.soMov=!S.soMov;renderDia()};
$('#diaAbrir').onclick=()=>{const r=RES.find(x=>x.c.id===S.edit)||RES[0];const [a,z]=faixa(r.N,r.iH);if(S.diaAbertos.size){S.diaAbertos.clear()}else{for(let i=a;i<=z;i++)if(r.E[i]||r.S[i])S.diaAbertos.add(i)}renderDia()};
$('#diaCsv').onclick=()=>{const r=RES.find(x=>x.c.id===S.edit)||RES[0];const [a,z]=faixa(r.N,r.iH);const L2=[['data','saldo_inicial','entradas','entradas_prov','saidas','saidas_prov','variacao','saldo_final'].join(';')];
  for(let i=a;i<=z;i++){if(S.soMov&&!(r.E[i]||r.S[i]))continue;L2.push([iso(addD(r.ini,i)),(i?r.sal[i-1]:r.sal[i]).toFixed(2),r.E[i].toFixed(2),r.EP[i].toFixed(2),r.S[i].toFixed(2),r.SP[i].toFixed(2),(r.E[i]-r.S[i]).toFixed(2),r.sal[i].toFixed(2)].join(';'))}
  const el=document.createElement('a');el.href=URL.createObjectURL(new Blob([L2.join('\n')],{type:'text/csv'}));el.download='fluxo-dia-a-dia.csv';el.click();toast('CSV do dia a dia gerado')};
$('#diaIr').onclick=()=>{S.zoom=null;S.vista='futuro';const r=RES[0];S.zoom=[r.iH,Math.min(r.N-1,r.iH+29)];renderVista()};
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
    HOJE=dt(j.hoje);TEM_SNAP=false; // previsto × realizado: liga quando o Δ vier da foto diária (finance.fluxo_snapshot) — até lá, sem Δ
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
