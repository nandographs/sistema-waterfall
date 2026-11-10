import { useEffect, useState } from 'react'
import {
  unidades, salvarUnidade, listarPerfis, salvarPerfil, criarUsuario, trocarSenha, TIPOS_UNIDADE,
} from '../data/repository.js'
import { Card, Page, PageTitle, Button, Field, inputCls, Badge, Empty, Modal, Aviso, notificar } from '../components/ui.jsx'
import { IconPlus } from '../components/icons.jsx'
import { PAPEIS } from '../lib/auth.js'

// Quem usa o sistema e de quem são os dados (migrações 030 e 031). Só a gestão
// chega aqui — a rota é guardada em App.jsx, e o banco só devolve os perfis dos
// outros para quem é gestão.
//
// Papel e unidade andam juntos, e a tela não deixa a combinação desandar:
//   gestão        → sempre na Waterfall (é lá que caem os registros que ela cria);
//   distribuidor  → numa unidade de distribuidor;
//   sem acesso    → conta que existe mas não vê nada até alguém liberar.

const selectCls = inputCls + ' cursor-pointer'

const casa = () => unidades.list().find((u) => u.tipo === 'casa')
const distribuidores = () => unidades.list().filter((u) => u.tipo === 'distribuidor')

// O login vira `usuario@waterfall.app` (lib/auth.js). Sem espaço e sem acento,
// porque e-mail não aceita, e em minúsculas, porque é assim que o login compara.
const LOGIN_VALIDO = /^[a-z0-9._-]+$/

// Arruma a unidade conforme o papel escolhido, para o formulário nunca mandar
// uma combinação que o banco recusaria (030: quem tem papel tem unidade).
function ajustarUnidade(form) {
  if (form.papel === 'gestao') return { ...form, unidadeId: casa()?.id || '' }
  if (form.papel === 'distribuidor') {
    const valida = distribuidores().some((u) => u.id === form.unidadeId)
    return { ...form, unidadeId: valida ? form.unidadeId : distribuidores()[0]?.id || '' }
  }
  return { ...form, unidadeId: '' }
}

function validarPapel(form) {
  if (form.papel === 'distribuidor' && !form.unidadeId) {
    return 'Cadastre a unidade do distribuidor antes de dar esse papel a alguém.'
  }
  return ''
}

function CamposDePapel({ form, setForm }) {
  return (
    <>
      <Field label="Papel">
        <select
          className={selectCls}
          value={form.papel}
          onChange={(e) => setForm(ajustarUnidade({ ...form, papel: e.target.value }))}
        >
          <option value="gestao">{PAPEIS.gestao} — vê e altera tudo</option>
          <option value="distribuidor">{PAPEIS.distribuidor} — só os próprios clientes</option>
          <option value="">Sem acesso</option>
        </select>
      </Field>
      {form.papel === 'distribuidor' && (
        <Field label="Unidade">
          <select
            className={selectCls}
            value={form.unidadeId}
            onChange={(e) => setForm({ ...form, unidadeId: e.target.value })}
          >
            {distribuidores().length === 0 && <option value="">Nenhum distribuidor cadastrado</option>}
            {distribuidores().map((u) => (
              <option key={u.id} value={u.id}>{u.nome}</option>
            ))}
          </select>
        </Field>
      )}
    </>
  )
}

