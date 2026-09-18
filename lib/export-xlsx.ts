import type { AlvoRow } from "./types";

export type ColunaExport<T> = { chave: keyof T; titulo: string };

export function exportarExcel<T extends Record<string, unknown>>(
  linhas: T[],
  colunas: ColunaExport<T>[],
  nomeArquivo: string,
  nomeAba = "dados"
) {
  const xlsx = window.XLSX;
  if (!xlsx) {
    window.alert("O leitor de Excel ainda está carregando. Aguarde alguns segundos e tente novamente.");
    return;
  }
  const linhasFormatadas = linhas.map((linha) => {
    const objeto: Record<string, unknown> = {};
    for (const { chave, titulo } of colunas) objeto[titulo] = linha[chave];
    return objeto;
  });
  const worksheet = xlsx.utils.json_to_sheet(linhasFormatadas);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, nomeAba.slice(0, 31));
  xlsx.writeFile(workbook, nomeArquivo);
}

const COLUNAS_ALVOS: ColunaExport<AlvoRow>[] = [
  { chave: "matricula", titulo: "Matrícula" },
  { chave: "endereco", titulo: "Endereço" },
  { chave: "cidade", titulo: "Cidade" },
  { chave: "bairro", titulo: "Bairro" },
  { chave: "consumoMedio", titulo: "Consumo médio" },
  { chave: "consumoUltimoMes", titulo: "Consumo último mês" },
  { chave: "mesesConsumoZero", titulo: "Meses consumo zero" },
  { chave: "periodoReferencia", titulo: "Período referência" },
  { chave: "qtdEconomias", titulo: "Qtd. economias" },
  { chave: "situacaoDocumental", titulo: "Situação documental" },
  { chave: "statusUltimaVisita", titulo: "Status última visita" },
  { chave: "dataUltimaVisita", titulo: "Data última visita" },
  { chave: "diasDesdeUltimaVisita", titulo: "Dias desde última visita" },
  { chave: "motivoInclusao", titulo: "Motivo inclusão" },
];

export function exportarAlvosExcel(alvos: AlvoRow[], nomeArquivo = "base_de_alvos.xlsx") {
  exportarExcel(alvos, COLUNAS_ALVOS, nomeArquivo, "alvos");
}
