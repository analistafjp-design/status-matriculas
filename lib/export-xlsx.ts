import type { AlvoRow } from "./types";

const COLUNAS: { chave: keyof AlvoRow; titulo: string }[] = [
  { chave: "matricula", titulo: "Matrícula" },
  { chave: "endereco", titulo: "Endereço" },
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
  const xlsx = window.XLSX;
  if (!xlsx) {
    window.alert("O leitor de Excel ainda está carregando. Aguarde alguns segundos e tente novamente.");
    return;
  }
  const linhas = alvos.map((alvo) => {
    const linha: Record<string, unknown> = {};
    for (const { chave, titulo } of COLUNAS) linha[titulo] = alvo[chave];
    return linha;
  });
  const worksheet = xlsx.utils.json_to_sheet(linhas);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "alvos");
  xlsx.writeFile(workbook, nomeArquivo);
}
