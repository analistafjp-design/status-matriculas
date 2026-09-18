import json
import sqlite3
from datetime import datetime

import pandas as pd

from config import DB_PATH, REGRAS_RESFRIAMENTO_PADRAO


def conectar():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def inicializar_banco():
    conn = conectar()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS visitas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            matricula TEXT NOT NULL,
            data_visita TEXT NOT NULL,
            status TEXT NOT NULL,
            motivo TEXT,
            os TEXT,
            colaborador TEXT,
            endereco TEXT,
            observacao TEXT,
            arquivo_origem TEXT,
            importado_em TEXT NOT NULL,
            UNIQUE(matricula, data_visita, os, status)
        );
        CREATE INDEX IF NOT EXISTS idx_visitas_matricula ON visitas(matricula);

        CREATE TABLE IF NOT EXISTS cadastral (
            matricula TEXT PRIMARY KEY,
            endereco TEXT,
            qtd_economias INTEGER,
            situacao_documental TEXT,
            dados_extra TEXT,
            atualizado_em TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS consumo_mensal (
            matricula TEXT NOT NULL,
            periodo TEXT,
            periodo_chave TEXT NOT NULL,
            consumo REAL,
            PRIMARY KEY (matricula, periodo_chave)
        );
        CREATE INDEX IF NOT EXISTS idx_consumo_matricula ON consumo_mensal(matricula);

        CREATE TABLE IF NOT EXISTS regras_resfriamento (
            status TEXT PRIMARY KEY,
            dias INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS arquivos_importados (
            tipo TEXT NOT NULL,
            nome TEXT NOT NULL,
            hash TEXT NOT NULL,
            tamanho INTEGER,
            processado_em TEXT NOT NULL,
            PRIMARY KEY (tipo, nome)
        );
        """
    )
    ja_tem_regras = conn.execute("SELECT COUNT(*) AS n FROM regras_resfriamento").fetchone()["n"]
    if not ja_tem_regras:
        conn.executemany(
            "INSERT INTO regras_resfriamento (status, dias) VALUES (?, ?)",
            list(REGRAS_RESFRIAMENTO_PADRAO.items()),
        )
    conn.commit()
    conn.close()


def _texto(valor):
    """Normaliza um valor de célula para string, tratando NaN/None como
    vazio (evita que apareçam literais 'nan'/'None' nos dados)."""
    if valor is None or (isinstance(valor, float) and pd.isna(valor)):
        return ""
    return str(valor).strip()


def _to_float(valor):
    texto = _texto(valor)
    if not texto:
        return None
    try:
        return float(texto.replace(",", "."))
    except (TypeError, ValueError):
        return None


def _to_int(valor):
    numero = _to_float(valor)
    return int(numero) if numero is not None else None


def importar_visitas(df, arquivo_origem):
    """Insere visitas no histórico. Duplicatas exatas (mesma matrícula + data
    + OS + status) já registradas são ignoradas silenciosamente."""
    conn = conectar()
    cur = conn.cursor()
    agora = datetime.now().isoformat(timespec="seconds")
    novas = 0
    duplicadas = 0
    for _, row in df.iterrows():
        matricula = _texto(row.get("matricula"))
        data_visita = _texto(row.get("data_visita"))
        status = _texto(row.get("status"))
        if not matricula or not data_visita or not status:
            continue
        cur.execute(
            """INSERT OR IGNORE INTO visitas
               (matricula, data_visita, status, motivo, os, colaborador, endereco, observacao, arquivo_origem, importado_em)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                matricula,
                data_visita,
                status,
                _texto(row.get("motivo")),
                _texto(row.get("os")),
                _texto(row.get("colaborador")),
                _texto(row.get("endereco")),
                _texto(row.get("observacao")),
                arquivo_origem,
                agora,
            ),
        )
        if cur.rowcount == 1:
            novas += 1
        else:
            duplicadas += 1
    conn.commit()
    conn.close()
    return novas, duplicadas