export default function Equipe() {
  const [listaUnidades, setListaUnidades] = useState(unidades.list())
  const [perfis, setPerfis] = useState(null)
  const [erroPerfis, setErroPerfis] = useState('')

  const [formUnidade, setFormUnidade] = useState(null)
  const [novoUsuario, setNovoUsuario] = useState(null)
  const [editando, setEditando] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function carregarPerfis() {
    try {
      setPerfis(await listarPerfis())
      setErroPerfis('')
    } catch (e) {
      setErroPerfis(e?.message || String(e))
    }
  }
  useEffect(() => { carregarPerfis() }, [])

  const nomeUnidade = (id) => listaUnidades.find((u) => u.id === id)?.nome || ''
  const pessoasNaUnidade = (id) => (perfis || []).filter((p) => p.unidadeId === id && p.papel).length

  // Um envio por vez, com o erro dentro do modal: fechar e mostrar um aviso
  // solto faria quem digitou a senha digitar tudo de novo.
  async function enviar(acao, aoTerminar) {
    setSalvando(true)
    setErro('')
    try {
      await acao()
      aoTerminar()
    } catch (e) {
      setErro(e?.message || String(e))
    } finally {
      setSalvando(false)
    }
  }

  function salvarFormUnidade(e) {
    e.preventDefault()
    enviar(() => salvarUnidade(formUnidade), () => {
      notificar(formUnidade.id ? 'Unidade atualizada.' : 'Distribuidor cadastrado.')
      setFormUnidade(null)
      setListaUnidades([...unidades.list()])
    })
  }

  function salvarNovoUsuario(e) {
    e.preventDefault()
    const usuario = novoUsuario.usuario.trim().toLowerCase()
    if (!LOGIN_VALIDO.test(usuario)) {
      setErro('O usuário só pode ter letras sem acento, números, ponto, hífen e sublinhado.')
      return
    }
    if (novoUsuario.senha.length < 6) {
      setErro('A senha precisa de pelo menos 6 caracteres.')
      return
    }
    const problema = validarPapel(novoUsuario)
    if (problema) { setErro(problema); return }
    enviar(() => criarUsuario({ ...novoUsuario, usuario }), () => {
      notificar(`Acesso de ${novoUsuario.nome || usuario} criado.`)
      setNovoUsuario(null)
      carregarPerfis()
    })
  }

  function salvarEdicao(e) {
    e.preventDefault()
    const problema = validarPapel(editando)
    if (problema) { setErro(problema); return }
    if (editando.novaSenha && editando.novaSenha.length < 6) {
      setErro('A senha nova precisa de pelo menos 6 caracteres.')
      return
    }
    enviar(async () => {
      await salvarPerfil(editando.userId, editando)
      if (editando.novaSenha) await trocarSenha(editando.userId, editando.novaSenha)
    }, () => {
      notificar('Acesso atualizado.')
      setEditando(null)
      carregarPerfis()
    })
  }

  function abrirNovoUsuario() {
    setErro('')
    setNovoUsuario(ajustarUnidade({ nome: '', usuario: '', senha: '', papel: 'distribuidor', unidadeId: '' }))
  }

  function abrirEdicao(perfil) {
    setErro('')
    setEditando({ ...perfil, papel: perfil.papel || '', novaSenha: '' })
  }

  // Conta criada pelo painel do Supabase (ou por engano) nasce sem papel: é a
  // primeira coisa que a gestão precisa ver nesta tela.
  const pendentes = (perfis || []).filter((p) => !p.papel && p.ativo)

  return (
    <Page>
      <PageTitle
        subtitle="Quem usa o sistema, com que papel, e de quem são os dados que cada um vê"
        action={<Button onClick={abrirNovoUsuario}><IconPlus size={16} /> Novo acesso</Button>}
      >
        Equipe
      </PageTitle>

      {pendentes.length > 0 && (
        <Aviso tipo="alerta" className="mb-4">
          {pendentes.length === 1
            ? `${pendentes[0].nome || pendentes[0].usuario} ainda não tem acesso liberado.`
            : `${pendentes.length} contas ainda não têm acesso liberado.`}
          {' '}Dê um papel para a pessoa começar a usar o sistema.
        </Aviso>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-5 lg:gap-6">
        <Card title="Acessos">
          {erroPerfis && <Aviso tipo="erro">Não foi possível carregar a equipe: {erroPerfis}</Aviso>}
          {!erroPerfis && perfis === null && <p className="text-sm text-slate-400">Carregando…</p>}
          {perfis?.length === 0 && <Empty>Nenhum acesso cadastrado.</Empty>}
          <ul className="divide-y divide-slate-100">
            {(perfis || []).map((p) => (
              <li key={p.userId} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className={`font-semibold truncate ${p.ativo ? 'text-slate-900' : 'text-slate-400'}`}>
                    {p.nome || p.usuario || 'Sem nome'}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {p.usuario ? `entra como ${p.usuario}` : 'login não registrado'}
                    {p.papel && p.unidadeId ? ` · ${nomeUnidade(p.unidadeId)}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                  {!p.ativo
                    ? <Badge>Desativado</Badge>
                    : p.papel
                      ? <Badge color={p.papel === 'gestao' ? 'green' : 'sky'}>{PAPEIS[p.papel]}</Badge>
                      : <Badge color="amber">Sem acesso</Badge>}
                  <Button variant="ghost" onClick={() => abrirEdicao(p)}>Editar</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card
          title="Unidades"
          action={
            <Button variant="secondary" onClick={() => { setErro(''); setFormUnidade({ nome: '', ativa: true }) }}>
              <IconPlus size={16} /> Distribuidor
            </Button>
          }
        >
          <p className="text-xs text-slate-500 mb-3">
            Cada distribuidor vê só os clientes da unidade dele. A gestão vê todas.
          </p>
          <ul className="divide-y divide-slate-100">
            {listaUnidades.map((u) => (
              <li key={u.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={`font-semibold truncate ${u.ativa === false ? 'text-slate-400' : 'text-slate-900'}`}>{u.nome}</p>
                  <p className="text-xs text-slate-500">
                    {TIPOS_UNIDADE[u.tipo]}
                    {perfis && ` · ${pessoasNaUnidade(u.id)} ${pessoasNaUnidade(u.id) === 1 ? 'pessoa' : 'pessoas'}`}
                  </p>
                </div>
                {/* A casa é uma só e não se edita: renomear a Waterfall aqui
                    não mudaria o nome em lugar nenhum que importe. */}
                {u.tipo !== 'casa' && (
                  <Button variant="ghost" onClick={() => { setErro(''); setFormUnidade({ ...u }) }}>Editar</Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Modal title={formUnidade?.id ? 'Editar distribuidor' : 'Novo distribuidor'} open={!!formUnidade} onClose={() => setFormUnidade(null)}>
        {formUnidade && (
          <form onSubmit={salvarFormUnidade} className="space-y-4">
            <Field label="Nome">
              <input
                className={inputCls}
                autoFocus
                value={formUnidade.nome}
                onChange={(e) => setFormUnidade({ ...formUnidade, nome: e.target.value })}
                placeholder="Ex.: Distribuidor Itajaí"
              />
            </Field>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setFormUnidade(null)}>Cancelar</Button>
              <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal title="Novo acesso" open={!!novoUsuario} onClose={() => setNovoUsuario(null)}>
        {novoUsuario && (
          <form onSubmit={salvarNovoUsuario} className="space-y-4">
            <Field label="Nome">
              <input
                className={inputCls}
                autoFocus
                value={novoUsuario.nome}
                onChange={(e) => setNovoUsuario({ ...novoUsuario, nome: e.target.value })}
                placeholder="Como aparece no sistema"
              />
            </Field>
            <Field label="Usuário (para entrar)">
              <input
                className={inputCls}
                autoCapitalize="none"
                autoComplete="off"
                value={novoUsuario.usuario}
                onChange={(e) => setNovoUsuario({ ...novoUsuario, usuario: e.target.value })}
                placeholder="ex.: joao.itajai"
              />
            </Field>
            {/* Texto à vista, e não `password`: quem digita aqui é a gestão
                definindo a senha de OUTRA pessoa, e precisa ver o que vai
                repassar. Campo de senha também atrai o gerenciador do navegador,
                que pode trocar o que foi digitado pela senha salva de quem está
                logado — e o acesso novo nasce com uma senha que ninguém conhece. */}
            <Field label="Senha">
              <input
                className={inputCls}
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                value={novoUsuario.senha}
                onChange={(e) => setNovoUsuario({ ...novoUsuario, senha: e.target.value })}
              />
            </Field>
            <CamposDePapel form={novoUsuario} setForm={setNovoUsuario} />
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setNovoUsuario(null)}>Cancelar</Button>
              <Button type="submit" disabled={salvando}>{salvando ? 'Criando…' : 'Criar acesso'}</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal title="Editar acesso" open={!!editando} onClose={() => setEditando(null)}>
        {editando && (
          <form onSubmit={salvarEdicao} className="space-y-4">
            <Field label="Nome">
              <input
                className={inputCls}
                value={editando.nome}
                onChange={(e) => setEditando({ ...editando, nome: e.target.value })}
              />
            </Field>
            {editando.usuario && (
              <p className="text-xs text-slate-500">Entra como <strong className="text-slate-700">{editando.usuario}</strong></p>
            )}
            <CamposDePapel form={editando} setForm={setEditando} />
            <Field label="Senha nova (deixe em branco para manter)">
              <input
                className={inputCls}
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                value={editando.novaSenha}
                onChange={(e) => setEditando({ ...editando, novaSenha: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
              <input
                type="checkbox"
                className="accent-blue-600"
                checked={editando.ativo !== false}
                onChange={(e) => setEditando({ ...editando, ativo: e.target.checked })}
              />
              Acesso ativo
            </label>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setEditando(null)}>Cancelar</Button>
              <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
            </div>
          </form>
        )}
      </Modal>
    </Page>
  )
}
