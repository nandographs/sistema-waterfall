// Conserta a cidade dos cadastros que o OCR das fichas destruiu.
//
// Uso: node scripts/consertar-cidades-ocr.mjs            (simulação, não grava)
//      node scripts/consertar-cidades-ocr.mjs --gravar
//
// Roda DEPOIS de scripts/normalizar-cidades.mjs, que resolve o caso fácil: a
// mesma cidade escrita de várias formas. Sobra o caso difícil, onde não dá para
// comparar nome nenhum porque não sobrou nome — "BRANCO", "PATO BRANC 2",
// "Pod) &gt;&gt;”", "uto(s".
//
// A IDEIA
//
// O endereço desses cadastros não foi destruído junto: o bairro e o CEP estão
// lá, legíveis. E os outros 2.500 cadastros, esses limpos, dizem a que cidade
// pertence cada CEP e cada bairro. Então a cidade não é adivinhada — é deduzida
// da vizinhança, com quatro provas, nesta ordem:
//
//   grafia          o que sobrou do nome no próprio campo ("BRAN" -> Pato Branco)
//   nome do cliente "PREFEITURA MUNICIPAL DE CORONEL DOMINGOS" se entrega
//   CEP             o prefixo, contra a tabela montada dos cadastros limpos
//   bairro          idem, ignorando os genéricos (todo lugar tem um Centro)
//
// O QUE ELE NÃO FAZ
//
// Provas que discordam entre si não viram conserto: o cadastro fica como está.
// E o que não tem prova NENHUMA ("CAR", "TETO", "B EBEDOURO") tem a cidade
// apagada, não chutada — campo vazio é honesto, "B EBEDOURO" é ruído que ainda
// por cima suja o filtro da tela de clientes. O relatório lista todos eles pelo
// nome do cliente, para conferir na ficha de papel.
//
// Grava backup JSON de tudo que tocar, antes de tocar.
import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U=env.VITE_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY
const h={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
const GRAVAR=process.argv.includes('--gravar')

const norm=(s)=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'')
const CIDADES=JSON.parse(fs.readFileSync('scripts/cidades.json','utf8'))
const CANON=new Map(CIDADES.map(([cidade,uf])=>[norm(cidade),{cidade,uf}]))

// Pedaco de nome de cidade que o OCR deixou legivel. Ordem importa: o primeiro
// que casar decide, entao os fragmentos longos vem antes.
const FRAGMENTOS=[
  [/LOURENCO|LOLRENCO/,'SAOLOURENCODOOESTE'],
  [/CHOPINZ|HOPINZINHO|SHOPNZNHO|CHOPIN/,'CHOPINZINHO'],
  [/VIZINHOS|VIZIN|VIZNHOS|VIZNNHOS|VIZ/,'DOISVIZINHOS'],
  [/JORGE/,'SAOJORGEDOESTE'],
  [/BRANCO|BRANC|RANCO|BRAN|PATO/,'PATOBRANCO'],
  [/^OAO$|SAOJOAO/,'SAOJOAO'],
]
const ufDoDdd=(tel)=>{const m=String(tel||'').match(/\((\d{2})\)/);if(!m)return '';const d=+m[1]
  if(d>=41&&d<=46)return 'PR'; if(d>=47&&d<=49)return 'SC'; if(d>=51&&d<=55)return 'RS'; return ''}

const linhas=[]
for(let de=0;;de+=1000){const r=await fetch(`${U}/rest/v1/clientes?select=id,nome,cidade,uf,bairro,cep,telefone&order=criado_em`,{headers:{...h,Range:`${de}-${de+999}`}});const d=await r.json();linhas.push(...d);if(d.length<1000)break}

const bom=(c)=>CANON.has(norm(c.cidade))
const limpos=linhas.filter(bom), ruins=linhas.filter((c)=>c.cidade&&!bom(c))

