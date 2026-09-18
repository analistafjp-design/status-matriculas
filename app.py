import io

import pandas as pd
import streamlit as st

from src import db, io_utils, matching

st.set_page_config(page_title="Gestão de Alvos de Campo", layout="wide")
db.inicializar_banco()

st.title("Gestão de Alvos de Campo")
st.caption(
    "Cruza o histórico de visitas do field com a base cadastral para gerar "
    "novas bases sem repetir endereços já visitados sem sucesso."
)

n_visitas, n_cadastral = db.contagens()

with st.sidebar:
    st.metric("Visitas no histórico", n_visitas)
    st.metric("Matrículas na base cadastral", n_cadastral)

    st.divider()
    st.subheader("Regras de resfriamento")
    st.caption(
        "Por quantos dias uma matrícula fica fora de novas bases depois de "
        "receber cada status na última visita."
    )
    regras_atuais = db.obter_regras()
    df_regras = pd.DataFrame([{"status": k, "dias": v} for k, v in regras_atuais.items()])
    df_regras_editado = st.data_editor(
        df_regras,
        num_rows="dynamic",
        use_container_width=True,
        key="editor_regras",
    )
    if st.button("Salvar regras"):
        novas_regras = {
            str(row["status"]).strip(): int(row["dias"])
            for _, row in df_regras_editado.iterrows()
            if str(row["status"]).strip() and pd.notna(row["dias"])
        }
        db.substituir_regras(novas_regras)
        st.toast("Regras salvas.", icon="✅")
        st.rerun()


def sugerir_coluna(colunas_disponiveis, aliases):
    """Tenta achar automaticamente qual coluna do arquivo corresponde a um
    campo, comparando com uma lista de nomes conhecidos (aliases). Primeiro
    tenta igualdade exata (sem acentuar maiúsc/minúsc.), depois substring."""
    normalizadas = {c: c.strip().lower() for c in colunas_disponiveis}
    for alias in aliases:
        alias_norm = alias.strip().lower()
        for coluna, norm in normalizadas.items():
            if norm == alias_norm:
                return coluna
    for alias in aliases:
        alias_norm = alias.strip().lower()
        for coluna, norm in normalizadas.items():
            if alias_norm in norm:
                return coluna
    return "(nenhuma)"


def caixa_mapeamento(colunas_disponiveis, campo, obrigatorio, aliases, key_prefix):
    rotulo = f"{campo}{' *' if obrigatorio else ''}"
    sugestao = sugerir_coluna(colunas_disponiveis, aliases)
    opcoes = ["(nenhuma)"] + colunas_disponiveis
    indice = opcoes.index(sugestao) if sugestao in opcoes else 0
    return st.selectbox(rotulo, opcoes, index=indice, key=f"{key_prefix}_{campo}")


aba_visitas, aba_cadastral, aba_gerar, aba_consulta = st.tabs(
    [
        "Importar visitas (field)",
        "Atualizar base cadastral",
        "Gerar base de alvos",
        "Consultar histórico",
    ]
)

ALIASES_VISITA = {
    "matricula": ["Matrícula", "matricula", "NUM_LIGACAO", "UC"],
    "data_visita": ["Data", "Data da Visita", "data_visita"],
    "status": ["Status da Atividade", "status"],
    "motivo": ["Motivo de Não Execução - Normal", "Motivo de Não Execução", "motivo"],
    "motivo_alt": ["Motivo de Não Execução - Cobrança"],
    "os": ["ID da Atividade", "Cód. Protocolo Origem", "OS de Origem", "os"],
    "colaborador": ["Recurso", "Técnico", "colaborador"],
    "endereco": ["Endereço", "endereco"],
    "observacao": ["Observação", "Observações", "observacao"],
}
CAMPOS_VISITA_OBRIGATORIOS = ["matricula", "data_visita", "status"]
CAMPOS_VISITA_OPCIONAIS = ["motivo", "motivo_alt", "os", "colaborador", "endereco", "observacao"]

