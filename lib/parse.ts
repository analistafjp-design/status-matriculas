import { ALIASES_CADASTRAL, ALIASES_FIELD, classificarArquivo, mapearColunas } from "./classify";
import type { CachedFileData, CadastralRow, SelectedFile, VisitaRow, XlsxWorkbook } from "./types";

export const PARSER_VERSION = 4;

function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "number" && Number.isNaN(valor)) return "";
  return String(valor).trim();
}

function toFloat(valor: unknown): number | null {
  const t = texto(valor).replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
}

function toInt(valor: unknown): number | null {
  const n = toFloat(valor);
  return n === null ? null : Math.trunc(n);
}

// Exportações de BI costumam terminar com uma linha de rodapé (ex: "Filtros
// aplicados: ..."), cujo texto às vezes cai justamente na coluna da
// matrícula. Uma matrícula de verdade é sempre um código curto — isso
// descarta esse tipo de linha sem depender de ela ser só dígitos (algumas
// concessionárias usam UC alfanumérica).
function matriculaValida(matricula: string): boolean {
  return matricula.length > 0 && matricula.length <= 30 && !/\s/.test(matricula);
}

// Converte um período tipo "MM/YYYY" ou "YYYY-MM" em algo ordenável
// ("YYYYMM"). Cai no texto original se não reconhecer o formato.
function periodoOrdenavel(valor: unknown): string {
  const t = texto(valor);
  const partes = t.replace(/-/g, "/").split("/");
  if (partes.length === 2) {
    const [a, b] = partes;
    if (a.length === 4 && /^\d+$/.test(a) && /^\d+$/.test(b)) {
      return `${a}${b.padStart(2, "0")}`;
    }
    if (b.length === 4 && /^\d+$/.test(b) && /^\d+$/.test(a)) {
      return `${b}${a.padStart(2, "0")}`;
    }
  }
  return t;
}

function lerPrimeiraAba(workbook: XlsxWorkbook, xlsx: NonNullable<Window["XLSX"]>): Record<string, unknown>[] {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false });
    if (rows.length || workbook.SheetNames.length === 1) return rows;
  }
  return [];
}

function extrairColunas(rows: Record<string, unknown>[]): string[] {
  const colunas = new Set<string>();
  // Basta olhar as primeiras linhas: todas as linhas de um mesmo arquivo
  // real compartilham as mesmas colunas.
  for (const row of rows.slice(0, 20)) {
    for (const chave of Object.keys(row)) colunas.add(chave.trim());
  }
  return [...colunas];
}

function montarVisitas(rows: Record<string, unknown>[], mapeamento: Record<string, string | null>): VisitaRow[] {
  const resultado: VisitaRow[] = [];
  for (const row of rows) {
    const matricula = mapeamento.matricula ? texto(row[mapeamento.matricula]) : "";
    const dataVisita = mapeamento.dataVisita ? texto(row[mapeamento.dataVisita]) : "";
    const statusBase = mapeamento.status ? texto(row[mapeamento.status]) : "";
    if (!matriculaValida(matricula) || !dataVisita || !statusBase) continue;

    const motivoPrincipal = mapeamento.motivo ? texto(row[mapeamento.motivo]) : "";
    const motivoAlt = mapeamento.motivoAlt ? texto(row[mapeamento.motivoAlt]) : "";
    const motivo = motivoPrincipal || motivoAlt;
    const status = motivo ? `${statusBase} - ${motivo}` : statusBase;

    resultado.push({
      matricula,
      dataVisita,
      status,
      motivo,
      os: mapeamento.os ? texto(row[mapeamento.os]) : "",
      colaborador: mapeamento.colaborador ? texto(row[mapeamento.colaborador]) : "",
      endereco: mapeamento.endereco ? texto(row[mapeamento.endereco]) : "",
      cidade: mapeamento.cidade ? texto(row[mapeamento.cidade]) : "",
      bairro: mapeamento.bairro ? texto(row[mapeamento.bairro]) : "",
      tipoAtividade: mapeamento.tipoAtividade ? texto(row[mapeamento.tipoAtividade]) : "",
      parecerCampo: mapeamento.parecerCampo ? texto(row[mapeamento.parecerCampo]) : "",
      observacao: mapeamento.observacao ? texto(row[mapeamento.observacao]) : "",
    });
  }
  return resultado;
}

function montarCadastral(rows: Record<string, unknown>[], mapeamento: Record<string, string | null>): CadastralRow[] {
  const resultado: CadastralRow[] = [];
  for (const row of rows) {
    const matricula = mapeamento.matricula ? texto(row[mapeamento.matricula]) : "";
    if (!matriculaValida(matricula)) continue;
    const periodoValor = mapeamento.periodo ? row[mapeamento.periodo] : null;
    resultado.push({
      matricula,
      endereco: mapeamento.endereco ? texto(row[mapeamento.endereco]) : "",
      cidade: mapeamento.cidade ? texto(row[mapeamento.cidade]) : "",
      bairro: mapeamento.bairro ? texto(row[mapeamento.bairro]) : "",
      categoria: mapeamento.categoria ? texto(row[mapeamento.categoria]) : "",
      qtdEconomias: mapeamento.qtdEconomias ? toInt(row[mapeamento.qtdEconomias]) : null,
      situacaoDocumental: mapeamento.situacaoDocumental ? texto(row[mapeamento.situacaoDocumental]) : "",
      periodo: mapeamento.periodo ? texto(periodoValor) : "único",
      periodoChave: mapeamento.periodo ? periodoOrdenavel(periodoValor) : "0",
      consumo: mapeamento.consumo ? toFloat(row[mapeamento.consumo]) : null,
      consumoFaturado: mapeamento.consumoFaturado ? toFloat(row[mapeamento.consumoFaturado]) : null,
    });
  }
  return resultado;
}

export async function parseSelectedFile(input: SelectedFile): Promise<CachedFileData> {
  const base: Omit<CachedFileData, "tipo" | "visitas" | "cadastral" | "totalLinhas" | "colunasAusentes"> = {
    path: input.path,
    name: input.file.name,
    size: input.file.size,
    lastModified: input.file.lastModified,
    parserVersion: PARSER_VERSION,
  };

  const xlsx = window.XLSX;
  if (!xlsx) throw new Error("O leitor de Excel ainda está carregando. Aguarde alguns segundos e tente novamente.");

  const buffer = await input.file.arrayBuffer();
  const workbook = xlsx.read(buffer, {
    type: "array",
    cellDates: false,
    cellHTML: false,
    cellFormula: false,
  });
  const rows = lerPrimeiraAba(workbook, xlsx);
  const colunas = extrairColunas(rows);
  const tipo = classificarArquivo(colunas);

  if (tipo === "field") {
    const mapeamento = mapearColunas(colunas, ALIASES_FIELD);
    return { ...base, tipo, visitas: montarVisitas(rows, mapeamento), cadastral: [], totalLinhas: rows.length };
  }
  if (tipo === "cadastral") {
    const mapeamento = mapearColunas(colunas, ALIASES_CADASTRAL);
    return { ...base, tipo, visitas: [], cadastral: montarCadastral(rows, mapeamento), totalLinhas: rows.length };
  }
  return { ...base, tipo, visitas: [], cadastral: [], totalLinhas: rows.length };
}