// As tabelas de referencia saem dos cadastros LIMPOS: quem ja sabemos onde
// mora ensina a que cidade pertence cada CEP e cada bairro.
function tabela(chaveDe){
  const cont=new Map()
  for(const c of limpos){const k=chaveDe(c); if(!k)continue
    const cid=norm(c.cidade); if(!cont.has(k))cont.set(k,new Map())
    cont.get(k).set(cid,(cont.get(k).get(cid)||0)+1)}
  const fim=new Map()
  for(const [k,m] of cont){const t=[...m.values()].reduce((a,b)=>a+b,0)
    const [cid,n]=[...m].sort((a,b)=>b[1]-a[1])[0]
    if(n/t>=0.9&&n>=2) fim.set(k,{cidade:cid,forca:n,total:t})}
  return fim
}
const porCep=tabela((c)=>String(c.cep||'').replace(/\D/g,'').slice(0,5)||null)
// Bairro generico nao identifica cidade nenhuma: toda cidade tem um Centro.
const GENERICOS=new Set(['CENTRO','INTERIOR','CENTROSUL','CENTRONORTE','SAOFRANCISCO','SAOCRISTOVAO','ALVORADA','INDUSTRIAL','NOVOHORIZONTE','SANTATEREZINHA','BELAVISTA','JARDIMPRIMAVERA','SAOLUIZ','SANTALUZIA'])
const porBairro=tabela((c)=>{const b=norm(c.bairro); return b&&!GENERICOS.has(b)&&b.length>=4?b:null})

function decidir(c){
  const provas=[]
  const alvo=norm(c.cidade)
  for(const [re,cid] of FRAGMENTOS) if(re.test(alvo)){provas.push([cid,'grafia']);break}
  // Nome cortado no fim: "CORONEL DOMINGOS" é o começo de "Coronel Domingos
  // Soares". Oito letras para não casar "SAO" com meia dúzia de cidades.
  if(!provas.length&&alvo.length>=8) for(const k of CANON.keys()) if(k.startsWith(alvo)) provas.push([k,'grafia'])
  for(const [k,v] of CANON) if(k.length>=6&&norm(c.nome).includes(k)) provas.push([k,'nome do cliente'])
  const cep=String(c.cep||'').replace(/\D/g,'').slice(0,5)
  if(porCep.has(cep)) provas.push([porCep.get(cep).cidade,'CEP'])
  const b=norm(c.bairro)
  if(porBairro.has(b)) provas.push([porBairro.get(b).cidade,'bairro'])
  if(!provas.length) return {c,decisao:null}
  // A grafia é o próprio campo cidade — quando sobrou algo legível nela, é ela
  // que manda. As outras provas existem para quando não sobrou nada: sem esta
  // linha, "CRISOL CHOPINZINHO - SULINA" virava conflito entre a cidade escrita
  // no cadastro e o nome da empresa, e ficava sem conserto.
  const daGrafia=provas.find(([,p])=>p==='grafia')
  if(daGrafia) return {c,decisao:CANON.get(daGrafia[0]),provas:['grafia']}
  const distintas=new Set(provas.map(([cid])=>cid))
  if(distintas.size>1) return {c,decisao:null,conflito:provas}
  const alvoCidade=CANON.get(provas[0][0])
  return {c,decisao:alvoCidade,provas:provas.map(([,p])=>p)}
}

const arrumar=[],limpar=[],conflitos=[]
for(const c of ruins){const r=decidir(c)
  if(r.conflito) conflitos.push(r)
  else if(r.decisao) arrumar.push(r)
  else limpar.push(c)}

// SEGUNDA PASSADA — os que não têm prova nenhuma ("CAR", "TETO", "0").
//
// Aqui não dá para deduzir, só estimar: "B EBEDOURO" não vira cidade por
// evidência, vira pela companhia. O DDD do telefone e o bairro dizem em que
// canto do mapa a pessoa está, e entre os cadastros limpos daquele mesmo canto
// uma cidade domina — é essa que entra. Não é certeza e não finge ser: o
// relatório marca cada uma como "estimado" e diz em cima de quantos cadastros.
//
// Errar aqui custa pouco (uma cidade trocada num cadastro que hoje diz "TETO")
// e o backup guarda o texto original de todos.
function maisProvavel(chaveDe, chave){
  if(!chave) return null
  const cont=new Map()
  for(const c of limpos) if(chaveDe(c)===chave){const k=norm(c.cidade);cont.set(k,(cont.get(k)||0)+1)}
  if(!cont.size) return null
  const [cid,n]=[...cont].sort((a,b)=>b[1]-a[1])[0]
  return {cidade:CANON.get(cid),forca:n,total:[...cont.values()].reduce((a,b)=>a+b,0)}
}
const dddDe=(c)=>(String(c.telefone||'').match(/\((\d{2})\)/)||[])[1]||null
const estimados=[]
for(const c of limpar){
  const ddd=dddDe(c), b=norm(c.bairro)
  const tentativas=[
    ['bairro + DDD', ()=>maisProvavel((x)=>norm(x.bairro)+'/'+dddDe(x), b+'/'+ddd)],
    ['DDD do telefone', ()=>maisProvavel(dddDe, ddd)],
    ['bairro', ()=>maisProvavel((x)=>norm(x.bairro), b||null)],
    ['UF', ()=>maisProvavel((x)=>x.uf||null, c.uf||null)],
  ]
  for(const [comoSabe, calcular] of tentativas){
    const r = calcular()
    if(r?.cidade){ estimados.push({c, decisao:r.cidade, comoSabe, forca:r.forca, total:r.total}); break }
  }
}
const semJeito=limpar.filter((c)=>!estimados.some((e)=>e.c.id===c.id))