with aba_visitas:
    st.write(
        "Envie o arquivo exportado do field. Cada linha é uma visita/OS. "
        "Visitas já importadas (mesma matrícula + data + OS + status) não "
        "são duplicadas."
    )
    arquivo = st.file_uploader(
        "Arquivo do field (Excel ou CSV)", type=["xlsx", "xls", "csv"], key="upload_field"
    )
    if arquivo is not None:
        df_bruto = io_utils.ler_arquivo(arquivo)
        st.dataframe(df_bruto.head(20), use_container_width=True)

        st.write("Mapeie as colunas do arquivo para os campos abaixo (sugestão automática já aplicada):")
        colunas_disponiveis = list(df_bruto.columns)
        mapeamento = {}
        campos = CAMPOS_VISITA_OBRIGATORIOS + CAMPOS_VISITA_OPCIONAIS
        colunas_ui = st.columns(3)
        for i, campo in enumerate(campos):
            with colunas_ui[i % 3]:
                obrigatorio = campo in CAMPOS_VISITA_OBRIGATORIOS
                mapeamento[campo] = caixa_mapeamento(
                    colunas_disponiveis, campo, obrigatorio, ALIASES_VISITA.get(campo, []), "map_visita"
                )
        st.caption(
            "`motivo` e `motivo_alt`: motivo de não execução, quando existir mais de uma coluna "
            "(ex: 'Cobrança' e 'Normal'). Quando preenchido, é combinado com o status "
            "(ex: 'Cancelada - CLIENTE AUSENTE') para permitir regras de resfriamento mais precisas."
        )

        faltando = [c for c in CAMPOS_VISITA_OBRIGATORIOS if mapeamento.get(c) in (None, "(nenhuma)")]
        if faltando:
            st.warning(f"Campos obrigatórios sem coluna mapeada: {', '.join(faltando)}")
        elif st.button("Importar para o histórico", type="primary"):
            df_padrao = pd.DataFrame()
            for campo in ["matricula", "data_visita", "status", "os", "colaborador", "endereco", "observacao"]:
                coluna = mapeamento.get(campo)
                df_padrao[campo] = df_bruto[coluna] if coluna and coluna != "(nenhuma)" else ""

            coluna_motivo = mapeamento.get("motivo")
            coluna_motivo_alt = mapeamento.get("motivo_alt")
            serie_motivo = df_bruto[coluna_motivo] if coluna_motivo and coluna_motivo != "(nenhuma)" else pd.Series([""] * len(df_bruto))
            serie_motivo_alt = (
                df_bruto[coluna_motivo_alt] if coluna_motivo_alt and coluna_motivo_alt != "(nenhuma)" else pd.Series([""] * len(df_bruto))
            )
            serie_motivo = serie_motivo.fillna("").astype(str).str.strip()
            serie_motivo_alt = serie_motivo_alt.fillna("").astype(str).str.strip()
            motivo_final = serie_motivo.where(serie_motivo != "", serie_motivo_alt)

            df_padrao["motivo"] = motivo_final
            status_base = df_padrao["status"].fillna("").astype(str).str.strip()
            df_padrao["status"] = status_base.where(
                motivo_final == "", status_base + " - " + motivo_final
            )

            novas, duplicadas = db.importar_visitas(df_padrao, arquivo.name)
            st.toast(f"{novas} visita(s) nova(s) importada(s). {duplicadas} já existiam e foram ignoradas.", icon="✅")
            st.rerun()

ALIASES_CADASTRAL = {
    "matricula": ["NUM_LIGACAO", "Matrícula", "matricula", "UC"],
    "endereco": ["END_LIGACAO", "Endereço", "endereco"],
    "periodo": ["Mês/Ano", "Mes/Ano", "periodo", "mes_ano", "Referência"],
    "consumo": ["CON_MEDIDO", "CON_FAT_AGUA", "consumo"],
    "qtd_economias": ["TOTAL_ECO", "Numero De Economias", "Quantidade De Economia", "qtd_economias"],
    "situacao_documental": ["SIT_CONTRATO", "SIT_LIG", "situacao_documental"],
}
CAMPOS_CADASTRAL_OBRIGATORIOS = ["matricula"]
CAMPOS_CADASTRAL_CONHECIDOS = ["matricula", "endereco", "periodo", "consumo", "qtd_economias", "situacao_documental"]

