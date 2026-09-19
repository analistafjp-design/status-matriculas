import type { AlvoRow, CachedFileData, CadastroConsolidado, RegraResfriamento, VisitaRow } from "./types";

// Interpreta datas em formatos comuns de exportação (dd/mm/aaaa, dd/mm/aa,
// aaaa-mm-dd). Ano de 2 dígitos segue a mesma regra do Python (%y): 00-68
// vira 20xx, 69-99 vira 19xx.
export function parseData(valor: string): Date | null {
  const t = valor.trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})(?!\d)/);
  if (m) {
    const yy = Number(m[3]);
    const ano = yy <= 68 ? 2000 + yy : 1900 + yy;
    return new Date(ano, Number(m[2]) - 1, Number(m[1]));
  }
  return null;
}

const chaveVisita = (v: VisitaRow) => `${v.matricula}|${v.dataVisita}|${v.os}|${v.status}`;

export type EstadoDerivado = {
  ultimaVisitaPorMatricula: Map<string, VisitaRow>;
  historicoPorMatricula: Map<string, VisitaRow[]>;
  cadastroConsolidado: Map<string, CadastroConsolidado>;
  totalVisitas: number;
};

export function combinarArquivos(files: CachedFileData[]): EstadoDerivado {
  const visitasUnicas = new Map<string, VisitaRow>();
  for (const f of files) {
    if (f.tipo !== "field") continue;
    for (const v of f.visitas) visitasUnicas.set(chaveVisita(v), v);
  }

  const historicoPorMatricula = new Map<string, VisitaRow[]>();
  for (const v of visitasUnicas.values()) {
    const lista = historicoPorMatricula.get(v.matricula) ?? [];
    lista.push(v);
    historicoPorMatricula.set(v.matricula, lista);
  }

  const ultimaVisitaPorMatricula = new Map<string, VisitaRow>();
  for (const [matricula, lista] of historicoPorMatricula) {
    let melhor: VisitaRow | null = null;
    let melhorData: number = -Infinity;
    for (const v of lista) {
      const d = parseData(v.dataVisita);
      const t = d ? d.getTime() : -Infinity;
      if (!melhor || t >= melhorData) {
        melhor = v;
        melhorData = t;
      }
    }
    if (melhor) ultimaVisitaPorMatricula.set(matricula, melhor);
    lista.sort((a, b) => {
      const da = parseData(a.dataVisita)?.getTime() ?? -Infinity;
      const db = parseData(b.dataVisita)?.getTime() ?? -Infinity;
      return db - da;
    });
  }

  type Estatico = {
    endereco: string;
    cidade: string;
    bairro: string;
    categoria: string;
    qtdEconomias: number | null;
    situacaoDocumental: string;
    periodoChave: string;
  };
  const estaticos = new Map<string, Estatico>();
  const consumoPorMatricula = new Map<
    string,
    Map<string, { periodo: string; consumo: number | null; consumoFaturado: number | null }>
  >();

  for (const f of files) {
    if (f.tipo !== "cadastral") continue;
    for (const r of f.cadastral) {
      const atual = estaticos.get(r.matricula);
      if (!atual || r.periodoChave >= atual.periodoChave) {
        estaticos.set(r.matricula, {
          endereco: r.endereco,
          cidade: r.cidade,
          bairro: r.bairro,
          categoria: r.categoria,
          qtdEconomias: r.qtdEconomias,
          situacaoDocumental: r.situacaoDocumental,
          periodoChave: r.periodoChave,
        });
      }
      let periodos = consumoPorMatricula.get(r.matricula);
      if (!periodos) {
        periodos = new Map();
        consumoPorMatricula.set(r.matricula, periodos);
      }
      periodos.set(r.periodoChave, { periodo: r.periodo, consumo: r.consumo, consumoFaturado: r.consumoFaturado });
    }
  }

  const cadastroConsolidado = new Map<string, CadastroConsolidado>();
  for (const [matricula, est] of estaticos) {
    const periodos = [...(consumoPorMatricula.get(matricula)?.entries() ?? [])].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
    );
    const consumos = periodos.map(([, p]) => p.consumo).filter((c): c is number => c !== null);
    const consumoMedio = consumos.length ? consumos.reduce((a, b) => a + b, 0) / consumos.length : null;
    const ultimoPeriodo = periodos.at(-1);
    const mesesConsumoZero = periodos.filter(([, p]) => p.consumo === 0).length;
    const consumoPorEconomia =
      consumoMedio !== null && est.qtdEconomias ? consumoMedio / est.qtdEconomias : null;

    cadastroConsolidado.set(matricula, {
      matricula,
      endereco: est.endereco,
      cidade: est.cidade,
      bairro: est.bairro,
      categoria: est.categoria,
      qtdEconomias: est.qtdEconomias,
      situacaoDocumental: est.situacaoDocumental,
      consumoMedio,
      consumoUltimoMes: ultimoPeriodo ? ultimoPeriodo[1].consumo : null,
      mesesConsumoZero,
      consumoPorEconomia,
      periodoReferencia: ultimoPeriodo ? ultimoPeriodo[1].periodo : "",
      historicoConsumo: periodos.map(([periodoChave, p]) => ({
        periodo: p.periodo,
        periodoChave,
        consumo: p.consumo,
        consumoFaturado: p.consumoFaturado,
      })),
    });
  }

  return { ultimaVisitaPorMatricula, historicoPorMatricula, cadastroConsolidado, totalVisitas: visitasUnicas.size };
}

export function gerarAlvos(estado: EstadoDerivado, regras: RegraResfriamento[]): AlvoRow[] {
  const mapaRegras = new Map(regras.map((r) => [r.status, r.dias]));
  const hoje = new Date();
  const resultado: AlvoRow[] = [];

  for (const cad of estado.cadastroConsolidado.values()) {
    const ultima = estado.ultimaVisitaPorMatricula.get(cad.matricula);
    let motivoInclusao: string;
    let statusUltimaVisita = "";
    let dataUltimaVisita = "";
    let diasDesdeUltimaVisita: number | null = null;
    let tipoAtividadeUltimaVisita = "";
    let parecerCampoUltimaVisita = "";

    if (!ultima) {
      motivoInclusao = "Nunca visitado";
    } else {
      statusUltimaVisita = ultima.status;
      dataUltimaVisita = ultima.dataVisita;
      tipoAtividadeUltimaVisita = ultima.tipoAtividade;
      parecerCampoUltimaVisita = ultima.parecerCampo;
      const dataDt = parseData(ultima.dataVisita);
      diasDesdeUltimaVisita = dataDt ? Math.floor((hoje.getTime() - dataDt.getTime()) / 86_400_000) : null;
      const diasRegra = mapaRegras.get(ultima.status);

      if (diasRegra === undefined) {
        motivoInclusao = `Status '${ultima.status}' sem regra de resfriamento configurada`;
      } else if (diasDesdeUltimaVisita === null) {
        motivoInclusao = `Data da última visita inválida ('${ultima.dataVisita}')`;
      } else if (diasDesdeUltimaVisita >= diasRegra) {
        motivoInclusao = `'${ultima.status}' há ${diasDesdeUltimaVisita} dias (janela: ${diasRegra})`;
      } else {
        continue; // ainda em resfriamento
      }
    }

    resultado.push({
      ...cad,
      statusUltimaVisita,
      dataUltimaVisita,
      diasDesdeUltimaVisita,
      motivoInclusao,
      tipoAtividadeUltimaVisita,
      parecerCampoUltimaVisita,
    });
  }
  return resultado;
}