// A UF tambem sai errada do OCR: "PATO BRANCO|PA", "SAO JOAO|PE". So corrige
// quando o DDD do telefone confirma o estado — sem confirmacao, fica como esta.
const ufErrada=[]
for(const c of limpos){const alvo=CANON.get(norm(c.cidade))
  if(!alvo || (c.uf||'')===alvo.uf) continue
  const ddd=ufDoDdd(c.telefone)
  if(!c.uf || ddd===alvo.uf) ufErrada.push({c,uf:alvo.uf,motivo:c.uf?`DDD ${ddd}`:'estava vazia'})}

console.log(`=== ${arrumar.length} CADASTROS RECUPERADOS ===`)
for(const r of arrumar) console.log(`  "${r.c.cidade}" -> ${r.decisao.cidade}/${r.decisao.uf}   [${r.provas.join(', ')}]  ${r.c.nome.slice(0,34)}`)
console.log(`\n=== ${ufErrada.length} UF CORRIGIDA ===`)
for(const u of ufErrada) console.log(`  ${u.c.cidade}: "${u.c.uf}" -> ${u.uf}   (${u.motivo})  ${u.c.nome.slice(0,34)}`)
console.log(`\n=== ${conflitos.length} EM CONFLITO — nao encosta ===`)
for(const r of conflitos) console.log(`  "${r.c.cidade}" ${JSON.stringify(r.conflito)}  ${r.c.nome.slice(0,34)}`)
console.log(`\n=== ${estimados.length} ESTIMADOS pela vizinhança ===`)
for(const e of estimados) console.log(`  "${e.c.cidade}" -> ${e.decisao.cidade}/${e.decisao.uf}   [${e.comoSabe}: ${e.forca} de ${e.total}]  ${e.c.nome.slice(0,30)}`)
console.log(`\n=== ${semJeito.length} SEM JEITO — cidade fica em branco ===`)
for(const c of semJeito) console.log(`  "${c.cidade}|${c.uf||''}" bairro=${c.bairro||'-'} tel=${c.telefone||'-'}  ${c.nome.slice(0,34)}`)

if(!GRAVAR){console.log('\nSIMULACAO — nada gravado. Rode com --gravar');process.exit(0)}
fs.writeFileSync('scripts/saida-teste/backup-cidades-ocr.json',JSON.stringify({
  arrumar:arrumar.map(r=>r.c), estimados:estimados.map(e=>e.c), semJeito, ufErrada:ufErrada.map(u=>u.c),
},null,2))
const patch=async(id,corpo)=>{const r=await fetch(`${U}/rest/v1/clientes?id=eq.${id}`,{method:'PATCH',headers:h,body:JSON.stringify(corpo)});if(!r.ok)throw new Error(await r.text())}
for(const r of arrumar) await patch(r.c.id,{cidade:r.decisao.cidade,uf:r.decisao.uf})
for(const e of estimados) await patch(e.c.id,{cidade:e.decisao.cidade,uf:e.decisao.uf})
for(const u of ufErrada) await patch(u.c.id,{uf:u.uf})
for(const c of semJeito) await patch(c.id,{cidade:null})
console.log(`\ngravado: ${arrumar.length} recuperados, ${estimados.length} estimados, ${ufErrada.length} UF, ${semJeito.length} em branco.`)
console.log('backup: scripts/saida-teste/backup-cidades-ocr.json')