with aba_cadastral:
    st.write(
        "Envie a base cadastral atual. Se a base tiver uma linha por "
        "matrícula por mês (ex: histórico de consumo), mapeie também a "
        "coluna de período — o app calcula consumo médio, consumo do "
        "último mês e quantos meses tiveram consumo zero."
    )
    arquivo_cad = st.file_uploader(
        "Base cadastral (Excel ou CSV)", type=["xlsx", "xls", "csv"], key="upload_cadastral"
    )
    if arquivo_cad is not None:
        df_cad_bruto = io_utils.ler_arquivo(arquivo_cad)
        st.dataframe(df_cad_bruto.head(20), use_container_width=True)
        st.caption(f"{len(df_cad_bruto)} linha(s) no arquivo enviado.")

        st.write("Mapeie as colunas do arquivo para os campos abaixo (sugestão automática já aplicada):")
        colunas_disponiveis_cad = list(df_cad_bruto.columns)
        mapeamento_cad = {}
        colunas_ui = st.columns(3)
        for i, campo in enumerate(CAMPOS_CADASTRAL_CONHECIDOS):
            with colunas_ui[i % 3]:
                obrigatorio = campo in CAMPOS_CADASTRAL_OBRIGATORIOS
                mapeamento_cad[campo] = caixa_mapeamento(
                    colunas_disponiveis_cad, campo, obrigatorio, ALIASES_CADASTRAL.get(campo, []), "map_cad"
                )
        st.caption(
            "`periodo` é opcional: deixe '(nenhuma)' se sua base já tem uma linha por matrícula."
        )

        colunas_mapeadas = {v for v in mapeamento_cad.values() if v != "(nenhuma)"}
        colunas_extras_disponiveis = [c for c in df_cad_bruto.columns if c not in colunas_mapeadas]
        colunas_extras_escolhidas = st.multiselect(
            "Outras colunas para manter junto de cada matrícula (ex: potencial "
            "de incremento, categoria do imóvel, outras oportunidades)",
            colunas_extras_disponiveis,
        )

        faltando_cad = [c for c in CAMPOS_CADASTRAL_OBRIGATORIOS if mapeamento_cad.get(c) in (None, "(nenhuma)")]
        if faltando_cad:
            st.warning(f"Campos obrigatórios sem coluna mapeada: {', '.join(faltando_cad)}")
        elif st.button("Atualizar base cadastral", type="primary"):
            coluna_periodo = mapeamento_cad.get("periodo")
            usa_periodo = coluna_periodo and coluna_periodo != "(nenhuma)"

            df_cad_padrao = pd.DataFrame()
            for campo in ["matricula", "endereco", "consumo", "qtd_economias", "situacao_documental"]:
                coluna = mapeamento_cad.get(campo)
                df_cad_padrao[campo] = df_cad_bruto[coluna] if coluna and coluna != "(nenhuma)" else ""
            if usa_periodo:
                df_cad_padrao["_periodo"] = df_cad_bruto[coluna_periodo]
            for coluna in colunas_extras_escolhidas:
                df_cad_padrao[coluna] = df_cad_bruto[coluna]

            total = db.atualizar_cadastral(
                df_cad_padrao,
                colunas_extras_escolhidas,
                coluna_periodo="_periodo" if usa_periodo else None,
            )
            st.toast(f"Base cadastral atualizada. {total} matrícula(s) no total.", icon="✅")
            st.rerun()

with aba_gerar:
    st.write(
        "Gera a lista de matrículas que podem virar alvo agora: exclui quem "
        "está dentro da janela de resfriamento definida na barra lateral."
    )
    if n_cadastral == 0:
        st.info("Atualize a base cadastral antes de gerar alvos.")
    else:
        df_colunas = matching.gerar_base_alvos()
        colunas_ordenaveis = [c for c in df_colunas.columns if c != "motivo_inclusao"]
        col_a, col_b = st.columns([2, 1])
        with col_a:
            ordenar_por = st.selectbox("Ordenar por", ["(sem ordenação)"] + colunas_ordenaveis)
        with col_b:
            decrescente = st.checkbox("Decrescente", value=True)

        df_resultado = matching.gerar_base_alvos(
            ordenar_por=None if ordenar_por == "(sem ordenação)" else ordenar_por,
            ordem_decrescente=decrescente,
        )
        st.write(
            f"**{len(df_resultado)}** matrícula(s) disponível(is) como alvo agora "
            f"(de {n_cadastral} na base cadastral)."
        )
        st.dataframe(df_resultado, use_container_width=True)

        if not df_resultado.empty:
            buffer = io.BytesIO()
            with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
                df_resultado.to_excel(writer, index=False, sheet_name="alvos")
            st.download_button(
                "Baixar base de alvos (Excel)",
                data=buffer.getvalue(),
                file_name="base_de_alvos.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )

with aba_consulta:
    st.write("Consulte o histórico completo de visitas de uma matrícula.")
    matricula_busca = st.text_input("Matrícula/UC")
    if matricula_busca:
        historico = db.historico_matricula(matricula_busca.strip())
        if not historico:
            st.info("Nenhuma visita encontrada para essa matrícula.")
        else:
            st.dataframe(pd.DataFrame(historico), use_container_width=True)
