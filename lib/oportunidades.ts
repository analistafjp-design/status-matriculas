import type { AlvoRow } from "./types";

// Status que não interessam visualmente na base de alvos por padrão —
// continuam contados no histórico, só somem da visão principal.
const PREFIXOS_STATUS_OCULTOS = ["cancelada", "paralisada", "pendente"];

export function statusEhIrrelevante(status: string): boolean {
  const s = status.trim().toLowerCase();
  return PREFIXOS_STATUS_OCULTOS.some((p) => s.startsWith(p));
}

const PALAVRAS_SITUACAO_PENDENTE = ["pend", "irregular", "analise", "análise", "cancel", "suspen"];

export function situacaoDocumentalPendente(situacao: string): boolean {
  const s = situacao.trim().toLowerCase();
  if (!s) return true;
  return PALAVRAS_SITUACAO_PENDENTE.some((p) => s.includes(p));
}

const PALAVRAS_LIGACAO_NOVA = [
  "sem ligação",
  "sem ligacao",
  "ligação nova",
  "ligacao nova",
  "liga nova",
  "obra nova",
  "construção nova",
  "construcao nova",
  "imóvel novo",
  "imovel novo",
  "clandestin",
  "gato",
  "sem hidrômetro",
  "sem hidrometro",
];

export function textoSugereLigacaoNova(texto: string): boolean {
  const t = texto.trim().toLowerCase();
  if (!t) return false;
  return PALAVRAS_LIGACAO_NOVA.some((p) => t.includes(p));
}

// Alvos com consumo por economia bem acima da média sugerem mais unidades
// consumindo água do que economias cadastradas — candidato a incremento.
export function calcularIncrementoEconomias(alvos: AlvoRow[], limiteFator = 1.5, maxResultados = 50): AlvoRow[] {
  const comConsumo = alvos.filter((a) => a.consumoPorEconomia !== null && a.consumoPorEconomia > 0);
  if (!comConsumo.length) return [];
  const media = comConsumo.reduce((soma, a) => soma + (a.consumoPorEconomia ?? 0), 0) / comConsumo.length;
  const limite = media * limiteFator;
  return comConsumo
    .filter((a) => (a.consumoPorEconomia ?? 0) >= limite)
    .sort((a, b) => (b.consumoPorEconomia ?? 0) - (a.consumoPorEconomia ?? 0))
    .slice(0, maxResultados);
}

export function calcularCadastralPendente(alvos: AlvoRow[], maxResultados = 50): AlvoRow[] {
  return alvos
    .filter((a) => situacaoDocumentalPendente(a.situacaoDocumental))
    .sort((a, b) => (b.diasDesdeUltimaVisita ?? 0) - (a.diasDesdeUltimaVisita ?? 0))
    .slice(0, maxResultados);
}

export function calcularPossivelLigacaoNova(alvos: AlvoRow[], maxResultados = 50): AlvoRow[] {
  return alvos
    .filter((a) => textoSugereLigacaoNova(a.parecerCampoUltimaVisita))
    .sort((a, b) => (b.diasDesdeUltimaVisita ?? 0) - (a.diasDesdeUltimaVisita ?? 0))
    .slice(0, maxResultados);
}
