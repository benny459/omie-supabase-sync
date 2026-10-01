import json,re,unicodedata,collections,statistics,datetime
pos=json.load(open('pos.json')); mov=json.load(open('mov.json')); pcs=json.load(open('pcs.json'))
HOJE=datetime.date(2026,10,1)
def norm(s):
    s=unicodedata.normalize('NFKD',s or '').encode('ascii','ignore').decode().upper()
    return s
def key(s): return re.sub(r'[^A-Z0-9]','',norm(s))
def clean(s):
    import html
    s=html.unescape(html.unescape((s or '').strip()))
    if s.startswith('"') and s.endswith('"') and s.count('"')>2: s=s[1:-1].replace('""','"')
    return re.sub(r'\s+',' ',s)
# dicionários de strings repetidas
D=[];Di={}
def S(x):
    if x is None: return -1
    if x not in Di: Di[x]=len(D); D.append(x)
    return Di[x]
itens=[]
for r in pos:
    idp,cod,desc,loc,s,pend,cmc,q90,ult,n,un,ncm,mn,res=r
    itens.append([idp,cod,clean(desc),S(loc),s,pend,cmc,q90,ult,n,un or '',ncm or '',mn or 0,res or 0])
prods={r[0] for r in itens}
# movimentos por produto
M=collections.defaultdict(list)
for m in mov:
    idp,dt,orig,q,sd,doc,val,canc,cli,proj,ped,loc=m
    M[idp].append([dt,S(orig),q,sd,doc or '',val,1 if canc=='S' else 0,S(cli),S(proj),ped or '',S(loc)])
# PCs: detalhe 24m + estatística de preço por fornecedor (tudo)
P=collections.defaultdict(list); ST=collections.defaultdict(lambda: collections.defaultdict(list))
lim=(HOJE-datetime.timedelta(days=730)).isoformat()
for p in pcs:
    idp,num,dt,forn,q,rec,unit,etapa,proj=p
    idp=int(idp)
    if unit and unit>0: ST[idp][forn or '(fornecedor não cadastrado)'].append((unit,dt))
    if dt and dt>=lim: P[idp].append([num,dt,S(forn),q,rec,unit,etapa,S(proj)])
PR={}
for idp,fs in ST.items():
    PR[idp]=[[S(f),len(v),min(x[0] for x in v),round(statistics.mean(x[0] for x in v),2),max(x[0] for x in v),max(x[1] for x in v)] for f,v in sorted(fs.items(),key=lambda kv:-len(kv[1]))]
# duplicidades: exatas (normalizadas) + similares por trigramas >=0.9
desc={}
for r in itens: desc.setdefault(r[0],r[2])
grp=collections.defaultdict(set)
for i,d in desc.items(): grp[key(d)].add(i)
dups=[[sorted(v),1.0,'exata'] for k,v in grp.items() if len(v)>1]
def nums(s): return sorted(re.findall(r'\d+(?:[.,/-]\d+)*',s or ''))
def palavras(s): return set(re.sub(r'[^A-Z0-9 ]',' ',norm(s)).split())
def variante(a,b):
    A,B=palavras(a),palavras(b)
    ua=[w for w in A-B if len(w)<=3]; ub=[w for w in B-A if len(w)<=3]
    return bool(ua and ub)
def tri(s):
    s=' '+re.sub(r'[^A-Z0-9 ]',' ',norm(s)).lower()
    out=set()
    for w in s.split():
        w='  '+w+' '
        out|={w[i:i+3] for i in range(len(w)-2)}
    return out
T={i:tri(d) for i,d in desc.items()}
ids=list(T); seen={frozenset(g[0]) for g in dups}
inv=collections.defaultdict(set)
for i in ids:
    for t in T[i]: inv[t].add(i)
pares=[]
for i in ids:
    cand=collections.Counter()
    for t in T[i]:
        if len(inv[t])<400:
            for j in inv[t]:
                if j>i: cand[j]+=1
    for j,c in cand.items():
        if c<3: continue
        sim=len(T[i]&T[j])/len(T[i]|T[j])
        if sim>=0.85 and key(desc[i])!=key(desc[j]) and nums(desc[i])==nums(desc[j]) and not variante(desc[i],desc[j]): pares.append([[i,j],round(sim,2),'similar'])
dups+=pares
print('itens',len(itens),'dups exatas',sum(1 for d in dups if d[2]=='exata'),'similares',len(pares),'strings',len(D))
data={'hoje':HOJE.isoformat(),'D':D,'itens':itens,'mov':M,'pcs':P,'precos':PR,'dups':dups}
s=json.dumps(data,ensure_ascii=False,separators=(',',':'))
open('data.js','w').write('window.__ESTOQUE__='+s+';')
print('bytes',len(s.encode()))
