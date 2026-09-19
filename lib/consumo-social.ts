import type { CadastroConsolidado } from "./types";

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

// O mês corrente costuma aparecer na base com bem menos leituras do que um
// mês fechado (os técnicos ainda estão lendo os hidrômetros) — se ele
// entrasse na janela, quase ninguém bateria "3 meses" só por falta de
// leitura, não por estar realmente OK. Por isso um período só entra na
// janela se tiver pelo menos 70% das leituras do pico (mês mais completo
// já lido) — abaixo disso é tratado como "ainda em aberto" e pulado.
const LIMIAR_MES_FECHADO = 0.7;

// Os três meses mais recentes e já fechados que existem em QUALQUER
// matrícula da base cadastral já lida — a mesma janela vale pra todo mundo
// (ex: sempre Junho/Julho/Agosto, pulando um Setembro ainda incompleto),
// não varia matrícula a matrícula.
function ultimosTresMesesGlobais(cadastro: CadastroConsolidado[]): string[] {
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
    .slice(0, 3);
}

export function calcularEstourosConsumo(cadastro: CadastroConsolidado[]): {
  tresMeses: EstouroConsumo[];
  doisMeses: EstouroConsumo[];
  janela: string[];
} {
  const janelaChaves = ultimosTresMesesGlobais(cadastro);
  const tresMeses: EstouroConsumo[] = [];
  const doisMeses: EstouroConsumo[] = [];

  for (const cad of cadastro) {
    const info = limiteDaCategoria(cad.categoria);
    if (!info) continue;

    const periodosNaJanela = cad.historicoConsumo
      .filter((p) => janelaChaves.includes(p.periodoChave))
      .sort((a, b) => (a.periodoChave < b.periodoChave ? -1 : 1));
    const estourados = periodosNaJanela.filter((p) => p.consumo !== null && p.consumo > info.limite);
    if (estourados.length < 2) continue;

    const item: EstouroConsumo = {
      ...cad,
      categoriaRotulo: info.rotulo,
      limite: info.limite,
      mesesEstourados: estourados.length,
      ultimosPeriodos: estourados
        .map((p) => `${formatarPeriodoChave(p.periodoChave)}: ${p.consumo}m³`)
        .join(" · "),
    };
    if (estourados.length >= 3) tresMeses.push(item);
    else doisMeses.push(item);
  }

  tresMeses.sort((a, b) => (b.consumoUltimoMes ?? 0) - (a.consumoUltimoMes ?? 0));
  doisMeses.sort((a, b) => (b.consumoUltimoMes ?? 0) - (a.consumoUltimoMes ?? 0));
  return { tresMeses, doisMeses, janela: janelaChaves.slice().reverse().map(formatarPeriodoChave) };
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
