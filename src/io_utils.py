import pandas as pd


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
        df = pd.read_excel(arquivo, dtype=str)
    df.columns = [str(c).strip() for c in df.columns]
    return df
