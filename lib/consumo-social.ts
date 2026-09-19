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

function proximoPeriodoChave(chave: string): string | null {
  const m = chave.match(/^(\d{4})(\d{2})$/);
  if (!m) return null;
  let ano = Number(m[1]);
  let mes = Number(m[2]) + 1;
  if (mes > 12) {
    mes = 1;
    ano += 1;
  }
  return `${ano}${String(mes).padStart(2, "0")}`;
}

function temLeitura(p: ConsumoPeriodo): boolean {
  return p.consumo !== null || p.consumoFaturado !== null;
}

// Base: os 2 meses fechados mais recentes (ex: Julho e Agosto) — o mês
// corrente não conta como base porque a maioria das matrículas ainda nem
// foi lida nele. O terceiro mês é o mês seguinte a essa base (ex:
// Setembro), e ele entra na conta POR MATRÍCULA, só quando aquela
// matrícula já tem leitura dele:
//   - já tem leitura e também estourou  -> lista de 3 meses
//   - já tem leitura e ficou no limite  -> fica no radar (normalizou)
//   - ainda não foi lida nesse mês      -> fica no radar (aguardando)
export function calcularEstourosConsumo(cadastro: CadastroConsolidado[]): {
  tresMeses: EstouroConsumo[];
  doisMeses: EstouroConsumo[];
} {
  const base = ultimosMesesFechados(cadastro, 2);
  const mesSeguinte = base.length === 2 ? proximoPeriodoChave(base[1]) : null;

  const tresMeses: EstouroConsumo[] = [];
  const doisMeses: EstouroConsumo[] = [];

  for (const cad of cadastro) {
    const info = limiteDaCategoria(cad.categoria);
    if (!info) continue;
    if (ehConjuntoHabitacional(cad.endereco)) continue;

    const periodosBase = periodosDaJanela(cad.historicoConsumo, base);
    if (periodosBase.length !== 2) continue;
    if (!periodosBase.every((p) => estourouPeriodo(p, info.limite))) continue;

    const terceiro = mesSeguinte
      ? cad.historicoConsumo.find((p) => p.periodoChave === mesSeguinte && temLeitura(p))
      : undefined;

    if (terceiro && estourouPeriodo(terceiro, info.limite)) {
      tresMeses.push({
        ...cad,
        categoriaRotulo: info.rotulo,
        limite: info.limite,
        mesesEstourados: 3,
        ultimosPeriodos: [...periodosBase, terceiro].map(formatarPeriodo).join(" · "),
      });
      continue;
    }

    const detalhe = periodosBase.map(formatarPeriodo);
    if (terceiro) detalhe.push(`${formatarPeriodo(terceiro)} (dentro do limite)`);
    doisMeses.push({
      ...cad,
      categoriaRotulo: info.rotulo,
      limite: info.limite,
      mesesEstourados: 2,
      ultimosPeriodos: detalhe.join(" · "),
    });
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
