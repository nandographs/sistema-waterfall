// Os dois gráficos do Financeiro, em SVG puro — o sistema não carrega
// biblioteca de gráfico, e estes dois não precisam de uma.
//
// As cores vêm das escalas do tema (fill-emerald-500, stroke-[var(--accent-blue)]),
// então os gráficos acompanham o escuro e o claro sem nenhum código a mais.

import { useEffect, useRef, useState } from 'react'

// Largura real do container. O SVG é desenhado em pixels de verdade, e não
// esticado por viewBox, para o texto e os pontos não saírem deformados.
function useLargura() {
  const ref = useRef(null)
  const [largura, setLargura] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const medir = () => setLargura(el.clientWidth)
    medir()
    const obs = new ResizeObserver(medir)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return [ref, largura]
}

const escala = (min, max, de, ate) => (v) =>
  max === min ? (de + ate) / 2 : de + ((v - min) / (max - min)) * (ate - de)

// Balão com o valor do ponto sob o mouse (ou o dedo).
function Balao({ x, y, largura, linhas }) {
  const w = 156
  const h = 14 + linhas.length * 16
  const bx = Math.min(Math.max(x - w / 2, 0), largura - w)
  const by = Math.max(y - h - 12, 0)
  return (
    <g pointerEvents="none">
      <rect x={bx} y={by} width={w} height={h} rx={10} className="fill-slate-900" />
      {linhas.map(([texto, classe], i) => (
        <text
          key={i}
          x={bx + w / 2}
          y={by + 19 + i * 16}
          textAnchor="middle"
          className={`${classe || 'fill-slate-50'} text-[11px] font-semibold tnum`}
        >
          {texto}
        </text>
      ))}
    </g>
  )
}

