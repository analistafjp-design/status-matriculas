// Mapeamento de colunas conhecidas para cada tipo de arquivo. As listas
// abaixo cobrem os nomes reais observados nas exportações do field
// ("Atividades-INTERIOR...") e da base cadastral ("data_...", com uma
// linha por matrícula por mês). Mantém "matricula" nos dois porque ambos
// os arquivos reais têm uma coluna chamada "Matrícula" — por isso a
// classificação (abaixo) nunca usa esse campo sozinho.
export const ALIASES_FIELD: Record<string, string[]> = {
  matricula: ["Matrícula", "matricula", "NUM_LIGACAO", "UC"],
  dataVisita: ["Data", "Data da Visita", "data_visita"],
  status: ["Status da Atividade", "status"],
  motivo: ["Motivo de Não Execução - Normal", "Motivo de Não Execução", "motivo"],
  motivoAlt: ["Motivo de Não Execução - Cobrança"],
  os: ["ID da Atividade", "Cód. Protocolo Origem", "OS de Origem", "os"],
  colaborador: ["Recurso", "Técnico", "colaborador"],
  endereco: ["Endereço", "endereco"],
  cidade: ["Cidade", "cidade"],
  bairro: ["Bairro", "bairro"],
  tipoAtividade: ["Tipo de Atividade", "tipo_atividade"],
  parecerCampo: ["Parecer De Campo", "Parecer de Campo", "parecer_campo"],
  observacao: ["Observação", "Observações", "observacao"],
};

export const ALIASES_CADASTRAL: Record<string, string[]> = {
  matricula: ["NUM_LIGACAO", "Matrícula", "matricula", "UC"],
  endereco: ["END_LIGACAO", "Endereço", "endereco"],
  cidade: ["CIDADE", "Cidade", "cidade"],
  bairro: ["NOM_BAIRRO", "Bairro", "bairro"],
  categoria: ["SUB_CATEGORIA", "categoria"],
  periodo: ["Mês/Ano", "Mes/Ano", "periodo", "mes_ano"],
  consumo: ["CON_MEDIDO", "CON_FAT_AGUA", "consumo"],
  qtdEconomias: ["TOTAL_ECO", "Numero De Economias", "Quantidade De Economia", "qtd_economias"],
  situacaoDocumental: ["SIT_CONTRATO", "SIT_LIG", "situacao_documental"],
};

// Só colunas exclusivas de cada tipo decidem a classificação — "matricula"
// aparece nos dois arquivos reais com nomes parecidos e não serve como
// sinal (ver histórico: "Referência" já causou uma colisão parecida antes
// de ser removida do alias de período).
const CAMPOS_FIELD_DISTINTIVOS = ["status", "motivo"];
const CAMPOS_CADASTRAL_DISTINTIVOS = ["consumo", "periodo"];

export function sugerirColuna(colunasDisponiveis: string[], aliases: string[]): string | null {
  const normalizadas = colunasDisponiveis.map((c) => [c, c.trim().toLowerCase()] as const);
  for (const alias of aliases) {
    const aliasNorm = alias.trim().toLowerCase();
    for (const [coluna, norm] of normalizadas) {
      if (norm === aliasNorm) return coluna;
    }
  }
  for (const alias of aliases) {
    const aliasNorm = alias.trim().toLowerCase();
    for (const [coluna, norm] of normalizadas) {
      if (norm.includes(aliasNorm)) return coluna;
    }
  }
  return null;
}

export function mapearColunas(colunas: string[], aliases: Record<string, string[]>): Record<string, string | null> {
  const mapeamento: Record<string, string | null> = {};
  for (const campo of Object.keys(aliases)) {
    mapeamento[campo] = sugerirColuna(colunas, aliases[campo]);
  }
  return mapeamento;
}

export function classificarArquivo(colunas: string[]): "field" | "cadastral" | "desconhecido" {
  const temField = CAMPOS_FIELD_DISTINTIVOS.some((c) => sugerirColuna(colunas, ALIASES_FIELD[c]) !== null);
  const temCadastral = CAMPOS_CADASTRAL_DISTINTIVOS.some(
    (c) => sugerirColuna(colunas, ALIASES_CADASTRAL[c]) !== null
  );
  if (temField && !temCadastral) return "field";
  if (temCadastral && !temField) return "cadastral";
  return "desconhecido";
}
