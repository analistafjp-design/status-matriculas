import json
import sqlite3
from datetime import datetime

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
            consumo REAL,
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
               (matricula, data_visita, status, os, colaborador, endereco, observacao, arquivo_origem, importado_em)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                matricula,
                data_visita,
                status,
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


def atualizar_cadastral(df, colunas_extra):
    """Atualiza (upsert) os dados cadastrais por matrícula. `colunas_extra`
    são colunas adicionais do df guardadas como JSON junto de cada matrícula."""
    conn = conectar()
    cur = conn.cursor()
    agora = datetime.now().isoformat(timespec="seconds")
    for _, row in df.iterrows():
        matricula = str(row.get("matricula", "")).strip()
        if not matricula:
            continue
        extra = {c: row.get(c) for c in colunas_extra if c in df.columns}
        extra_json = json.dumps(extra, default=str, ensure_ascii=False)
        cur.execute(
            """INSERT INTO cadastral
               (matricula, endereco, consumo, qtd_economias, situacao_documental, dados_extra, atualizado_em)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(matricula) DO UPDATE SET
                 endereco=excluded.endereco,
                 consumo=excluded.consumo,
                 qtd_economias=excluded.qtd_economias,
                 situacao_documental=excluded.situacao_documental,
                 dados_extra=excluded.dados_extra,
                 atualizado_em=excluded.atualizado_em""",
            (
                matricula,
                str(row.get("endereco", "") or ""),
                _to_float(row.get("consumo")),
                _to_int(row.get("qtd_economias")),
                str(row.get("situacao_documental", "") or ""),
                extra_json,
                agora,
            ),
        )
    conn.commit()
    total = conn.execute("SELECT COUNT(*) AS n FROM cadastral").fetchone()["n"]
    conn.close()
    return total


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
        SELECT v.matricula, v.status, v.data_visita, v.observacao
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