// ---------------------------------------------------------------- saldo
//
// A linha do saldo ao longo do período. O trecho até hoje é o que aconteceu
// (linha cheia, com área); depois de hoje é o que está previsto (tracejado).
export function GraficoSaldo({ serie, formatar, rotuloDia, altura = 150 }) {
  const [ref, largura] = useLargura()
  const [ativo, setAtivo] = useState(null)

  const topo = 8
  const base = altura - 22
  const valores = serie.map((p) => p.saldo)
  const minV = Math.min(...valores, 0)
  const maxV = Math.max(...valores, 0)
  const folga = (maxV - minV) * 0.08 || 1
  const y = escala(minV - folga, maxV + folga, base, topo)
  const x = escala(0, Math.max(1, serie.length - 1), 6, Math.max(6, largura - 6))

  const pts = serie.map((p, i) => [x(i), y(p.saldo)])
  const ultimoReal = serie.findLastIndex((p) => !p.previsto)
  const real = ultimoReal >= 0 ? pts.slice(0, ultimoReal + 1) : []
  const previsto = pts.slice(Math.max(0, ultimoReal))
  const linha = (lista) => lista.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('')
  const area = real.length > 1
    ? `${linha(real)}L${real.at(-1)[0].toFixed(1)},${base}L${real[0][0].toFixed(1)},${base}Z`
    : ''

  function mover(e) {
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left
    let melhor = 0
    pts.forEach(([qx], i) => { if (Math.abs(qx - px) < Math.abs(pts[melhor][0] - px)) melhor = i })
    setAtivo(melhor)
  }

  // Três datas no eixo: começo, meio e fim — o suficiente para situar.
  const marcas = serie.length > 2 ? [0, Math.floor((serie.length - 1) / 2), serie.length - 1] : serie.map((_, i) => i)

  return (
    <div ref={ref} className="w-full min-w-0 overflow-hidden select-none" style={{ height: altura }}>
      {largura > 0 && serie.length > 0 && (
        <svg
          width={largura}
          height={altura}
          role="img"
          aria-label="Saldo ao longo do período"
          onPointerMove={mover}
          onPointerLeave={() => setAtivo(null)}
          className="touch-pan-y"
        >
          <defs>
            <linearGradient id="grad-saldo" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {minV < 0 && maxV > 0 && (
            <line x1={0} x2={largura} y1={y(0)} y2={y(0)} className="stroke-slate-300" strokeDasharray="2 4" />
          )}

          {area && <path d={area} fill="url(#grad-saldo)" />}
          {real.length > 1 && (
            <path d={linha(real)} fill="none" stroke="var(--accent-blue)" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {previsto.length > 1 && (
            <path d={linha(previsto)} fill="none" stroke="var(--accent-blue)" strokeOpacity={0.6} strokeWidth={2} strokeDasharray="5 5" />
          )}

          {/* Hoje: o último ponto real, sempre marcado. */}
          {ultimoReal >= 0 && ativo === null && (
            <circle cx={pts[ultimoReal][0]} cy={pts[ultimoReal][1]} r={4.5} fill="var(--accent-blue)" className="stroke-slate-50" strokeWidth={2} />
          )}

          {marcas.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={altura - 4}
              textAnchor={i === 0 ? 'start' : i === serie.length - 1 ? 'end' : 'middle'}
              className="fill-slate-400 text-[11px]"
            >
              {rotuloDia(serie[i].dia)}
            </text>
          ))}

          {ativo !== null && (
            <>
              <line x1={pts[ativo][0]} x2={pts[ativo][0]} y1={topo} y2={base} className="stroke-slate-400" strokeDasharray="3 3" />
              <circle cx={pts[ativo][0]} cy={pts[ativo][1]} r={4.5} fill="var(--accent-blue)" className="stroke-slate-50" strokeWidth={2} />
              <Balao
                x={pts[ativo][0]}
                y={pts[ativo][1]}
                largura={largura}
                linhas={[
                  [formatar(serie[ativo].saldo)],
                  [`${rotuloDia(serie[ativo].dia)}${serie[ativo].previsto ? ' · previsto' : ''}`, 'fill-slate-400'],
                ]}
              />
            </>
          )}
        </svg>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- fluxo
//
// Os próximos meses: barra verde (entra), barra vermelha (sai) e a linha do
// saldo acumulado por cima. Uma escala só para tudo, com o zero marcado —
// senão uma barra de R$ 1.000 e um saldo de −R$ 20.000 pareceriam do mesmo tamanho.
export function GraficoFluxo({ meses, formatar, rotuloMes, altura = 230 }) {
  const [ref, largura] = useLargura()
  const [ativo, setAtivo] = useState(null)

  const topo = 12
  const base = altura - 26
  // A barra de saída empilha o que está lançado e o salário previsto.
  const saiTotal = (m) => m.sai + (m.folha || 0)
  const todos = meses.flatMap((m) => [m.entra, saiTotal(m), m.acumulado])
  const minV = Math.min(0, ...todos)
  const maxV = Math.max(0, ...todos)
  const folga = (maxV - minV) * 0.06 || 1
  const y = escala(minV - folga, maxV + folga, base, topo)

  const coluna = largura / Math.max(1, meses.length)
  const barra = Math.min(18, coluna * 0.22)
  const centro = (i) => coluna * i + coluna / 2
  const zero = y(0)
  const linha = meses.map((m, i) => `${i ? 'L' : 'M'}${centro(i).toFixed(1)},${y(m.acumulado).toFixed(1)}`).join('')

  return (
    <div ref={ref} className="w-full min-w-0 overflow-hidden select-none" style={{ height: altura }}>
      {largura > 0 && (
        <svg
          width={largura}
          height={altura}
          role="img"
          aria-label="Fluxo de caixa dos próximos meses"
          onPointerLeave={() => setAtivo(null)}
        >
          <line x1={0} x2={largura} y1={zero} y2={zero} className="stroke-slate-300" />

          {meses.map((m, i) => (
            <g key={m.mes} onPointerEnter={() => setAtivo(i)}>
              {/* Área de toque da coluna inteira, invisível. */}
              <rect x={coluna * i} y={0} width={coluna} height={altura} fill="transparent" />
              {ativo === i && (
                <rect x={coluna * i + 4} y={topo} width={coluna - 8} height={base - topo} rx={10} className="fill-slate-100" />
              )}
              <rect
                x={centro(i) - barra - 2}
                y={y(m.entra)}
                width={barra}
                height={Math.max(0, zero - y(m.entra))}
                rx={4}
                className="fill-emerald-500"
              />
              <rect
                x={centro(i) + 2}
                y={y(saiTotal(m))}
                width={barra}
                height={Math.max(0, zero - y(saiTotal(m)))}
                rx={4}
                className="fill-amber-500"
              />
              <rect
                x={centro(i) + 2}
                y={y(m.sai)}
                width={barra}
                height={Math.max(0, zero - y(m.sai))}
                rx={m.folha > 0 ? 0 : 4}
                className="fill-red-500"
              />
              <text x={centro(i)} y={altura - 6} textAnchor="middle" className="fill-slate-500 text-[11px] font-medium first-letter:uppercase">
                {rotuloMes(m.mes)}
              </text>
            </g>
          ))}

          <path d={linha} fill="none" stroke="var(--accent-blue)" strokeWidth={2.25} strokeLinejoin="round" pointerEvents="none" />
          {meses.map((m, i) => (
            <circle
              key={m.mes}
              cx={centro(i)}
              cy={y(m.acumulado)}
              r={ativo === i ? 5 : 3.5}
              fill="var(--accent-blue)"
              className="stroke-slate-50"
              strokeWidth={2}
              pointerEvents="none"
            />
          ))}

          {ativo !== null && (
            <Balao
              x={centro(ativo)}
              y={Math.min(y(meses[ativo].acumulado), y(meses[ativo].entra), y(saiTotal(meses[ativo])))}
              largura={largura}
              linhas={[
                [`Entra ${formatar(meses[ativo].entra)}`],
                [`Sai ${formatar(meses[ativo].sai)}`],
                ...(meses[ativo].folha > 0 ? [[`Salários ${formatar(meses[ativo].folha)}`]] : []),
                [`Saldo ${formatar(meses[ativo].acumulado)}`, 'fill-slate-400'],
              ]}
            />
          )}
        </svg>
      )}
    </div>
  )
}
