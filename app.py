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
        st.success("Regras salvas.")
        st.rerun()

aba_visitas, aba_cadastral, aba_gerar, aba_consulta = st.tabs(
    [
        "Importar visitas (field)",
        "Atualizar base cadastral",
        "Gerar base de alvos",
        "Consultar histórico",
    ]
)

CAMPOS_VISITA_OBRIGATORIOS = ["matricula", "data_visita", "status"]
CAMPOS_VISITA_OPCIONAIS = ["os", "colaborador", "endereco", "observacao"]

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

        st.write("Mapeie as colunas do arquivo para os campos abaixo:")
        colunas_disponiveis = ["(nenhuma)"] + list(df_bruto.columns)
        mapeamento = {}
        campos = CAMPOS_VISITA_OBRIGATORIOS + CAMPOS_VISITA_OPCIONAIS
        colunas_ui = st.columns(3)
        for i, campo in enumerate(campos):
            with colunas_ui[i % 3]:
                obrigatorio = campo in CAMPOS_VISITA_OBRIGATORIOS
                rotulo = f"{campo}{' *' if obrigatorio else ''}"
                mapeamento[campo] = st.selectbox(rotulo, colunas_disponiveis, key=f"map_visita_{campo}")

        faltando = [c for c in CAMPOS_VISITA_OBRIGATORIOS if mapeamento.get(c) in (None, "(nenhuma)")]
        if faltando:
            st.warning(f"Campos obrigatórios sem coluna mapeada: {', '.join(faltando)}")
        elif st.button("Importar para o histórico", type="primary"):
            df_padrao = pd.DataFrame()
            for campo, coluna in mapeamento.items():
                df_padrao[campo] = df_bruto[coluna] if coluna != "(nenhuma)" else ""
            novas, duplicadas = db.importar_visitas(df_padrao, arquivo.name)
            st.success(f"{novas} visita(s) nova(s) importada(s). {duplicadas} já existiam e foram ignoradas.")
            st.rerun()

CAMPOS_CADASTRAL_OBRIGATORIOS = ["matricula"]
CAMPOS_CADASTRAL_CONHECIDOS = ["matricula", "endereco", "consumo", "qtd_economias", "situacao_documental"]

with aba_cadastral:
    st.write(
        "Envie a base cadastral atual. Os dados de cada matrícula são "
        "atualizados (a versão mais recente enviada substitui a anterior)."
    )
    arquivo_cad = st.file_uploader(
        "Base cadastral (Excel ou CSV)", type=["xlsx", "xls", "csv"], key="upload_cadastral"
    )
    if arquivo_cad is not None:
        df_cad_bruto = io_utils.ler_arquivo(arquivo_cad)
        st.dataframe(df_cad_bruto.head(20), use_container_width=True)

        st.write("Mapeie as colunas do arquivo para os campos abaixo:")
        colunas_disponiveis_cad = ["(nenhuma)"] + list(df_cad_bruto.columns)
        mapeamento_cad = {}
        colunas_ui = st.columns(3)
        for i, campo in enumerate(CAMPOS_CADASTRAL_CONHECIDOS):
            with colunas_ui[i % 3]:
                obrigatorio = campo in CAMPOS_CADASTRAL_OBRIGATORIOS
                rotulo = f"{campo}{' *' if obrigatorio else ''}"
                mapeamento_cad[campo] = st.selectbox(rotulo, colunas_disponiveis_cad, key=f"map_cad_{campo}")

        colunas_mapeadas = {v for v in mapeamento_cad.values() if v != "(nenhuma)"}
        colunas_extras_disponiveis = [c for c in df_cad_bruto.columns if c not in colunas_mapeadas]
        colunas_extras_escolhidas = st.multiselect(
            "Outras colunas para manter junto de cada matrícula (ex: potencial "
            "de incremento, tipo de serviço, outras oportunidades)",
            colunas_extras_disponiveis,
        )

        faltando_cad = [c for c in CAMPOS_CADASTRAL_OBRIGATORIOS if mapeamento_cad.get(c) in (None, "(nenhuma)")]
        if faltando_cad:
            st.warning(f"Campos obrigatórios sem coluna mapeada: {', '.join(faltando_cad)}")
        elif st.button("Atualizar base cadastral", type="primary"):
            df_cad_padrao = pd.DataFrame()
            for campo, coluna in mapeamento_cad.items():
                df_cad_padrao[campo] = df_cad_bruto[coluna] if coluna != "(nenhuma)" else ""
            for coluna in colunas_extras_escolhidas:
                df_cad_padrao[coluna] = df_cad_bruto[coluna]
            total = db.atualizar_cadastral(df_cad_padrao, colunas_extras_escolhidas)
            st.success(f"Base cadastral atualizada. {total} matrícula(s) no total.")
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
