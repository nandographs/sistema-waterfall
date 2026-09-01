// Modelos de mensagem do WhatsApp.
//
// Constante em JS e não tabela no banco, pela mesma razão das etapas do funil
// (ver ETAPAS_FUNIL no repositório): com meia dúzia de textos que mudam uma vez
// por ano, uma tela de edição custaria mais do que entrega. Quando os textos
// começarem a mudar toda semana, aí vira tabela.
//
// As variáveis são resolvidas por `aplicarModelo`. O texto entra no campo de
// digitação preenchido — e você edita antes de enviar. Modelo nenhum dispara
// sozinho.

export const MODELOS_MENSAGEM = [
  {
    id: 'confirmar_visita',
    rotulo: 'Confirmar visita',
    texto:
      'Oi {{cliente}}, aqui é o {{usuario}} da Waterfall. Passando para confirmar ' +
      'nossa visita em {{data}}. Tudo certo por aí?',
  },
  {
    id: 'troca_refil',
    rotulo: 'Aviso de troca de refil',
    texto:
      'Oi {{cliente}}, tudo bem? O refil do seu purificador está previsto para troca ' +
      'em {{data}}. Quer que eu já reserve um horário nessa semana?',
  },
  {
    id: 'cobranca',
    rotulo: 'Lembrete de pagamento',
    texto:
      'Oi {{cliente}}, tudo bem? Passando para lembrar da parcela de {{valor}} que ' +
      'venceu em {{data}}. Qualquer coisa a gente ajusta, é só me falar.',
  },
  {
    id: 'pos_instalacao',
    rotulo: 'Depois da instalação',
    texto:
      'Oi {{cliente}}! Obrigado pela confiança. Qualquer dúvida sobre o purificador ' +
      'é só me chamar por aqui — e daqui a alguns meses eu te aviso da troca do refil.',
  },
]

// Troca {{variavel}} pelo valor correspondente. O que não tiver valor vira
// "____" de propósito: um espaço em branco visível é impossível de enviar sem
// perceber, enquanto uma variável crua ("{{data}}") passa batido e chega assim
// no cliente.
export function aplicarModelo(texto, valores = {}) {
  return String(texto).replace(/{{\s*(\w+)\s*}}/g, (_, chave) => {
    const valor = valores[chave]
    return valor === undefined || valor === null || valor === '' ? '____' : String(valor)
  })
}
