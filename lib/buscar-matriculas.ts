import { ALIASES_CADASTRAL, ALIASES_FIELD, sugerirColuna } from "./classify";

// Aceita matrículas separadas por linha, vírgula, ponto e vírgula ou
// espaço — cobre tanto colar uma lista de outra planilha quanto digitar
// uma só.
export function extrairMatriculasDeTexto(texto: string): string[] {
  const brutas = texto
    .split(/[\n,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
  return [...new Set(brutas)];
}

const ALIASES_MATRICULA = [...ALIASES_FIELD.matricula, ...ALIASES_CADASTRAL.matricula];

export async function extrairMatriculasDeArquivo(file: File): Promise<string[]> {
  const xlsx = window.XLSX;
  if (!xlsx) throw new Error("O leitor de Excel ainda está carregando. Aguarde alguns segundos e tente novamente.");

  const buffer = await file.arrayBuffer();
  const workbook = xlsx.read(buffer, { type: "array", cellDates: false, cellHTML: false, cellFormula: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) return [];

  const linhas = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false });
  if (!linhas.length) return [];

  const colunas = [...new Set(linhas.slice(0, 20).flatMap((l) => Object.keys(l).map((k) => k.trim())))];
  const colunaMatricula = sugerirColuna(colunas, ALIASES_MATRICULA) ?? colunas[0] ?? null;
  if (!colunaMatricula) return [];

  const valores = linhas
    .map((l) => String(l[colunaMatricula] ?? "").trim())
    .filter(Boolean);
  return [...new Set(valores)];
}
