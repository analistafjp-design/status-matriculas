import type { CachedFileData, LocalDirectoryHandle, RegraResfriamento } from "./types";
import { PARSER_VERSION } from "./parse";

const DB_NAME = "status-matriculas";
const DB_VERSION = 1;
const FOLDER_STORE = "folder-handle";
const FILE_CACHE_STORE = "parsed-files";
const META_STORE = "meta";
const REGRAS_STORE = "regras";

// Um lote grande pode trazer meses de arquivos de uma vez. Gravar tudo numa
// única transação faria o navegador segurar uma cópia de cada arquivo até
// o lote inteiro terminar; gravar aos poucos mantém o pico de memória
// baixo e preserva o que já foi salvo se algo falhar no meio do caminho.
const CACHE_WRITE_BATCH_SIZE = 5;

export const REGRAS_PADRAO: RegraResfriamento[] = [
  { status: "Finalizada", dias: 365 },
  { status: "Encerrada com Ocorrência - CLIENTE AUSENTE", dias: 15 },
  { status: "Encerrada com Ocorrência - RETORNAR DEPOIS", dias: 7 },
  { status: "Encerrada com Ocorrência - SUSPENSO", dias: 180 },
  { status: "Encerrada com Ocorrência - NADA A FAZER NO LOCAL", dias: 90 },
  { status: "Encerrada com Ocorrência - ENDEREÇO NÃO LOCALIZADO", dias: 90 },
  { status: "Cancelada - SUSPENSO", dias: 180 },
  { status: "Paralisada", dias: 10 },
  { status: "Pendente", dias: 3 },
];

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FOLDER_STORE)) db.createObjectStore(FOLDER_STORE);
      if (!db.objectStoreNames.contains(FILE_CACHE_STORE)) db.createObjectStore(FILE_CACHE_STORE);
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      if (!db.objectStoreNames.contains(REGRAS_STORE)) db.createObjectStore(REGRAS_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDirectoryHandle(handle: LocalDirectoryHandle) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FOLDER_STORE, "readwrite");
    tx.objectStore(FOLDER_STORE).put(handle, "root");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getSavedDirectoryHandle(): Promise<LocalDirectoryHandle | null> {
  const db = await openDb();
  const handle = await new Promise<LocalDirectoryHandle | null>((resolve, reject) => {
    const request = db.transaction(FOLDER_STORE, "readonly").objectStore(FOLDER_STORE).get("root");
    request.onsuccess = () => resolve((request.result as LocalDirectoryHandle | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return handle;
}

export type CacheMeta = { loadedAt: Date; rootName: string };

export async function getCachedFiles(): Promise<{ files: CachedFileData[]; meta: CacheMeta | null }> {
  const db = await openDb();
  const result = await new Promise<{ files: CachedFileData[]; meta: CacheMeta | null }>((resolve, reject) => {
    const tx = db.transaction([FILE_CACHE_STORE, META_STORE], "readonly");
    const files: CachedFileData[] = [];
    const cursorRequest = tx.objectStore(FILE_CACHE_STORE).openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const cached = cursor.value as CachedFileData;
      if (cached.parserVersion === PARSER_VERSION) files.push(cached);
      cursor.continue();
    };
    const metaRequest = tx.objectStore(META_STORE).get("latest");
    tx.oncomplete = () => resolve({ files, meta: (metaRequest.result as CacheMeta | undefined) ?? null });
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return result;
}

async function flushBatch(write: CachedFileData[], remove: string[], meta: CacheMeta, clear = false) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([FILE_CACHE_STORE, META_STORE], "readwrite");
    const store = tx.objectStore(FILE_CACHE_STORE);
    if (clear) store.clear();
    remove.forEach((path) => store.delete(path));
    write.forEach((cached) => store.put(cached, cached.path));
    tx.objectStore(META_STORE).put(meta, "latest");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export type ProgressoImportacao = {
  atual: number;
  total: number;
  nomeArquivo: string;
};

// Recebe TODOS os arquivos encontrados na pasta (já lidos como File) e
// decide, por caminho + tamanho + data de modificação, quais realmente
// precisam ser reprocessados — o resto é reaproveitado do cache local.
export async function sincronizarArquivos(
  selecionados: { file: File; path: string }[],
  parseFn: (input: { file: File; path: string }) => Promise<CachedFileData>,
  opcoes: { rootName: string; resetCache?: boolean; onProgress?: (p: ProgressoImportacao) => void }
): Promise<{ files: CachedFileData[]; novos: number; reaproveitados: number; removidos: number }> {
  const existing = opcoes.resetCache ? { files: [], meta: null } : await getCachedFiles();
  const existingByPath = new Map(existing.files.map((c) => [c.path, c]));

  const nextFiles: CachedFileData[] = [];
  let pendingWrite: CachedFileData[] = [];
  let novos = 0;
  let reaproveitados = 0;

  if (opcoes.resetCache) await flushBatch([], [], { loadedAt: new Date(), rootName: opcoes.rootName }, true);

  for (const [index, input] of selecionados.entries()) {
    const cached = existingByPath.get(input.path);
    const inalterado =
      cached &&
      cached.parserVersion === PARSER_VERSION &&
      cached.size === input.file.size &&
      cached.lastModified === input.file.lastModified;
    if (inalterado) {
      nextFiles.push(cached);
      reaproveitados += 1;
      continue;
    }
    opcoes.onProgress?.({ atual: index + 1, total: selecionados.length, nomeArquivo: input.file.name });
    const parsed = await parseFn(input);
    nextFiles.push(parsed);
    pendingWrite.push(parsed);
    novos += 1;
    if (pendingWrite.length >= CACHE_WRITE_BATCH_SIZE) {
      await flushBatch(pendingWrite, [], { loadedAt: new Date(), rootName: opcoes.rootName });
      pendingWrite = [];
    }
  }

  const activePaths = new Set(nextFiles.map((c) => c.path));
  const removidos = existing.files.filter((c) => !activePaths.has(c.path)).map((c) => c.path);
  await flushBatch(pendingWrite, removidos, { loadedAt: new Date(), rootName: opcoes.rootName });

  return { files: nextFiles, novos, reaproveitados, removidos: removidos.length };
}

export async function obterRegras(): Promise<RegraResfriamento[]> {
  const db = await openDb();
  const regras = await new Promise<RegraResfriamento[] | null>((resolve, reject) => {
    const request = db.transaction(REGRAS_STORE, "readonly").objectStore(REGRAS_STORE).get("lista");
    request.onsuccess = () => resolve((request.result as RegraResfriamento[] | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (regras && regras.length) return regras;
  await salvarRegras(REGRAS_PADRAO);
  return REGRAS_PADRAO;
}

export async function salvarRegras(regras: RegraResfriamento[]) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(REGRAS_STORE, "readwrite");
    tx.objectStore(REGRAS_STORE).put(regras, "lista");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
