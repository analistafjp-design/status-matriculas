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
            consumo_medio REAL,
            consumo_ultimo_mes REAL,
            meses_consumo_zero INTEGER,
            periodo_referencia TEXT,
            qtd_economias INTEGER,
            situacao_documental TEXT,
            dados_extra TEXT,
            atualizado_em TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS regras_resfriamento (
            status TEXT PRIMARY KEY,
            dias INTEGER NOT NULL
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


def _to_float(valor):
    try:
        return float(str(valor).replace(",", "."))
    except (TypeError, ValueError):
        return None


def _to_int(valor):
    try:
        return int(float(str(valor).replace(",", ".")))
    except (TypeError, ValueError):
        return None


def importar_visitas(df, arquivo_origem):
    """Insere visitas no histórico. Duplicatas exatas (mesma matrícula + data
    + OS + status) já registradas são ignoradas silenciosamente."""
    conn = conectar()
    cur = conn.cursor()
    agora = datetime.now().isoformat(timespec="seconds")
    novas = 0
    duplicadas = 0
    for _, row in df.iterrows():
        matricula = str(row.get("matricula", "")).strip()
        data_visita = str(row.get("data_visita", "")).strip()
        status = str(row.get("status", "")).strip()
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
                str(row.get("motivo", "") or "").strip(),
                str(row.get("os", "") or "").strip(),
                str(row.get("colaborador", "") or "").strip(),
                str(row.get("endereco", "") or "").strip(),
                str(row.get("observacao", "") or "").strip(),
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

    Se `coluna_periodo` for informado (ex: base com uma linha por matrícula
    por mês), o df é agrupado por matrícula antes de gravar: os campos
    estáticos (endereço, economias, situação) vêm da linha do período mais
    recente, e o consumo é resumido em consumo médio, consumo do último mês
    e quantidade de meses com consumo zero — sinais úteis para priorizar
    quem parece ter parado de consumir.

    `colunas_extra` são colunas adicionais do df guardadas como JSON junto
    de cada matrícula (usa sempre o valor do período mais recente).
    """
    conn = conectar()
    cur = conn.cursor()
    agora = datetime.now().isoformat(timespec="seconds")

    df = df.copy()
    df["matricula"] = df["matricula"].astype(str).str.strip()
    df = df[df["matricula"] != ""]
    if "consumo" in df.columns:
        df["_consumo_num"] = df["consumo"].apply(_to_float)
    else:
        df["_consumo_num"] = pd.Series([None] * len(df), index=df.index)

    if coluna_periodo and coluna_periodo in df.columns:
        df["_periodo_chave"] = df[coluna_periodo].apply(_to_periodo_ordenavel)
        grupos = df.sort_values("_periodo_chave").groupby("matricula", sort=False)
    else:
        df["_periodo_chave"] = None
        grupos = df.groupby("matricula", sort=False)

    for matricula, grupo in grupos:
        ultima_linha = grupo.iloc[-1]
        consumos = grupo["_consumo_num"].dropna()
        consumo_medio = float(consumos.mean()) if len(consumos) else None
        consumo_ultimo_mes = ultima_linha["_consumo_num"]
        consumo_ultimo_mes = None if pd.isna(consumo_ultimo_mes) else float(consumo_ultimo_mes)
        meses_consumo_zero = int((grupo["_consumo_num"] == 0).sum())
        periodo_referencia = str(ultima_linha.get(coluna_periodo, "") or "") if coluna_periodo else None

        extra = {c: ultima_linha.get(c) for c in colunas_extra if c in df.columns}
        extra_json = json.dumps(extra, default=str, ensure_ascii=False)

        cur.execute(
            """INSERT INTO cadastral
               (matricula, endereco, consumo_medio, consumo_ultimo_mes, meses_consumo_zero,
                periodo_referencia, qtd_economias, situacao_documental, dados_extra, atualizado_em)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(matricula) DO UPDATE SET
                 endereco=excluded.endereco,
                 consumo_medio=excluded.consumo_medio,
                 consumo_ultimo_mes=excluded.consumo_ultimo_mes,
                 meses_consumo_zero=excluded.meses_consumo_zero,
                 periodo_referencia=excluded.periodo_referencia,
                 qtd_economias=excluded.qtd_economias,
                 situacao_documental=excluded.situacao_documental,
                 dados_extra=excluded.dados_extra,
                 atualizado_em=excluded.atualizado_em""",
            (
                matricula,
                str(ultima_linha.get("endereco", "") or ""),
                consumo_medio,
                consumo_ultimo_mes,
                meses_consumo_zero,
                periodo_referencia,
                _to_int(ultima_linha.get("qtd_economias")),
                str(ultima_linha.get("situacao_documental", "") or ""),
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
    texto = str(valor or "").strip()
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
    conn = conectar()
    rows = conn.execute("SELECT * FROM cadastral").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def contagens():
    conn = conectar()
    n_visitas = conn.execute("SELECT COUNT(*) AS n FROM visitas").fetchone()["n"]
    n_cadastral = conn.execute("SELECT COUNT(*) AS n FROM cadastral").fetchone()["n"]
    conn.close()
    return n_visitas, n_cadastral
