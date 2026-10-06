import re, sys, math
G=open(sys.argv[1],encoding='utf-8').read(); A=open(sys.argv[2],encoding='utf-8').read()
def blocks(src, sel_re):
    out=[]
    for m in re.finditer(sel_re+r'\s*\{', src):
        i=m.end(); depth=1; j=i
        while depth:
            if src[j]=='{': depth+=1
            elif src[j]=='}': depth-=1
            j+=1
        out.append(src[i:j-1])
    return out
def props(body):
    d={}
    for m in re.finditer(r'(--[\w-]+)\s*:\s*([^;]+);', body): d[m.group(1)]=m.group(2).strip()
    return d
base={'l':{}, 'd':{}}
for b in blocks(G, r'(?m)^:root'): base['l'].update(props(b))
for b in blocks(G, r'(?m)^\.dark'): base['d'].update(props(b))
PAL=['teal','violet','indigo','esmeralda','ametista','grafite','ambar']
def srgb2lin(c): c/=255; return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def lin2srgb(c): c= 12.92*c if c<=0.0031308 else 1.055*c**(1/2.4)-0.055; return max(0,min(255,round(c*255)))
def to_oklab(rgb):
    r,g,b=[srgb2lin(x) for x in rgb]
    l=0.4122214708*r+0.5363325363*g+0.0514459929*b; m=0.2119034982*r+0.6806995451*g+0.1073969566*b; s=0.0883024619*r+0.2817188376*g+0.6299787005*b
    l,m,s=[x**(1/3) for x in (l,m,s)]
    return (0.2104542553*l+0.7936177850*m-0.0040720468*s, 1.9779984951*l-2.4285922050*m+0.4505937099*s, 0.0259040371*l+0.7827717662*m-0.8086757660*s)
def from_oklab(L,a,b):
    l=(L+0.3963377774*a+0.2158037573*b)**3; m=(L-0.1055613458*a-0.0638541728*b)**3; s=(L-0.0894841775*a-1.2914855480*b)**3
    return tuple(lin2srgb(x) for x in (4.0767416621*l-3.3077115913*m+0.2309699292*s, -1.2684380046*l+2.6097574011*m-0.3413193965*s, -0.0041960863*l-0.7034186147*m+1.7076147010*s))
def mix(tom, cor, p):
    A_=to_oklab(tom); B=to_oklab(cor); return from_oklab(*[A_[i]*p+B[i]*(1-p) for i in range(3)])
def trip(v):
    v=v.strip()
    if re.fullmatch(r'\d+\s+\d+\s+\d+',v): return tuple(int(x) for x in v.split())
    m=re.fullmatch(r'#([0-9a-fA-F]{6})',v)
    if m: h=m.group(1); return tuple(int(h[i:i+2],16) for i in (0,2,4))
    return None
hx=lambda t:'#%02x%02x%02x'%t
# alvo: (token triplet, [hex vars], dose claro, dose escuro)
ALVOS=[('--color-ww-bg',['--ww-bg','--ww-bg-grad'],.10,.12),
 ('--color-ww-sidebar',['--ww-sidebar'],.08,.10),
 ('--color-ww-drawerHead',[],.08,.10),
 ('--color-ww-panel',['--ww-panel','--ww-panel-grad'],.04,.07),
 ('--color-ww-drawer',[],.04,.07),
 ('--color-ww-rowL1',['--ww-row-l1'],.04,.07),
 ('--color-ww-rowL2',['--ww-row-l2'],.04,.07),
 ('--color-ww-panelSunken',['--ww-panel-sunken'],.08,.10),
 ('--color-ww-rowL0',['--ww-row-l0'],.08,.10),
 ('--color-ww-track',[],.08,.10),
 ('--color-ww-rowHover',[],.12,.14),
 ('--color-ww-border',['--ww-border'],.18,.22),
 ('--color-ww-borderStrong',['--ww-border-strong'],.18,.22),
 ('--color-ww-borderSubtle',[],.18,.22)]
out=[]
for pal in [None]+PAL:
    for modo in 'ld':
        t=dict(base[modo])
        if pal:
            sel_l=r'html\[data-paleta="%s"\]'%pal; sel_d=r'html\.dark\[data-paleta="%s"\]'%pal
            for b in blocks(A, r'(?m)^'+sel_l): t.update(props(b))
            if modo=='d':
                for b in blocks(A, r'(?m)^'+sel_d): t.update(props(b))
        tom=trip(t['--color-ww-accent'])
        linhas=[]
        for tok,hexes,pl,pd in ALVOS:
            p=pl if modo=='l' else pd
            # cor-base: o hex (o que a tela pinta) se existir e for cor sólida; senão o tripleto
            src=None
            for h in hexes:
                if h in t and trip(t[h]): src=trip(t[h]); break
            if src is None and tok in t: src=trip(t[tok])
            if src is None: continue
            c=mix(tom,src,p)
            linhas.append('%s: %d %d %d;'%(tok,*c))
            for h in hexes:
                if h in t and trip(t[h]): linhas.append('%s: %s;'%(h,hx(c)))
        sel=('html%s'%('[data-paleta="%s"]'%pal if pal else ':not([data-paleta])')) if modo=='l' else ('html.dark%s'%('[data-paleta="%s"]'%pal if pal else ':not([data-paleta])'))
        out.append('%s {\n  %s\n}'%(sel,' '.join(linhas)))
print('\n'.join(out))
