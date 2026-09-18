export type TipoArquivo = "field" | "cadastral" | "desconhecido";

export type VisitaRow = {
  matricula: string;
  dataVisita: string;
  status: string;
  motivo: string;
  os: string;
  colaborador: string;
  endereco: string;
  cidade: string;
  bairro: string;
  tipoAtividade: string;
  parecerCampo: string;
  observacao: string;
};

export type CadastralRow = {
  matricula: string;
  endereco: string;
  cidade: string;
  bairro: string;
  categoria: string;
  qtdEconomias: number | null;
  situacaoDocumental: string;
  periodo: string;
  periodoChave: string;
  consumo: number | null;
};

export type ConsumoPeriodo = {
  periodo: string;
  periodoChave: string;
  consumo: number | null;
};

export type CachedFileData = {
  path: string;
  name: string;
  size: number;
  lastModified: number;
  parserVersion: number;
  tipo: TipoArquivo;
  visitas: VisitaRow[];
  cadastral: CadastralRow[];
  totalLinhas: number;
  colunasAusentes?: string[];
};

export type RegraResfriamento = {
  status: string;
  dias: number;
};

export type CadastroConsolidado = {
  matricula: string;
  endereco: string;
  cidade: string;
  bairro: string;
  categoria: string;
  qtdEconomias: number | null;
  situacaoDocumental: string;
  consumoMedio: number | null;
  consumoUltimoMes: number | null;
  mesesConsumoZero: number;
  consumoPorEconomia: number | null;
  periodoReferencia: string;
  historicoConsumo: ConsumoPeriodo[];
};

export type AlvoRow = CadastroConsolidado & {
  statusUltimaVisita: string;
  dataUltimaVisita: string;
  diasDesdeUltimaVisita: number | null;
  motivoInclusao: string;
  tipoAtividadeUltimaVisita: string;
  parecerCampoUltimaVisita: string;
};

export type InterpretacaoIA = {
  resumo: string;
  oportunidade: boolean;
  categoria: string;
  recomendacaoVisita: boolean;
};

export type SelectedFile = {
  file: File;
  path: string;
};

export type LocalFileHandle = {
  kind: "file";
  name: string;
  getFile: () => Promise<File>;
};

export type LocalDirectoryHandle = {
  kind: "directory";
  name: string;
  values: () => AsyncIterableIterator<LocalFileHandle | LocalDirectoryHandle>;
  queryPermission?: (options: { mode: "read" }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: "read" }) => Promise<PermissionState>;
};

export type XlsxSheet = Record<string, unknown>;
export type XlsxWorkbook = { SheetNames: string[]; Sheets: Record<string, XlsxSheet> };

export type XlsxLib = {
  read: (data: ArrayBuffer, opts: Record<string, unknown>) => XlsxWorkbook;
  utils: {
    sheet_to_json: <T>(sheet: XlsxSheet, opts?: Record<string, unknown>) => T[];
    json_to_sheet: (rows: Record<string, unknown>[]) => XlsxSheet;
    book_new: () => unknown;
    book_append_sheet: (workbook: unknown, worksheet: XlsxSheet, name: string) => void;
  };
  writeFile: (workbook: unknown, filename: string) => void;
};

declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<LocalDirectoryHandle>;
    XLSX?: XlsxLib;
  }
}
