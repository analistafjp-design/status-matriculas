import hashlib

import pandas as pd


def calcular_hash(arquivo):
    """Calcula um hash do conteúdo do arquivo, usado para detectar se ele já
    foi importado antes (mesmo nome + mesmo conteúdo) e pode ser pulado."""
    arquivo.seek(0)
    conteudo = arquivo.read()
    arquivo.seek(0)
    return hashlib.sha256(conteudo).hexdigest()


def ler_arquivo(arquivo, nrows=None):
    """Lê um arquivo enviado via Streamlit (CSV ou Excel) e retorna um
    DataFrame com todas as colunas como texto e nomes de coluna sem espaços
    nas bordas. Com `nrows`, lê só as primeiras linhas (rápido, usado para
    identificar o tipo do arquivo sem carregar tudo)."""
    arquivo.seek(0)
    nome = arquivo.name.lower()
    if nome.endswith(".csv"):
        try:
            df = pd.read_csv(arquivo, sep=None, engine="python", dtype=str, nrows=nrows)
        except Exception:
            arquivo.seek(0)
            df = pd.read_csv(arquivo, sep=";", dtype=str, encoding="latin1", nrows=nrows)
    else:
        df = pd.read_excel(arquivo, dtype=str, engine="openpyxl", nrows=nrows)
    arquivo.seek(0)
    df.columns = [str(c).strip() for c in df.columns]
    return df


def ler_colunas(arquivo):
    """Lê só o cabeçalho de um arquivo (algumas linhas, rápido mesmo em
    arquivos grandes) — usado para identificar automaticamente se é um
    arquivo do field ou da base cadastral antes de processar tudo."""
    return ler_arquivo(arquivo, nrows=5)
