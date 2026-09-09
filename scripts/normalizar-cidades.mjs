// Normaliza a CIDADE dos clientes: uma grafia só por cidade.
//
// Uso: node scripts/normalizar-cidades.mjs            (simulação, não grava)
//      node scripts/normalizar-cidades.mjs --gravar
//
// POR QUE
//
// A importação das fichas de papel (sql/018) trouxe a cidade como o OCR leu:
// "PATO BRANCO", "Pato Branco", "P ATO BRANCO", "PAT O BRANCO". São a mesma
// cidade, mas o filtro da tela de clientes lista cada uma como uma opção
// diferente, e filtrar por uma esconde os clientes das outras.
//
// COMO
//
// Compara pela forma normalizada (sem acento, sem caixa, sem espaço e sem
// pontuação) contra a lista de cidades reais da região, aqui embaixo. Bateu,
// o cadastro recebe a grafia correta e acentuada. Não bateu, NÃO ENCOSTA:
// "psaNCO BRAN" provavelmente é Pato Branco, mas provavelmente não é o
// suficiente para reescrever o endereço de alguém — esses saem no relatório
// do fim para conferência à mão.
//
// A UF só é preenchida quando está VAZIA. UF preenchida e divergente
// (ex.: "PATO BRANCO|PA") fica como está, pelo mesmo motivo.
//
// Grava backup JSON de todas as alterações antes de aplicar.
import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U=env.VITE_SUPABASE_URL, K=env.SUPABASE_SERVICE_ROLE_KEY
const h={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
const GRAVAR=process.argv.includes('--gravar')

const linhas=[]
for(let de=0;;de+=1000){const r=await fetch(`${U}/rest/v1/clientes?select=id,nome,cidade,uf&order=criado_em`,{headers:{...h,Range:`${de}-${de+999}`}});const d=await r.json();linhas.push(...d);if(d.length<1000)break}

// As cidades reais da regiao, na grafia correta. Chave = forma normalizada.
// A lista das cidades reais vive em scripts/cidades.json — os dois scripts de
// limpeza leem dela, senao um desfaz o que o outro arrumou.
const CIDADES=JSON.parse(fs.readFileSync('scripts/cidades.json','utf8')).map(([c,u])=>c+'/'+u)
const norm=(s)=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'')
const CANON=new Map()
for(const c of CIDADES){const [cid,uf]=c.split('/');CANON.set(norm(cid),{cidade:cid,uf})}
// Apelidos: escritas que nao normalizam igual mas sao a mesma cidade.
const APELIDOS={'SAOLOURENCO':'SAOLOURENCODOOESTE','SAOLOURENCOOESTE':'SAOLOURENCODOOESTE','AOLOURENCODOOESTE':'SAOLOURENCODOOESTE','SAOLOLRENCO':'SAOLOURENCODOOESTE','SHOLOURENCOPOOESTE':'SAOLOURENCODOOESTE','SAOLO':'SAOLOURENCODOOESTE','ITAPEJARA':'ITAPEJARADOESTE','SSAOJORGEDOESTE':'SAOJORGEDOESTE','SAOPEDROIGUACU':'SAOPEDRODOIGUACU','QUEDASDOIGUACU':'QUEDASDOIGUACU'}

const mudancas=[], lixo=new Map()
for(const c of linhas){
  const k0=norm(c.cidade)
  if(!k0){continue}
  const k=APELIDOS[k0]||k0
  const alvo=CANON.get(k)
  if(!alvo){ lixo.set(c.cidade+'|'+(c.uf||''),(lixo.get(c.cidade+'|'+(c.uf||''))||0)+1); continue }
  // So mexe na UF quando ela esta vazia; UF preenchida e divergente fica de fora.
  const ufNova = (c.uf||'').trim() ? c.uf : alvo.uf
  if(c.cidade!==alvo.cidade || c.uf!==ufNova) mudancas.push({id:c.id, de:`${c.cidade}|${c.uf||''}`, para:`${alvo.cidade}|${ufNova}`, cidade:alvo.cidade, uf:ufNova})
}
const porPar=new Map()
for(const m of mudancas){const k=m.de+' -> '+m.para;porPar.set(k,(porPar.get(k)||0)+1)}
console.log('=== FUSOES (',mudancas.length,'cadastros ) ===')
for(const [k,n] of [...porPar].sort((a,b)=>b[1]-a[1])) console.log(String(n).padStart(5), k)
console.log('\n=== NAO RECONHECIDO — fica como esta (',[...lixo.values()].reduce((a,b)=>a+b,0),'cadastros ) ===')
for(const [k,n] of [...lixo].sort((a,b)=>b[1]-a[1])) console.log(String(n).padStart(5), k)

if(!GRAVAR){console.log('\nSIMULACAO — nada gravado.');process.exit(0)}
fs.writeFileSync('scripts/saida-teste/backup-cidades.json',JSON.stringify(mudancas,null,2))
const grupos=new Map()
for(const m of mudancas){const k=m.cidade+'|'+m.uf;if(!grupos.has(k))grupos.set(k,[]);grupos.get(k).push(m.id)}
for(const [k,ids] of grupos){const [cidade,uf]=k.split('|')
  for(let i=0;i<ids.length;i+=200){const lote=ids.slice(i,i+200)
    const r=await fetch(`${U}/rest/v1/clientes?id=in.(${lote.join(',')})`,{method:'PATCH',headers:h,body:JSON.stringify({cidade,uf})})
    if(!r.ok) throw new Error(await r.text())}}
console.log('\ngravado:',mudancas.length,'cadastros. backup: scripts/saida-teste/backup-cidades.json')