def atualizar_cadastral(df, colunas_extra, coluna_periodo=None):
    """Atualiza (upsert) os dados cadastrais por matrícula.

    O consumo é gravado em `consumo_mensal`, uma linha por matrícula+período
    (upsert por período): isso permite importar a base em vários arquivos
    separados ao longo do tempo (ex: um arquivo por mês, ou reimportações)
    sem perder os períodos já registrados antes — cada novo arquivo apenas
    acrescenta ou atualiza os períodos que ele traz.

    Os campos estáticos (endereço, economias, situação) são atualizados com
    o valor da linha do período mais recente **dentro deste arquivo**.

    `colunas_extra` são colunas adicionais do df guardadas como JSON junto
    de cada matrícula (valor do período mais recente deste arquivo).
    """
    conn = conectar()
    cur = conn.cursor()
    agora = datetime.now().isoformat(timespec="seconds")

    df = df.copy()
    df["matricula"] = df["matricula"].fillna("").astype(str).str.strip()
    df = df[df["matricula"] != ""]
    if "consumo" in df.columns:
        df["_consumo_num"] = df["consumo"].apply(_to_float)
    else:
        df["_consumo_num"] = pd.Series([None] * len(df), index=df.index)

    if coluna_periodo and coluna_periodo in df.columns:
        df["_periodo_raw"] = df[coluna_periodo].apply(_texto)
        df["_periodo_chave"] = df[coluna_periodo].apply(_to_periodo_ordenavel)
    else:
        df["_periodo_raw"] = "único"
        df["_periodo_chave"] = "0"

    for _, row in df.iterrows():
        cur.execute(
            """INSERT INTO consumo_mensal (matricula, periodo, periodo_chave, consumo)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(matricula, periodo_chave) DO UPDATE SET
                 periodo=excluded.periodo,
                 consumo=excluded.consumo""",
            (row["matricula"], row["_periodo_raw"], row["_periodo_chave"], row["_consumo_num"]),
        )

    grupos = df.sort_values("_periodo_chave").groupby("matricula", sort=False)
    for matricula, grupo in grupos:
        ultima_linha = grupo.iloc[-1]
        extra = {c: ultima_linha.get(c) for c in colunas_extra if c in df.columns}
        extra_json = json.dumps(extra, default=str, ensure_ascii=False)

        cur.execute(
            """INSERT INTO cadastral
               (matricula, endereco, qtd_economias, situacao_documental, dados_extra, atualizado_em)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(matricula) DO UPDATE SET
                 endereco=excluded.endereco,
                 qtd_economias=excluded.qtd_economias,
                 situacao_documental=excluded.situacao_documental,
                 dados_extra=excluded.dados_extra,
                 atualizado_em=excluded.atualizado_em""",
            (
                matricula,
                _texto(ultima_linha.get("endereco")),
                _to_int(ultima_linha.get("qtd_economias")),
                _texto(ultima_linha.get("situacao_documental")),
                extra_json,
                agora,
            ),
        )
    conn.commit()
    total = conn.execute("SELECT COUNT(*) AS n FROM cadastral").fetchone()["n"]
    conn.close()
    return total


def _to_periodo_ordenavel(valor):
    """Converte um período tipo 'MM/YYYY' ou 'YYYY-MM' em algo ordenável
    (string 'YYYYMM'). Cai no valor original (como texto) se não reconhecer."""
    texto = _texto(valor)
    partes = texto.replace("-", "/").split("/")
    if len(partes) == 2:
        a, b = partes
        if len(a) == 4 and a.isdigit() and b.isdigit():
            return f"{a}{int(b):02d}"
        if len(b) == 4 and b.isdigit() and a.isdigit():
            return f"{b}{int(a):02d}"
    return texto


def obter_regras():
    conn = conectar()
    rows = conn.execute("SELECT status, dias FROM regras_resfriamento ORDER BY status").fetchall()
    conn.close()
    return {r["status"]: r["dias"] for r in rows}


def substituir_regras(regras: dict):
    conn = conectar()
    conn.execute("DELETE FROM regras_resfriamento")
    conn.executemany(
        "INSERT INTO regras_resfriamento (status, dias) VALUES (?, ?)",
        list(regras.items()),
    )
    conn.commit()
    conn.close()


