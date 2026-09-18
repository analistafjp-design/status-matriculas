import hashlib

import pandas as pd


def calcular_hash(arquivo):
    """Calcula um hash do conteúdo do arquivo, usado para detectar se ele já
    foi importado antes (mesmo nome + mesmo conteúdo) e pode ser pulado."""
    arquivo.seek(0)
    conteudo = arquivo.read()
    arquivo.seek(0)
    return hashlib.sha256(conteudo).hexdigest()


def ler_arquivo(arquivo):
    """Lê um arquivo enviado via Streamlit (CSV ou Excel) e retorna um
    DataFrame com todas as colunas como texto e nomes de coluna sem espaços
    nas bordas."""
    nome = arquivo.name.lower()
    if nome.endswith(".csv"):
        try:
            df = pd.read_csv(arquivo, sep=None, engine="python", dtype=str)
        except Exception:
            arquivo.seek(0)
            df = pd.read_csv(arquivo, sep=";", dtype=str, encoding="latin1")
    else:
        df = pd.read_excel(arquivo, dtype=str, engine="openpyxl")
    df.columns = [str(c).strip() for c in df.columns]
    return df
