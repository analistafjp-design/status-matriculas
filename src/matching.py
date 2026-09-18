import json
from datetime import datetime

import pandas as pd

from src import db

_FORMATOS_DATA = (
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%d/%m/%y",
    "%Y-%m-%d %H:%M:%S",
    "%d/%m/%Y %H:%M:%S",
)


def _parse_data(valor):
    if not valor:
        return None
    valor = str(valor).strip()
    for fmt in _FORMATOS_DATA:
        try:
            return datetime.strptime(valor, fmt)
        except ValueError:
            continue
    try:
        convertida = pd.to_datetime(valor, dayfirst=True, errors="coerce")
    except Exception:
        return None
    if pd.isna(convertida):
        return None
    return convertida.to_pydatetime()


def gerar_base_alvos(ordenar_por=None, ordem_decrescente=True):
    """Cruza a base cadastral com o histórico de visitas e devolve as
    matrículas que podem virar alvo agora, com o motivo da inclusão.

    Uma matrícula é incluída quando nunca foi visitada, quando a última
    visita já passou da janela de resfriamento configurada para o status
    recebido, ou quando o status recebido não tem regra configurada."""
    regras = db.obter_regras()
    ultimas_visitas = db.ultima_visita_por_matricula()
    cadastral = db.obter_cadastral()

    hoje = datetime.now()
    linhas = []
    for reg in cadastral:
        matricula = reg["matricula"]
        ultima = ultimas_visitas.get(matricula)

        if ultima is None:
            status_ultima = None
            data_ultima = None
            dias_desde = None
            motivo = "Nunca visitado"
        else:
            status_ultima = ultima["status"]
            data_ultima = ultima["data_visita"]
            data_dt = _parse_data(data_ultima)
            dias_desde = (hoje - data_dt).days if data_dt else None
            dias_regra = regras.get(status_ultima)

            if dias_regra is None:
                motivo = f"Status '{status_ultima}' sem regra de resfriamento configurada"
            elif dias_desde is None:
                motivo = f"Data da última visita inválida ('{data_ultima}')"
            elif dias_desde >= dias_regra:
                motivo = f"'{status_ultima}' há {dias_desde} dias (janela: {dias_regra})"
            else:
                continue  # ainda em resfriamento, não vira alvo agora

        extra = {}
        if reg.get("dados_extra"):
            try:
                extra = json.loads(reg["dados_extra"])
            except (TypeError, ValueError):
                extra = {}

        linha = {
            "matricula": matricula,
            "endereco": reg.get("endereco"),
            "consumo_medio": reg.get("consumo_medio"),
            "consumo_ultimo_mes": reg.get("consumo_ultimo_mes"),
            "meses_consumo_zero": reg.get("meses_consumo_zero"),
            "periodo_referencia": reg.get("periodo_referencia"),
            "qtd_economias": reg.get("qtd_economias"),
            "situacao_documental": reg.get("situacao_documental"),
            "status_ultima_visita": status_ultima,
            "data_ultima_visita": data_ultima,
            "dias_desde_ultima_visita": dias_desde,
            "motivo_inclusao": motivo,
        }
        linha.update(extra)
        linhas.append(linha)

    df = pd.DataFrame(linhas)
    if not df.empty and ordenar_por and ordenar_por in df.columns:
        df = df.sort_values(by=ordenar_por, ascending=not ordem_decrescente, na_position="last")
    return df
