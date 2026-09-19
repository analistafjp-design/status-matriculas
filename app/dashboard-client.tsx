"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AlvoRow,
  CachedFileData,
  CadastroConsolidado,
  InterpretacaoIA,
  LocalDirectoryHandle,
  RegraResfriamento,
  VisitaRow,
} from "../lib/types";
import { collectDirectoryFiles } from "../lib/fs-access";
import {
  getCachedFiles,
  getSavedDirectoryHandle,
  obterRegras,
  salvarRegras,
  saveDirectoryHandle,
  sincronizarArquivos,
  type ProgressoImportacao,
} from "../lib/idb";
import { parseSelectedFile } from "../lib/parse";
import { combinarArquivos, gerarAlvos, type EstadoDerivado } from "../lib/matching";
import { exportarAlvosExcel, exportarExcel, type ColunaExport } from "../lib/export-xlsx";
import { interpretarParecer } from "../lib/ai";
import { extrairMatriculasDeArquivo, extrairMatriculasDeTexto } from "../lib/buscar-matriculas";
import {
  calcularCadastralPendente,
  calcularIncrementoEconomias,
  calcularPossivelLigacaoNova,
  statusEhIrrelevante,
} from "../lib/oportunidades";
import { calcularEstourosConsumo, calcularSocialMultiEconomia, type EstouroConsumo } from "../lib/consumo-social";

const ESTADO_VAZIO: EstadoDerivado = {
  ultimaVisitaPorMatricula: new Map(),
  historicoPorMatricula: new Map(),
  cadastroConsolidado: new Map(),
  totalVisitas: 0,
};

type Aba = "alvos" | "regiao" | "oportunidades" | "consumo" | "buscar" | "auditoria" | "regras";

type ResultadoBusca = {
  matricula: string;
  ultima: VisitaRow | null;
  historico: VisitaRow[];
};

const COLUNAS_ALVO: { chave: keyof AlvoRow; titulo: string }[] = [
  { chave: "matricula", titulo: "Matrícula" },
  { chave: "endereco", titulo: "Endereço" },
  { chave: "cidade", titulo: "Cidade" },
  { chave: "bairro", titulo: "Bairro" },
  { chave: "consumoMedio", titulo: "Consumo médio" },
  { chave: "consumoUltimoMes", titulo: "Consumo último mês" },
  { chave: "mesesConsumoZero", titulo: "Meses consumo zero" },
  { chave: "qtdEconomias", titulo: "Qtd. economias" },
  { chave: "situacaoDocumental", titulo: "Situação documental" },
  { chave: "statusUltimaVisita", titulo: "Status última visita" },
  { chave: "diasDesdeUltimaVisita", titulo: "Dias s/ visita" },
  { chave: "motivoInclusao", titulo: "Motivo da inclusão" },
];

const COLUNAS_ESTOURO: ColunaExport<EstouroConsumo>[] = [
  { chave: "matricula", titulo: "Matrícula" },
  { chave: "endereco", titulo: "Endereço" },
  { chave: "cidade", titulo: "Cidade" },
  { chave: "bairro", titulo: "Bairro" },
  { chave: "mesesEstourados", titulo: "Meses estourados" },
  { chave: "ultimosPeriodos", titulo: "Meses estourados (detalhe)" },
  { chave: "qtdEconomias", titulo: "Qtd. economias" },
];

const COLUNAS_SOCIAL_MULTI: ColunaExport<CadastroConsolidado>[] = [
  { chave: "matricula", titulo: "Matrícula" },
  { chave: "endereco", titulo: "Endereço" },
  { chave: "cidade", titulo: "Cidade" },
  { chave: "bairro", titulo: "Bairro" },
  { chave: "qtdEconomias", titulo: "Qtd. economias" },
  { chave: "situacaoDocumental", titulo: "Situação documental" },
];

