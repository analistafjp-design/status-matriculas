import type { LocalDirectoryHandle, SelectedFile } from "./types";

const EXTENSOES_VALIDAS = /\.(xlsx|xls|xlsm|csv)$/i;

// Percorre a pasta inteira recursivamente (inclusive subpastas, ex: "Base
// Cadastral" e "De Janeiro a Agosto" dentro da pasta raiz) e devolve todos
// os arquivos de planilha encontrados, com o caminho relativo à raiz.
export async function collectDirectoryFiles(
  directory: LocalDirectoryHandle,
  parentPath = ""
): Promise<SelectedFile[]> {
  const files: SelectedFile[] = [];
  for await (const entry of directory.values()) {
    if (entry.name.startsWith("~$")) continue; // arquivo temporário do Excel
    const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    if (entry.kind === "file") {
      if (EXTENSOES_VALIDAS.test(entry.name)) {
        files.push({ file: await entry.getFile(), path });
      }
    } else {
      files.push(...(await collectDirectoryFiles(entry, path)));
    }
  }
  return files;
}
