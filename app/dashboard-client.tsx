"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AlvoRow, CachedFileData, LocalDirectoryHandle, RegraResfriamento } from "../lib/types";
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
import { exportarAlvosExcel } from "../lib/export-xlsx";

const ESTADO_VAZIO: EstadoDerivado = {
  ultimaVisitaPorMatricula: new Map(),
  historicoPorMatricula: new Map(),
  cadastroConsolidado: new Map(),
  totalVisitas: 0,
};

type Aba = "alvos" | "historico" | "auditoria" | "regras";

const COLUNAS_ALVO: { chave: keyof AlvoRow; titulo: string }[] = [
  { chave: "matricula", titulo: "Matrícula" },
  { chave: "endereco", titulo: "Endereço" },
  { chave: "consumoMedio", titulo: "Consumo médio" },
  { chave: "consumoUltimoMes", titulo: "Consumo último mês" },
  { chave: "mesesConsumoZero", titulo: "Meses consumo zero" },
  { chave: "qtdEconomias", titulo: "Qtd. economias" },
  { chave: "situacaoDocumental", titulo: "Situação documental" },
  { chave: "statusUltimaVisita", titulo: "Status última visita" },
  { chave: "diasDesdeUltimaVisita", titulo: "Dias s/ visita" },
  { chave: "motivoInclusao", titulo: "Motivo da inclusão" },
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
  const [buscaMatricula, setBuscaMatricula] = useState("");
  const [suportaFsAccess, setSuportaFsAccess] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const resetCacheRef = useRef(false);

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
  const alvosOrdenados = useMemo(() => {
    if (!ordenarPor) return alvos;
    const copia = [...alvos];
    copia.sort((a, b) => {
      const va = a[ordenarPor];
      const vb = b[ordenarPor];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "number" && typeof vb === "number") return ordemDesc ? vb - va : va - vb;
      return ordemDesc ? String(vb).localeCompare(String(va)) : String(va).localeCompare(String(vb));
    });
    return copia;
  }, [alvos, ordenarPor, ordemDesc]);

  const historicoBusca = buscaMatricula.trim() ? estado.historicoPorMatricula.get(buscaMatricula.trim()) ?? [] : [];
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

  return (
    <main style={{ minHeight: "100vh" }}>
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

      <header
        style={{
          background: "linear-gradient(90deg,#071F38,#0B3B66,#0D4B73)",
          color: "#fff",
          padding: "20px 24px",
        }}
      >
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22 }}>Gestão de Alvos de Campo</h1>
            <p style={{ margin: "4px 0 0", opacity: 0.85, fontSize: 13 }}>
              Cruza visitas do field com a base cadastral — sem repetir quem já foi visitado sem sucesso.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => atualizar(false)}
              disabled={loading}
              style={{
                background: "#fff",
                color: "#0B3B66",
                border: "none",
                borderRadius: 8,
                padding: "10px 18px",
                fontWeight: 600,
                opacity: loading ? 0.6 : 1,
              }}
            >
              {pastaConectada || files.length ? "Atualizar" : "Conectar pasta"}
            </button>
            {(pastaConectada || files.length > 0) && (
              <button
                onClick={() => atualizar(true)}
                disabled={loading}
                style={{ background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,.5)", borderRadius: 8, padding: "10px 14px" }}
              >
                Trocar pasta
              </button>
            )}
          </div>
        </div>
        <div style={{ maxWidth: 1400, margin: "10px auto 0", fontSize: 13, opacity: 0.9 }}>
          {progress ? `Processando ${progress.atual}/${progress.total} · ${progress.nomeArquivo}` : status}
          {rootName ? ` · pasta: ${rootName}` : ""}
        </div>
      </header>

      {!suportaFsAccess && (
        <div style={{ background: "#FEF6E7", color: "var(--amarelo)", padding: "10px 24px", fontSize: 13 }}>
          Seu navegador não guarda a autorização da pasta entre visitas (isso funciona melhor no Chrome ou Edge). Você
          ainda pode usar o app, só vai precisar reselecionar a pasta a cada visita.
        </div>
      )}

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "16px 24px" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {[
            ["alvos", `Base de alvos (${alvos.length})`],
            ["historico", "Consultar histórico"],
            ["regras", `Regras de resfriamento (${regras.length})`],
            ["auditoria", `Auditoria (${files.length} arquivos)`],
          ].map(([chave, titulo]) => (
            <button
              key={chave}
              onClick={() => setAba(chave as Aba)}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid var(--borda)",
                background: aba === chave ? "var(--azul)" : "#fff",
                color: aba === chave ? "#fff" : "var(--texto)",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {titulo}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <Kpi titulo="Visitas no histórico" valor={estado.totalVisitas} />
          <Kpi titulo="Matrículas na base cadastral" valor={estado.cadastroConsolidado.size} />
          <Kpi titulo="Disponíveis como alvo agora" valor={alvos.length} />
        </div>

        {aba === "alvos" && (
          <section style={{ background: "#fff", border: "1px solid var(--borda)", borderRadius: 10, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 13, color: "var(--texto-suave)" }}>
                Clique numa coluna para ordenar. Exclui quem está dentro da janela de resfriamento configurada em
                &quot;Regras de resfriamento&quot;.
              </p>
              <button
                onClick={() => exportarAlvosExcel(alvosOrdenados)}
                disabled={!alvosOrdenados.length}
                style={{ background: "var(--verde)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 600 }}
              >
                Baixar Excel
              </button>
            </div>
            {estado.cadastroConsolidado.size === 0 ? (
              <Vazio texto="Conecte a pasta com os arquivos do field e da base cadastral para gerar alvos." />
            ) : (
              <div style={{ overflowX: "auto", maxHeight: 600 }}>
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

        {aba === "historico" && (
          <section style={{ background: "#fff", border: "1px solid var(--borda)", borderRadius: 10, padding: 16 }}>
            <p style={{ marginTop: 0, fontSize: 13, color: "var(--texto-suave)" }}>
              Busque todas as visitas já registradas de uma matrícula específica.
            </p>
            <input
              placeholder="Matrícula/UC"
              value={buscaMatricula}
              onChange={(e) => setBuscaMatricula(e.target.value)}
              style={{ width: 240, marginBottom: 12 }}
            />
            {buscaMatricula.trim() && historicoBusca.length === 0 && <Vazio texto="Nenhuma visita encontrada para essa matrícula." />}
            {historicoBusca.length > 0 && (
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
                  {historicoBusca.map((v, i) => (
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
            )}
          </section>
        )}

        {aba === "regras" && (
          <section style={{ background: "#fff", border: "1px solid var(--borda)", borderRadius: 10, padding: 16 }}>
            <p style={{ marginTop: 0, fontSize: 13, color: "var(--texto-suave)" }}>
              Por quantos dias uma matrícula fica fora da base de alvos depois de receber cada status na última
              visita. Status sem regra aqui aparece incluído por padrão (nunca some silenciosamente).
            </p>
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
                        style={{ width: 380 }}
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
                      <button onClick={() => removerRegra(i)} style={{ background: "none", border: "none", color: "var(--vermelho)" }}>
                        remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              onClick={adicionarRegra}
              style={{ marginTop: 10, background: "var(--azul-claro)", color: "var(--azul)", border: "none", borderRadius: 8, padding: "8px 14px" }}
            >
              + adicionar regra
            </button>
          </section>
        )}

        {aba === "auditoria" && (
          <section style={{ background: "#fff", border: "1px solid var(--borda)", borderRadius: 10, padding: 16 }}>
            <p style={{ marginTop: 0, fontSize: 13, color: "var(--texto-suave)" }}>
              {arquivosField.length} arquivo(s) do field · {arquivosCadastral.length} da base cadastral
              {arquivosDesconhecidos.length ? ` · ${arquivosDesconhecidos.length} não reconhecido(s)` : ""}
            </p>
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
          </section>
        )}
      </div>
    </main>
  );
}

function Kpi({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--borda)", borderRadius: 10, padding: "12px 18px", minWidth: 180 }}>
      <div style={{ fontSize: 12, color: "var(--texto-suave)" }}>{titulo}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: "var(--azul)" }}>{valor.toLocaleString("pt-BR")}</div>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <div style={{ padding: 24, textAlign: "center", color: "var(--texto-suave)", fontSize: 13 }}>{texto}</div>;
}