export default function DashboardClient() {
  const [files, setFiles] = useState<CachedFileData[]>([]);
  const [regras, setRegras] = useState<RegraResfriamento[]>([]);
  const [status, setStatus] = useState("Carregando...");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressoImportacao | null>(null);
  const [pastaConectada, setPastaConectada] = useState(false);
  const [rootName, setRootName] = useState("");
  const [aba, setAba] = useState<Aba>("alvos");
  const [ordenarPor, setOrdenarPor] = useState<keyof AlvoRow | "">("");
  const [ordemDesc, setOrdemDesc] = useState(true);
  const [suportaFsAccess, setSuportaFsAccess] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const resetCacheRef = useRef(false);

  const [ocultarIrrelevantes, setOcultarIrrelevantes] = useState(true);
  const [filtroCidade, setFiltroCidade] = useState("");
  const [filtroBairro, setFiltroBairro] = useState("");

  const [buscaTexto, setBuscaTexto] = useState("");
  const [buscaResultados, setBuscaResultados] = useState<ResultadoBusca[] | null>(null);
  const [buscaCarregando, setBuscaCarregando] = useState(false);
  const [buscaErro, setBuscaErro] = useState("");
  const [matriculaExpandida, setMatriculaExpandida] = useState<string | null>(null);

  const [interpretacoes, setInterpretacoes] = useState<Record<string, InterpretacaoIA>>({});
  const [interpretando, setInterpretando] = useState<string | null>(null);
  const [interpretacaoErro, setInterpretacaoErro] = useState<Record<string, string>>({});

  const processarPasta = useCallback(async (handle: LocalDirectoryHandle, resetCache: boolean) => {
    setLoading(true);
    setProgress(null);
    try {
      const selecionados = await collectDirectoryFiles(handle);
      if (!selecionados.length) {
        setStatus("Nenhuma planilha (.xlsx/.xls/.csv) encontrada nessa pasta.");
        return;
      }
      const resultado = await sincronizarArquivos(selecionados, parseSelectedFile, {
        rootName: handle.name,
        resetCache,
        onProgress: (p) => setProgress(p),
      });
      setFiles(resultado.files);
      setRootName(handle.name);
      setStatus(
        resultado.novos
          ? `${resultado.novos} arquivo(s) processado(s) · ${resultado.reaproveitados} reaproveitado(s) do cache local`
          : `Tudo em dia · ${resultado.reaproveitados} arquivo(s) reaproveitado(s) do cache local`
      );
    } catch {
      setStatus("Não foi possível ler a pasta. Tente novamente.");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, []);

  const processarArquivosSoltos = useCallback(async (fileList: FileList, resetCache: boolean) => {
    setLoading(true);
    setProgress(null);
    try {
      const selecionados = Array.from(fileList).map((file) => ({
        file,
        path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
      }));
      const resultado = await sincronizarArquivos(selecionados, parseSelectedFile, {
        rootName: "Pasta selecionada",
        resetCache,
        onProgress: (p) => setProgress(p),
      });
      setFiles(resultado.files);
      setRootName("Pasta selecionada");
      setStatus(
        resultado.novos
          ? `${resultado.novos} arquivo(s) processado(s) · ${resultado.reaproveitados} reaproveitado(s) do cache local`
          : `Tudo em dia · ${resultado.reaproveitados} arquivo(s) reaproveitado(s) do cache local`
      );
    } catch {
      setStatus("Não foi possível ler os arquivos selecionados.");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, []);

  useEffect(() => {
    let ativo = true;
    void (async () => {
      setSuportaFsAccess(Boolean(window.showDirectoryPicker));
      const [cached, regrasSalvas] = await Promise.all([getCachedFiles(), obterRegras()]);
      if (!ativo) return;
      setRegras(regrasSalvas);
      if (cached.files.length) {
        setFiles(cached.files);
        setRootName(cached.meta?.rootName ?? "Pasta selecionada");
        setStatus("Dados salvos abertos neste computador");
      } else {
        setStatus("Pronto para conectar a pasta");
      }
      if (typeof window !== "undefined" && window.showDirectoryPicker) {
        const handle = await getSavedDirectoryHandle();
        setPastaConectada(Boolean(handle));
        if (handle) {
          const permissao = await handle.queryPermission?.({ mode: "read" });
          if (permissao === "granted") {
            setStatus("Verificando arquivos novos ou alterados...");
            await processarPasta(handle, false);
            return;
          }
          if (cached.files.length) setStatus("Dados salvos · clique em Atualizar para sincronizar");
        }
      }
    })();
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function atualizar(trocarPasta = false) {
    if (!window.showDirectoryPicker) {
      resetCacheRef.current = trocarPasta;
      inputRef.current?.click();
      return;
    }
    try {
      let handle = trocarPasta ? null : await getSavedDirectoryHandle();
      let novaPasta = trocarPasta;
      if (handle) {
        let permissao = await handle.queryPermission?.({ mode: "read" });
        if (permissao !== "granted") permissao = await handle.requestPermission?.({ mode: "read" });
        if (permissao !== "granted") {
          handle = null;
          novaPasta = true;
        }
      }
      if (!handle) {
        handle = await window.showDirectoryPicker();
        await saveDirectoryHandle(handle);
        setPastaConectada(true);
        novaPasta = true;
      }
      await processarPasta(handle, novaPasta);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus("Não foi possível acessar a pasta gravada. Clique em Trocar pasta e autorize novamente.");
    }
  }

  const estado = useMemo(() => (files.length ? combinarArquivos(files) : ESTADO_VAZIO), [files]);
  const alvos = useMemo(() => gerarAlvos(estado, regras), [estado, regras]);

  const alvosRelevantes = useMemo(
    () => (ocultarIrrelevantes ? alvos.filter((a) => !statusEhIrrelevante(a.statusUltimaVisita)) : alvos),
    [alvos, ocultarIrrelevantes]
  );
  const ocultosCount = alvos.length - alvosRelevantes.length;

  const cidadesDisponiveis = useMemo(() => {
    const set = new Set<string>();
    for (const a of alvosRelevantes) if (a.cidade) set.add(a.cidade);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [alvosRelevantes]);

  const bairrosDisponiveis = useMemo(() => {
    const set = new Set<string>();
    for (const a of alvosRelevantes) {
      if (!a.bairro) continue;
      if (filtroCidade && a.cidade !== filtroCidade) continue;
      set.add(a.bairro);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [alvosRelevantes, filtroCidade]);

  const alvosFiltrados = useMemo(
    () =>
      alvosRelevantes.filter((a) => {
        if (filtroCidade && a.cidade !== filtroCidade) return false;
        if (filtroBairro && a.bairro !== filtroBairro) return false;
        return true;
      }),
    [alvosRelevantes, filtroCidade, filtroBairro]
  );

  const alvosOrdenados = useMemo(() => {
    if (!ordenarPor) return alvosFiltrados;
    const copia = [...alvosFiltrados];
    copia.sort((a, b) => {
      const va = a[ordenarPor];
      const vb = b[ordenarPor];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "number" && typeof vb === "number") return ordemDesc ? vb - va : va - vb;
      return ordemDesc ? String(vb).localeCompare(String(va)) : String(va).localeCompare(String(vb));
    });
    return copia;
  }, [alvosFiltrados, ordenarPor, ordemDesc]);

  const regiaoResumo = useMemo(() => {
    const mapa = new Map<string, { cidade: string; bairro: string; qtd: number; nuncaVisitado: number }>();
    for (const a of alvosRelevantes) {
      const chave = `${a.cidade}|${a.bairro}`;
      const atual = mapa.get(chave) ?? { cidade: a.cidade, bairro: a.bairro, qtd: 0, nuncaVisitado: 0 };
      atual.qtd += 1;
      if (a.motivoInclusao === "Nunca visitado") atual.nuncaVisitado += 1;
      mapa.set(chave, atual);
    }
    return [...mapa.values()].sort((a, b) => b.qtd - a.qtd);
  }, [alvosRelevantes]);

  const incrementoEconomias = useMemo(() => calcularIncrementoEconomias(alvosRelevantes), [alvosRelevantes]);
  const cadastralPendente = useMemo(() => calcularCadastralPendente(alvosRelevantes), [alvosRelevantes]);
  const possivelLigacaoNova = useMemo(() => calcularPossivelLigacaoNova(alvosRelevantes), [alvosRelevantes]);

  const cadastroCompleto = useMemo(() => [...estado.cadastroConsolidado.values()], [estado]);
  const estourosConsumo = useMemo(() => calcularEstourosConsumo(cadastroCompleto), [cadastroCompleto]);
  const socialMultiEconomia = useMemo(() => calcularSocialMultiEconomia(cadastroCompleto), [cadastroCompleto]);

  const socialTresMeses = useMemo(
    () => estourosConsumo.tresMeses.filter((a) => a.categoriaRotulo === "Social"),
    [estourosConsumo]
  );
  const socialDoisMeses = useMemo(
    () => estourosConsumo.doisMeses.filter((a) => a.categoriaRotulo === "Social"),
    [estourosConsumo]
  );
  const pequenoComercioTresMeses = useMemo(
    () => estourosConsumo.tresMeses.filter((a) => a.categoriaRotulo === "Pequeno Comércio"),
    [estourosConsumo]
  );
  const pequenoComercioDoisMeses = useMemo(
    () => estourosConsumo.doisMeses.filter((a) => a.categoriaRotulo === "Pequeno Comércio"),
    [estourosConsumo]
  );

  const arquivosDesconhecidos = files.filter((f) => f.tipo === "desconhecido");
  const arquivosField = files.filter((f) => f.tipo === "field");
  const arquivosCadastral = files.filter((f) => f.tipo === "cadastral");

  function alternarOrdenacao(chave: keyof AlvoRow) {
    if (ordenarPor === chave) setOrdemDesc((d) => !d);
    else {
      setOrdenarPor(chave);
      setOrdemDesc(true);
    }
  }

  async function atualizarRegra(index: number, campo: "status" | "dias", valor: string) {
    const novas = [...regras];
    novas[index] = { ...novas[index], [campo]: campo === "dias" ? Number(valor) || 0 : valor };
    setRegras(novas);
    await salvarRegras(novas);
  }

  async function removerRegra(index: number) {
    const novas = regras.filter((_, i) => i !== index);
    setRegras(novas);
    await salvarRegras(novas);
  }

  async function adicionarRegra() {
    const novas = [...regras, { status: "", dias: 30 }];
    setRegras(novas);
  }

  function executarBusca(matriculasBrutas: string[]) {
    const unicas = [...new Set(matriculasBrutas.map((m) => m.trim()).filter(Boolean))];
    const resultados: ResultadoBusca[] = unicas.map((m) => ({
      matricula: m,
      ultima: estado.ultimaVisitaPorMatricula.get(m) ?? null,
      historico: estado.historicoPorMatricula.get(m) ?? [],
    }));
    setBuscaResultados(resultados);
    setBuscaErro(unicas.length ? "" : "Nenhuma matrícula informada.");
  }

  function handleBuscarTexto() {
    executarBusca(extrairMatriculasDeTexto(buscaTexto));
  }

  async function handleBuscarArquivo(file: File) {
    setBuscaCarregando(true);
    setBuscaErro("");
    try {
      const matriculas = await extrairMatriculasDeArquivo(file);
      setBuscaTexto(matriculas.join("\n"));
      executarBusca(matriculas);
    } catch (error) {
      setBuscaErro(error instanceof Error ? error.message : "Não foi possível ler o arquivo.");
    } finally {
      setBuscaCarregando(false);
    }
  }

  function investigarMatricula(matricula: string) {
    setAba("buscar");
    setBuscaTexto(matricula);
    executarBusca([matricula]);
    setMatriculaExpandida(matricula);
  }

  async function handleInterpretar(v: VisitaRow) {
    const chave = `${v.matricula}|${v.dataVisita}|${v.os}`;
    setInterpretando(chave);
    setInterpretacaoErro((prev) => ({ ...prev, [chave]: "" }));
    try {
      const resultado = await interpretarParecer({
        matricula: v.matricula,
        parecer: v.parecerCampo,
        status: v.status,
        tipoAtividade: v.tipoAtividade,
        dataVisita: v.dataVisita,
      });
      setInterpretacoes((prev) => ({ ...prev, [chave]: resultado }));
    } catch (error) {
      setInterpretacaoErro((prev) => ({
        ...prev,
        [chave]: error instanceof Error ? error.message : "Falha ao interpretar com IA.",
      }));
    } finally {
      setInterpretando(null);
    }
  }

  return (
    <main className="page">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".xlsx,.xls,.xlsm,.csv"
        style={{ display: "none" }}
        onChange={(event) => {
          if (event.target.files?.length) {
            const resetCache = resetCacheRef.current;
            resetCacheRef.current = false;
            void processarArquivosSoltos(event.target.files, resetCache);
          }
          event.target.value = "";
        }}
        {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
      />

      <header className="app-header">
        <div className="header-row">
          <div>
            <h1>Gestão de Alvos de Campo</h1>
            <p className="subtitle">
              Cruza visitas do field com a base cadastral — sem repetir quem já foi visitado sem sucesso.
            </p>
          </div>
          <div className="header-actions">
            <button onClick={() => atualizar(false)} disabled={loading} className="btn btn-light">
              {pastaConectada || files.length ? "Atualizar" : "Conectar pasta"}
            </button>
            {(pastaConectada || files.length > 0) && (
              <button onClick={() => atualizar(true)} disabled={loading} className="btn btn-outline">
                Trocar pasta
              </button>
            )}
          </div>
        </div>
        <div className="status-line">
          {progress ? `Processando ${progress.atual}/${progress.total} · ${progress.nomeArquivo}` : status}
          {rootName ? ` · pasta: ${rootName}` : ""}
        </div>
      </header>

      {!suportaFsAccess && (
        <div className="banner-warning">
          Seu navegador não guarda a autorização da pasta entre visitas (isso funciona melhor no Chrome ou Edge). Você
          ainda pode usar o app, só vai precisar reselecionar a pasta a cada visita.
        </div>
      )}

      <div className="container" style={{ paddingTop: 16 }}>
        <div className="tabbar">
          {(
            [
              ["alvos", `Base de alvos (${alvosFiltrados.length})`],
              ["regiao", "Por região"],
              ["oportunidades", "Oportunidades"],
              ["consumo", `Consumo Social/Comércio (${estourosConsumo.tresMeses.length + estourosConsumo.doisMeses.length})`],
              ["buscar", "Buscar matrícula(s)"],
              ["regras", `Regras de resfriamento (${regras.length})`],
              ["auditoria", `Auditoria (${files.length} arquivos)`],
            ] as const
          ).map(([chave, titulo]) => (
            <button
              key={chave}
              onClick={() => setAba(chave as Aba)}
              className={`tab-btn ${aba === chave ? "active" : ""}`}
            >
              {titulo}
            </button>
          ))}
        </div>

        <div className="kpi-row">
          <Kpi titulo="Visitas no histórico" valor={estado.totalVisitas} />
          <Kpi titulo="Matrículas na base cadastral" valor={estado.cadastroConsolidado.size} />
          <Kpi titulo="Disponíveis como alvo agora" valor={alvosRelevantes.length} />
        </div>

        {aba === "alvos" && (
          <section className="card">
            <div className="toolbar">
              <p className="card-subtitle" style={{ marginBottom: 0 }}>
                Clique numa coluna para ordenar. Exclui quem está dentro da janela de resfriamento configurada em
                &quot;Regras de resfriamento&quot;.
              </p>
              <button
                onClick={() => exportarAlvosExcel(alvosOrdenados)}
                disabled={!alvosOrdenados.length}
                className="btn btn-success"
              >
                Baixar Excel
              </button>
            </div>

            <div className="filters-row">
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={ocultarIrrelevantes}
                  onChange={(e) => setOcultarIrrelevantes(e.target.checked)}
                />
                Ocultar Cancelada/Paralisada/Pendente {ocultosCount > 0 ? `(${ocultosCount} oculto(s))` : ""}
              </label>
              <select value={filtroCidade} onChange={(e) => { setFiltroCidade(e.target.value); setFiltroBairro(""); }}>
                <option value="">Todas as cidades</option>
                {cidadesDisponiveis.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select value={filtroBairro} onChange={(e) => setFiltroBairro(e.target.value)} disabled={!bairrosDisponiveis.length}>
                <option value="">Todos os bairros</option>
                {bairrosDisponiveis.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              {(filtroCidade || filtroBairro) && (
                <button onClick={() => { setFiltroCidade(""); setFiltroBairro(""); }} className="btn btn-light btn-sm">
                  Limpar filtro
                </button>
              )}
            </div>

            {estado.cadastroConsolidado.size === 0 ? (
              <Vazio texto="Conecte a pasta com os arquivos do field e da base cadastral para gerar alvos." />
            ) : alvosOrdenados.length === 0 ? (
              <Vazio texto="Nenhum alvo com os filtros atuais." />
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {COLUNAS_ALVO.map((c) => (
                        <th key={c.chave} onClick={() => alternarOrdenacao(c.chave)}>
                          {c.titulo} {ordenarPor === c.chave ? (ordemDesc ? "▼" : "▲") : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {alvosOrdenados.map((a) => (
                      <tr key={a.matricula}>
                        {COLUNAS_ALVO.map((c) => (
                          <td key={c.chave}>{String(a[c.chave] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {aba === "regiao" && (
          <section className="card">
            <p className="card-subtitle">
              Quantidade de alvos disponíveis agora por cidade e bairro (já considerando o filtro de status
              irrelevantes acima). Clique numa linha para ver esses alvos na Base de alvos.
            </p>
            {regiaoResumo.length === 0 ? (
              <Vazio texto="Nenhum alvo disponível para agrupar por região." />
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Cidade</th>
                      <th>Bairro</th>
                      <th>Alvos disponíveis</th>
                      <th>Nunca visitados</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {regiaoResumo.map((r) => (
                      <tr key={`${r.cidade}|${r.bairro}`}>
                        <td>{r.cidade || "(sem cidade)"}</td>
                        <td>{r.bairro || "(sem bairro)"}</td>
                        <td>{r.qtd}</td>
                        <td>{r.nuncaVisitado}</td>
                        <td>
                          <button
                            onClick={() => { setFiltroCidade(r.cidade); setFiltroBairro(r.bairro); setAba("alvos"); }}
                            className="btn btn-soft btn-sm"
                          >
                            Ver na base de alvos
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {aba === "oportunidades" && (
          <div className="card-stack">
            <section className="card">
              <h3>Possível incremento de economias</h3>
              <p className="card-subtitle">
                Consumo por economia bem acima da média entre os alvos disponíveis — pode indicar mais unidades
                habitadas no imóvel do que o número de economias cadastrado.
              </p>
              <TabelaOportunidade
                itens={incrementoEconomias}
                colunaExtra={{ titulo: "Consumo/economia", render: (a) => (a.consumoPorEconomia !== null ? a.consumoPorEconomia.toFixed(1) : "-") }}
                onInvestigar={investigarMatricula}
              />
            </section>
            <section className="card">
              <h3>Atualização cadastral pendente</h3>
              <p className="card-subtitle">
                Situação documental vazia, pendente, irregular, em análise, suspensa ou cancelada.
              </p>
              <TabelaOportunidade
                itens={cadastralPendente}
                colunaExtra={{ titulo: "Situação documental", render: (a) => a.situacaoDocumental || "(vazio)" }}
                onInvestigar={investigarMatricula}
              />
            </section>
            <section className="card">
              <h3>Possível ligação nova / regularização</h3>
              <p className="card-subtitle">
                O texto do Parecer de Campo da última visita menciona algo como ligação clandestina, imóvel sem
                ligação, obra ou construção nova. É uma busca por palavras-chave — confirme com &quot;Interpretar
                com IA&quot; na aba Buscar matrícula(s).
              </p>
              <TabelaOportunidade
                itens={possivelLigacaoNova}
                colunaExtra={{ titulo: "Status última visita", render: (a) => a.statusUltimaVisita }}
                onInvestigar={investigarMatricula}
              />
            </section>
          </div>
        )}

        {aba === "consumo" && (
          <div className="card-stack">
            <div className="info-banner">
              Limites considerados: <strong>Social até 15m³</strong> e <strong>Pequeno Comércio até 10m³</strong> por
              mês. &quot;Estourou&quot; só conta quando o consumo <strong>medido E o faturado</strong> passam do
              limite da categoria — exigir os dois evita contar ligação sem consumo real (hidrômetro em 0, às vezes
              cortada) que ainda assim recebe cobrança mínima acima do limite. A base são os{" "}
              <strong>2 meses fechados mais recentes</strong> (ex: Julho e Agosto). O terceiro mês (ex: Setembro)
              entra <strong>por matrícula, assim que aquela matrícula tiver leitura dele</strong>: se também
              estourou, vai pra lista de 3 meses; se voltou pra dentro do limite, fica no radar; se ainda não foi
              lida no mês, fica no radar aguardando. A coluna &quot;Meses estourados (detalhe)&quot; mostra o valor
              medido e faturado de cada mês considerado.
            </div>
            <h3 className="section-heading">Social (limite 15m³)</h3>
            <TabelaComExport
              titulo="Estouraram consumo nos últimos 3 meses"
              descricao="Social com consumo acima de 15m³ nos 3 meses fechados mais recentes."
              itens={socialTresMeses}
              colunas={COLUNAS_ESTOURO}
              nomeArquivo="estouro_consumo_social_3_meses.xlsx"
              nomeAba="social_3_meses"
            />
            <TabelaComExport
              titulo="No radar: estouraram os 2 meses fechados anteriores"
              descricao="Ainda não são os 3 meses, mas já merecem acompanhamento — um mapeamento do que pode virar caso confirmado assim que o mês corrente fechar."
              itens={socialDoisMeses}
              colunas={COLUNAS_ESTOURO}
              nomeArquivo="estouro_consumo_social_radar_2_meses.xlsx"
              nomeAba="social_radar_2_meses"
            />

            <h3 className="section-heading">Pequeno Comércio (limite 10m³)</h3>
            <TabelaComExport
              titulo="Estouraram consumo nos últimos 3 meses"
              descricao="Pequeno Comércio com consumo acima de 10m³ nos 3 meses fechados mais recentes."
              itens={pequenoComercioTresMeses}
              colunas={COLUNAS_ESTOURO}
              nomeArquivo="estouro_consumo_peq_comercio_3_meses.xlsx"
              nomeAba="peq_comercio_3_meses"
            />
            <TabelaComExport
              titulo="No radar: estouraram os 2 meses fechados anteriores"
              descricao="Ainda não são os 3 meses, mas já merecem acompanhamento — um mapeamento do que pode virar caso confirmado assim que o mês corrente fechar."
              itens={pequenoComercioDoisMeses}
              colunas={COLUNAS_ESTOURO}
              nomeArquivo="estouro_consumo_peq_comercio_radar_2_meses.xlsx"
              nomeAba="peq_comercio_radar_2_meses"
            />

            <TabelaComExport
              titulo="Social com mais de 1 economia"
              descricao="Categoria Social com mais de uma economia cadastrada na mesma matrícula, excluindo conjuntos habitacionais (identificados pelo endereço: CONJ.HABIT., BNH, COHAB etc)."
              itens={socialMultiEconomia}
              colunas={COLUNAS_SOCIAL_MULTI}
              nomeArquivo="social_multi_economia.xlsx"
              nomeAba="social_multi_economia"
            />
          </div>
        )}

        {aba === "buscar" && (
          <section className="card">
            <p className="card-subtitle">
              Cole uma ou mais matrículas (uma por linha) ou envie um arquivo, e veja se já foram visitadas, o tipo
              de atividade, status, data e o que o técnico escreveu no Parecer de Campo — com interpretação por IA
              opcional, focada em oportunidades para Cadastro e Crescimento Vegetativo.
            </p>
            <div className="search-row">
              <textarea
                value={buscaTexto}
                onChange={(e) => setBuscaTexto(e.target.value)}
                placeholder={"Ex: 123456\n789012"}
                rows={4}
                style={{ width: 280, fontFamily: "inherit", fontSize: 13 }}
              />
              <div className="field-stack">
                <button onClick={handleBuscarTexto} disabled={!buscaTexto.trim()} className="btn btn-primary">
                  Buscar
                </button>
                <label className="field-hint">
                  ...ou envie um arquivo (.xlsx/.xls/.csv) com uma coluna de matrícula
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleBuscarArquivo(f);
                      e.target.value = "";
                    }}
                    style={{ display: "block", marginTop: 4 }}
                  />
                </label>
              </div>
            </div>
            {buscaCarregando && <p style={{ fontSize: 13 }}>Lendo arquivo...</p>}
            {buscaErro && <p style={{ fontSize: 13, color: "var(--vermelho)" }}>{buscaErro}</p>}
            {buscaResultados && buscaResultados.length > 0 && (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Matrícula</th>
                      <th>Já visitada?</th>
                      <th>Tipo de atividade</th>
                      <th>Status</th>
                      <th>Data</th>
                      <th>Cidade/Bairro</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {buscaResultados.map((r) => (
                      <Fragment key={r.matricula}>
                        <tr>
                          <td>{r.matricula}</td>
                          <td>{r.ultima ? "Sim" : "Não"}</td>
                          <td>{r.ultima?.tipoAtividade || "-"}</td>
                          <td>{r.ultima?.status || "-"}</td>
                          <td>{r.ultima?.dataVisita || "-"}</td>
                          <td>{r.ultima ? [r.ultima.cidade, r.ultima.bairro].filter(Boolean).join(" / ") || "-" : "-"}</td>
                          <td>
                            <button
                              onClick={() => setMatriculaExpandida(matriculaExpandida === r.matricula ? null : r.matricula)}
                              className="btn btn-soft btn-sm"
                            >
                              {matriculaExpandida === r.matricula ? "Fechar" : "Ver detalhes"}
                            </button>
                          </td>
                        </tr>
                        {matriculaExpandida === r.matricula && (
                          <tr>
                            <td colSpan={7} className="detail-panel">
                              <DetalheMatricula
                                resultado={r}
                                interpretacoes={interpretacoes}
                                interpretando={interpretando}
                                interpretacaoErro={interpretacaoErro}
                                onInterpretar={handleInterpretar}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {buscaResultados && buscaResultados.length === 0 && !buscaErro && <Vazio texto="Nenhuma matrícula pra mostrar." />}
          </section>
        )}

        {aba === "regras" && (
          <section className="card">
            <p className="card-subtitle">
              Por quantos dias uma matrícula fica fora da base de alvos depois de receber cada status na última
              visita. Status sem regra aqui aparece incluído por padrão (nunca some silenciosamente).
            </p>
            <div className="table-scroll short">
              <table>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Dias</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {regras.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          value={r.status}
                          onChange={(e) => atualizarRegra(i, "status", e.target.value)}
                          style={{ width: 320, maxWidth: "60vw" }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          value={r.dias}
                          onChange={(e) => atualizarRegra(i, "dias", e.target.value)}
                          style={{ width: 80 }}
                        />
                      </td>
                      <td>
                        <button onClick={() => removerRegra(i)} className="btn-link-danger">
                          remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={adicionarRegra} className="btn btn-soft" style={{ marginTop: 12 }}>
              + adicionar regra
            </button>
          </section>
        )}

        {aba === "auditoria" && (
          <section className="card">
            <p className="card-subtitle">
              {arquivosField.length} arquivo(s) do field · {arquivosCadastral.length} da base cadastral
              {arquivosDesconhecidos.length ? ` · ${arquivosDesconhecidos.length} não reconhecido(s)` : ""}
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Arquivo</th>
                    <th>Tipo</th>
                    <th>Linhas</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr key={f.path}>
                      <td>{f.path}</td>
                      <td>
                        {f.tipo === "field" ? "Field" : f.tipo === "cadastral" ? "Base cadastral" : "Não reconhecido"}
                      </td>
                      <td>{f.totalLinhas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function TabelaOportunidade({
  itens,
  colunaExtra,
  onInvestigar,
}: {
  itens: AlvoRow[];
  colunaExtra: { titulo: string; render: (a: AlvoRow) => string };
  onInvestigar: (matricula: string) => void;
}) {
  if (!itens.length) return <Vazio texto="Nenhum candidato encontrado com os dados atuais." />;
  return (
    <div className="table-scroll short">
      <table>
        <thead>
          <tr>
            <th>Matrícula</th>
            <th>Endereço</th>
            <th>Cidade/Bairro</th>
            <th>{colunaExtra.titulo}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {itens.map((a) => (
            <tr key={a.matricula}>
              <td>{a.matricula}</td>
              <td>{a.endereco}</td>
              <td>{[a.cidade, a.bairro].filter(Boolean).join(" / ") || "-"}</td>
              <td>{colunaExtra.render(a)}</td>
              <td>
                <button onClick={() => onInvestigar(a.matricula)} className="btn btn-soft btn-sm">
                  Investigar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabelaComExport<T extends { matricula: string }>({
  titulo,
  descricao,
  itens,
  colunas,
  nomeArquivo,
  nomeAba,
}: {
  titulo: string;
  descricao: string;
  itens: T[];
  colunas: ColunaExport<T>[];
  nomeArquivo: string;
  nomeAba: string;
}) {
  return (
    <section className="card">
      <div className="toolbar">
        <div>
          <h3>
            {titulo} <span style={{ color: "var(--texto-suave)", fontWeight: 500 }}>({itens.length})</span>
          </h3>
          <p className="card-subtitle" style={{ marginBottom: 0 }}>{descricao}</p>
        </div>
        <button
          onClick={() => exportarExcel(itens, colunas, nomeArquivo, nomeAba)}
          disabled={!itens.length}
          className="btn btn-success"
        >
          Baixar Excel
        </button>
      </div>
      {!itens.length ? (
        <Vazio texto="Nenhuma matrícula encontrada com os dados atuais." />
      ) : (
        <div className="table-scroll short">
          <table>
            <thead>
              <tr>
                {colunas.map((c) => (
                  <th key={String(c.chave)}>{c.titulo}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <tr key={item.matricula}>
                  {colunas.map((c) => (
                    <td key={String(c.chave)}>{String(item[c.chave] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DetalheMatricula({
  resultado,
  interpretacoes,
  interpretando,
  interpretacaoErro,
  onInterpretar,
}: {
  resultado: ResultadoBusca;
  interpretacoes: Record<string, InterpretacaoIA>;
  interpretando: string | null;
  interpretacaoErro: Record<string, string>;
  onInterpretar: (v: VisitaRow) => void;
}) {
  const ultima = resultado.ultima;
  const chave = ultima ? `${ultima.matricula}|${ultima.dataVisita}|${ultima.os}` : "";
  const interpretacao = chave ? interpretacoes[chave] : undefined;
  const erro = chave ? interpretacaoErro[chave] : undefined;
  const carregando = interpretando === chave;

  return (
    <div>
      {!ultima && (
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--texto-suave)" }}>
          Nenhuma visita registrada para essa matrícula.
        </p>
      )}
      {ultima && (
        <>
          <p style={{ margin: "0 0 8px", fontSize: 13 }}>
            <strong>Parecer de Campo (última visita, {ultima.dataVisita}):</strong>
            <br />
            {ultima.parecerCampo || <em>Sem texto registrado.</em>}
          </p>
          {ultima.parecerCampo && (
            <div style={{ marginBottom: 12 }}>
              <button onClick={() => onInterpretar(ultima)} disabled={carregando} className="btn btn-primary">
                {carregando ? "Interpretando..." : interpretacao ? "Reinterpretar com IA" : "Interpretar com IA"}
              </button>
              {erro && <p style={{ color: "var(--vermelho)", fontSize: 12, marginTop: 6 }}>{erro}</p>}
              {interpretacao && (
                <div style={{ marginTop: 8, background: "#fff", border: "1px solid var(--borda)", borderRadius: 8, padding: 12, fontSize: 13 }}>
                  <p style={{ margin: "0 0 8px" }}>{interpretacao.resumo}</p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Badge
                      texto={interpretacao.oportunidade ? "Oportunidade encontrada" : "Sem oportunidade clara"}
                      cor={interpretacao.oportunidade ? "var(--verde)" : "var(--texto-suave)"}
                    />
                    <Badge texto={`Categoria: ${interpretacao.categoria}`} cor="var(--azul)" />
                    <Badge
                      texto={interpretacao.recomendacaoVisita ? "Recomenda nova visita" : "Não recomenda nova visita"}
                      cor={interpretacao.recomendacaoVisita ? "var(--amarelo)" : "var(--texto-suave)"}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {resultado.historico.length > 0 && (
        <div className="table-scroll short">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Status</th>
                <th>OS</th>
                <th>Colaborador</th>
                <th>Endereço</th>
                <th>Observação</th>
              </tr>
            </thead>
            <tbody>
              {resultado.historico.map((v, i) => (
                <tr key={i}>
                  <td>{v.dataVisita}</td>
                  <td>{v.status}</td>
                  <td>{v.os}</td>
                  <td>{v.colaborador}</td>
                  <td>{v.endereco}</td>
                  <td>{v.observacao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Badge({ texto, cor }: { texto: string; cor: string }) {
  return (
    <span className="badge" style={{ background: cor }}>
      {texto}
    </span>
  );
}

function Kpi({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{titulo}</div>
      <div className="kpi-value">{valor.toLocaleString("pt-BR")}</div>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <div className="empty-state">{texto}</div>;
}