def historico_matricula(matricula):
    conn = conectar()
    rows = conn.execute(
        "SELECT * FROM visitas WHERE matricula = ? ORDER BY data_visita DESC",
        (matricula,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def ultima_visita_por_matricula():
    """Retorna a visita mais recente de cada matrícula (pela data_visita)."""
    conn = conectar()
    rows = conn.execute(
        """
        SELECT v.matricula, v.status, v.data_visita, v.motivo, v.observacao
        FROM visitas v
        INNER JOIN (
            SELECT matricula, MAX(data_visita) AS max_data
            FROM visitas
            GROUP BY matricula
        ) ult ON v.matricula = ult.matricula AND v.data_visita = ult.max_data
        """
    ).fetchall()
    conn.close()
    return {r["matricula"]: dict(r) for r in rows}


def obter_cadastral():
    """Devolve os dados cadastrais com o consumo agregado a partir de todos
    os períodos já importados (mesmo vindos de arquivos diferentes ao longo
    do tempo): consumo médio, consumo do período mais recente e quantos
    períodos tiveram consumo zero."""
    conn = conectar()
    rows = conn.execute(
        """
        WITH ranqueado AS (
            SELECT matricula, periodo, periodo_chave, consumo,
                   ROW_NUMBER() OVER (PARTITION BY matricula ORDER BY periodo_chave DESC) AS posicao
            FROM consumo_mensal
        ),
        agregado AS (
            SELECT matricula,
                   AVG(consumo) AS consumo_medio,
                   SUM(CASE WHEN consumo = 0 THEN 1 ELSE 0 END) AS meses_consumo_zero
            FROM consumo_mensal
            GROUP BY matricula
        ),
        ultimo AS (
            SELECT matricula, periodo AS periodo_referencia, consumo AS consumo_ultimo_mes
            FROM ranqueado
            WHERE posicao = 1
        )
        SELECT c.*,
               agregado.consumo_medio,
               agregado.meses_consumo_zero,
               ultimo.periodo_referencia,
               ultimo.consumo_ultimo_mes
        FROM cadastral c
        LEFT JOIN agregado ON agregado.matricula = c.matricula
        LEFT JOIN ultimo ON ultimo.matricula = c.matricula
        """
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def arquivo_ja_processado(tipo, nome, hash_arquivo):
    """Verifica se um arquivo (pelo nome, dentro de um tipo: 'field' ou
    'cadastral') já foi importado antes com esse mesmo conteúdo (hash).
    Se o nome já existe mas o hash é diferente, o arquivo foi modificado
    e não conta como já processado."""
    conn = conectar()
    row = conn.execute(
        "SELECT hash FROM arquivos_importados WHERE tipo = ? AND nome = ?",
        (tipo, nome),
    ).fetchone()
    conn.close()
    return row is not None and row["hash"] == hash_arquivo


def registrar_arquivo_importado(tipo, nome, hash_arquivo, tamanho):
    conn = conectar()
    conn.execute(
        """INSERT INTO arquivos_importados (tipo, nome, hash, tamanho, processado_em)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(tipo, nome) DO UPDATE SET
             hash=excluded.hash, tamanho=excluded.tamanho, processado_em=excluded.processado_em""",
        (tipo, nome, hash_arquivo, tamanho, datetime.now().isoformat(timespec="seconds")),
    )
    conn.commit()
    conn.close()


def listar_arquivos_importados(tipo):
    conn = conectar()
    rows = conn.execute(
        "SELECT nome, tamanho, processado_em FROM arquivos_importados WHERE tipo = ? ORDER BY processado_em DESC",
        (tipo,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def contagens():
    conn = conectar()
    n_visitas = conn.execute("SELECT COUNT(*) AS n FROM visitas").fetchone()["n"]
    n_cadastral = conn.execute("SELECT COUNT(*) AS n FROM cadastral").fetchone()["n"]
    conn.close()
    return n_visitas, n_cadastral
