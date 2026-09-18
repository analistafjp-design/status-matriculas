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

export type EstouroConsumo = CadastroConsolidado & {
  categoriaRotulo: string;
  limite: number;
  mesesEstourados: number;
  ultimosPeriodos: string;
};

function formatarUltimosPeriodos(periodos: ConsumoPeriodo[]): string {
  return periodos.map((p) => `${p.periodo}: ${p.consumo ?? "-"}m³`).join(" · ");
}

// Olha só os últimos até-3 períodos com dado de consumo — "os últimos três
// meses" na prática são os três períodos mais recentes que já lemos da base
// cadastral, não um calendário fixo.
export function calcularEstourosConsumo(cadastro: CadastroConsolidado[]): {
  tresMeses: EstouroConsumo[];
  doisMeses: EstouroConsumo[];
} {
  const tresMeses: EstouroConsumo[] = [];
  const doisMeses: EstouroConsumo[] = [];

  for (const cad of cadastro) {
    const info = limiteDaCategoria(cad.categoria);
    if (!info) continue;
    const ultimos = cad.historicoConsumo.slice(-3);
    if (ultimos.length < 2) continue;
    const mesesEstourados = ultimos.filter((p) => p.consumo !== null && p.consumo > info.limite).length;
    if (mesesEstourados < 2) continue;

    const item: EstouroConsumo = {
      ...cad,
      categoriaRotulo: info.rotulo,
      limite: info.limite,
      mesesEstourados,
      ultimosPeriodos: formatarUltimosPeriodos(ultimos),
    };
    if (mesesEstourados >= 3) tresMeses.push(item);
    else doisMeses.push(item);
  }

  tresMeses.sort((a, b) => (b.consumoUltimoMes ?? 0) - (a.consumoUltimoMes ?? 0));
  doisMeses.sort((a, b) => (b.consumoUltimoMes ?? 0) - (a.consumoUltimoMes ?? 0));
  return { tresMeses, doisMeses };
}

// Conjuntos habitacionais legitimamente têm muitas economias numa única
// matrícula — o endereço desses casos reais sempre carrega um desses
// termos (ex: "CONJ.HABIT.", "BLOCO 01 BNH", nome de companhia de
// habitação). Servem pra excluir o que não é uma anomalia de cadastro.
const PALAVRAS_CONJUNTO_HABITACIONAL = ["conj", "habit", "cohab", "cehab", "bnh"];

export function ehConjuntoHabitacional(endereco: string): boolean {
  const e = endereco.toLowerCase();
  return PALAVRAS_CONJUNTO_HABITACIONAL.some((p) => e.includes(p));
}

export function calcularSocialMultiEconomia(cadastro: CadastroConsolidado[]): CadastroConsolidado[] {
  return cadastro
    .filter(
      (c) =>
        normalizar(c.categoria) === "SOCIAL" && (c.qtdEconomias ?? 0) > 1 && !ehConjuntoHabitacional(c.endereco)
    )
    .sort((a, b) => (b.qtdEconomias ?? 0) - (a.qtdEconomias ?? 0));
}
