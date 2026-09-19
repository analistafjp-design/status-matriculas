import type { CadastroConsolidado, ConsumoPeriodo } from "./types";

function normalizar(valor: string): string {
  return valor
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Limites de consumo mensal (m³) por categoria cadastral — acima disso a
// matrícula "estourou" o consumo esperado pra categoria. Os nomes reais da
// coluna SUB_CATEGORIA variam um pouco entre exportações (abreviado, com ou
// sem acento/pontuação), por isso cada categoria aceita mais de uma grafia.
const LIMITES: { rotulo: string; limite: number; grafias: string[] }[] = [
  { rotulo: "Social", limite: 15, grafias: ["SOCIAL"] },
  { rotulo: "Pequeno Comércio", limite: 10, grafias: ["PEQ. COMERCIO", "PEQ COMERCIO", "PEQUENO COMERCIO"] },
];

function limiteDaCategoria(categoria: string): { rotulo: string; limite: number } | null {
  const norm = normalizar(categoria);
  const encontrado = LIMITES.find((l) => l.grafias.includes(norm));
  return encontrado ? { rotulo: encontrado.rotulo, limite: encontrado.limite } : null;
}

// Conjuntos habitacionais legitimamente têm muitas economias e consumo
// agregado alto numa única matrícula — o endereço desses casos reais
// sempre carrega um desses termos (ex: "CONJ.HABIT.", "BLOCO 01 BNH", nome
// de companhia de habitação). Excluídos de todas as listas desta aba:
// tanto consumo quanto número de economias vêm inflados por serem várias
// unidades numa matrícula só, não uma anomalia de cadastro.
const PALAVRAS_CONJUNTO_HABITACIONAL = ["conj", "habit", "cohab", "cehab", "bnh"];

export function ehConjuntoHabitacional(endereco: string): boolean {
  const e = endereco.toLowerCase();
  return PALAVRAS_CONJUNTO_HABITACIONAL.some((p) => e.includes(p));
}

export type EstouroConsumo = CadastroConsolidado & {
  categoriaRotulo: string;
  limite: number;
  mesesEstourados: number;
  ultimosPeriodos: string;
};

const MESES_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function formatarPeriodoChave(periodoChave: string): string {
  const m = periodoChave.match(/^(\d{4})(\d{2})$/);
  if (!m) return periodoChave;
  const nomeMes = MESES_PT[Number(m[2]) - 1];
  return nomeMes ? `${nomeMes}/${m[1]}` : periodoChave;
}

// Só conta como estourado quando o consumo MEDIDO e o FATURADO passam do
// limite. Exigir os dois evita o falso positivo mais comum: ligação sem
// consumo real (hidrômetro medindo 0, às vezes cortada) que mesmo assim
// recebe uma cobrança mínima acima do limite — faturado alto sozinho não
// é consumo de verdade. Se só um dos dois existir na base, vale esse.
function estourouPeriodo(p: ConsumoPeriodo, limite: number): boolean {
  const valores = [p.consumo, p.consumoFaturado].filter((v): v is number => v !== null);
  return valores.length > 0 && valores.every((v) => v > limite);
}

function formatarPeriodo(p: ConsumoPeriodo): string {
  const partes = [
    p.consumo !== null ? `medido ${p.consumo}m³` : null,
    p.consumoFaturado !== null ? `faturado ${p.consumoFaturado}m³` : null,
  ].filter((v): v is string => v !== null);
  return `${formatarPeriodoChave(p.periodoChave)}: ${partes.join(" · ") || "-"}`;
}

// O mês corrente aparece na base com bem menos leituras do que um mês já
// fechado (os técnicos ainda estão lendo os hidrômetros ao longo do mês) —
// por isso ele não entra em nenhuma conta até "fechar": um período só
// conta como fechado se tiver pelo menos 70% das leituras do pico (mês
// mais completo já lido).
const LIMIAR_MES_FECHADO = 0.7;

// Os N meses fechados mais recentes — a mesma janela vale pra todo mundo
// (ex: sempre Junho/Julho/Agosto enquanto Setembro não fecha), em ordem
// crescente (mais antigo primeiro).
function ultimosMesesFechados(cadastro: CadastroConsolidado[], quantidade: number): string[] {
  const contagem = new Map<string, number>();
  for (const c of cadastro) {
    for (const p of c.historicoConsumo) {
      if (p.consumo === null) continue;
      contagem.set(p.periodoChave, (contagem.get(p.periodoChave) ?? 0) + 1);
    }
  }
  if (!contagem.size) return [];
  const pico = Math.max(...contagem.values());
  return [...contagem.keys()]
    .filter((chave) => (contagem.get(chave) ?? 0) >= pico * LIMIAR_MES_FECHADO)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, quantidade)
    .reverse();
}

function periodosDaJanela(historico: ConsumoPeriodo[], janela: string[]): ConsumoPeriodo[] {
  return janela
    .map((chave) => historico.find((p) => p.periodoChave === chave))
    .filter((p): p is ConsumoPeriodo => Boolean(p));
}

// Critério: "os dois meses anteriores" (ex: Julho e Agosto) pro radar —
// nunca o mês corrente, mesmo que ele já tenha alguma leitura pontual.
// Quando Setembro fechar, ele vira o terceiro mês e vira candidato à aba
// de 3 meses (Julho/Agosto/Setembro).
export function calcularEstourosConsumo(cadastro: CadastroConsolidado[]): {
  tresMeses: EstouroConsumo[];
  doisMeses: EstouroConsumo[];
} {
  const janela3 = ultimosMesesFechados(cadastro, 3);
  const janela2 = janela3.slice(-2);

  const tresMeses: EstouroConsumo[] = [];
  const doisMeses: EstouroConsumo[] = [];

  for (const cad of cadastro) {
    const info = limiteDaCategoria(cad.categoria);
    if (!info) continue;
    if (ehConjuntoHabitacional(cad.endereco)) continue;

    const periodos3 = periodosDaJanela(cad.historicoConsumo, janela3);
    const estourados3 = periodos3.filter((p) => estourouPeriodo(p, info.limite));
    if (janela3.length === 3 && estourados3.length === 3) {
      tresMeses.push({
        ...cad,
        categoriaRotulo: info.rotulo,
        limite: info.limite,
        mesesEstourados: 3,
        ultimosPeriodos: estourados3.map(formatarPeriodo).join(" · "),
      });
      continue;
    }

    const periodos2 = periodosDaJanela(cad.historicoConsumo, janela2);
    const estourados2 = periodos2.filter((p) => estourouPeriodo(p, info.limite));
    if (janela2.length === 2 && estourados2.length === 2) {
      doisMeses.push({
        ...cad,
        categoriaRotulo: info.rotulo,
        limite: info.limite,
        mesesEstourados: 2,
        ultimosPeriodos: estourados2.map(formatarPeriodo).join(" · "),
      });
    }
  }

  tresMeses.sort((a, b) => (b.consumoUltimoMes ?? 0) - (a.consumoUltimoMes ?? 0));
  doisMeses.sort((a, b) => (b.consumoUltimoMes ?? 0) - (a.consumoUltimoMes ?? 0));
  return { tresMeses, doisMeses };
}

export function calcularSocialMultiEconomia(cadastro: CadastroConsolidado[]): CadastroConsolidado[] {
  return cadastro
    .filter(
      (c) =>
        normalizar(c.categoria) === "SOCIAL" && (c.qtdEconomias ?? 0) > 1 && !ehConjuntoHabitacional(c.endereco)
    )
    .sort((a, b) => (b.qtdEconomias ?? 0) - (a.qtdEconomias ?? 0));
}
