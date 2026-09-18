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


def separar_novos_e_repetidos(arquivos, tipo):
    """Calcula o hash de cada arquivo e separa os que já foram importados
    antes (mesmo nome + mesmo conteúdo, sem alteração) dos novos/modificados,
    para não reprocessar o que já está no histórico."""
    info = []
    for arq in arquivos:
        h = io_utils.calcular_hash(arq)
        info.append(
            {"arquivo": arq, "hash": h, "ja_processado": db.arquivo_ja_processado(tipo, arq.name, h)}
        )
    pendentes = [i for i in info if not i["ja_processado"]]
    ja_ok = [i for i in info if i["ja_processado"]]
    return pendentes, ja_ok


def colunas_mapeadas_ausentes(df_bruto, mapeamento, campos_conhecidos):
    """Confere se as colunas mapeadas (a partir do primeiro arquivo do lote)
    para os campos conhecidos deste tipo realmente existem neste arquivo
    específico. Checa TODOS os campos conhecidos (não só os obrigatórios) —
    por exemplo, "matricula" sozinho não bastaria para distinguir um
    arquivo do field de um da base cadastral, já que ambos costumam ter uma
    coluna chamada "Matrícula". Usado para detectar um arquivo do tipo
    errado misturado no lote e pular com aviso, em vez de importar tudo em
    branco silenciosamente."""
    return [
        campo
        for campo in campos_conhecidos
        if mapeamento.get(campo) not in (None, "(nenhuma)") and mapeamento[campo] not in df_bruto.columns
    ]


def escolher_arquivos_alvo(arquivos, tipo, chave_forcar):
    """Mostra quais arquivos serão pulados (já importados sem alteração) e
    devolve a lista dos que devem ser processados agora."""
    pendentes, ja_ok = separar_novos_e_repetidos(arquivos, tipo)
    if ja_ok:
        nomes = ", ".join(i["arquivo"].name for i in ja_ok)
        st.caption(f"⏭️ {len(ja_ok)} arquivo(s) sem alteração desde a última importação (pulados): {nomes}")
    if pendentes:
        return pendentes
    st.info("Nenhum arquivo novo ou modificado nesta seleção.")
    if st.checkbox("Reprocessar mesmo assim (todos os arquivos selecionados)", key=chave_forcar):
        return [{"arquivo": a, "hash": io_utils.calcular_hash(a)} for a in arquivos]
    return []


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
CAMPOS_VISITA_TODOS = CAMPOS_VISITA_OBRIGATORIOS + CAMPOS_VISITA_OPCIONAIS


def montar_df_visita(df_bruto, mapeamento):
    df_padrao = pd.DataFrame(index=df_bruto.index)
    for campo in ["matricula", "data_visita", "status", "os", "colaborador", "endereco", "observacao"]:
        coluna = mapeamento.get(campo)
        if coluna and coluna != "(nenhuma)" and coluna in df_bruto.columns:
            df_padrao[campo] = df_bruto[coluna]
        else:
            df_padrao[campo] = ""

    def serie_ou_vazia(nome_campo):
        coluna = mapeamento.get(nome_campo)
        if coluna and coluna != "(nenhuma)" and coluna in df_bruto.columns:
            return df_bruto[coluna].fillna("").astype(str).str.strip()
        return pd.Series([""] * len(df_bruto), index=df_bruto.index)

    serie_motivo = serie_ou_vazia("motivo")
    serie_motivo_alt = serie_ou_vazia("motivo_alt")
    motivo_final = serie_motivo.where(serie_motivo != "", serie_motivo_alt)

    df_padrao["motivo"] = motivo_final
    status_base = df_padrao["status"].fillna("").astype(str).str.strip()
    df_padrao["status"] = status_base.where(motivo_final == "", status_base + " - " + motivo_final)
    return df_padrao


ALIASES_CADASTRAL = {
    "matricula": ["NUM_LIGACAO", "Matrícula", "matricula", "UC"],
    "endereco": ["END_LIGACAO", "Endereço", "endereco"],
    "periodo": ["Mês/Ano", "Mes/Ano", "periodo", "mes_ano"],
    "consumo": ["CON_MEDIDO", "CON_FAT_AGUA", "consumo"],
    "qtd_economias": ["TOTAL_ECO", "Numero De Economias", "Quantidade De Economia", "qtd_economias"],
    "situacao_documental": ["SIT_CONTRATO", "SIT_LIG", "situacao_documental"],
}
CAMPOS_CADASTRAL_OBRIGATORIOS = ["matricula"]
CAMPOS_CADASTRAL_CONHECIDOS = ["matricula", "endereco", "periodo", "consumo", "qtd_economias", "situacao_documental"]

# Colunas que só aparecem em um dos dois tipos de arquivo (evita usar
# "matricula", que existe nos dois com nomes parecidos, para classificar).
CAMPOS_FIELD_DISTINTIVOS = ["status", "motivo"]
CAMPOS_CADASTRAL_DISTINTIVOS = ["consumo", "periodo"]


def montar_df_cadastral(df_bruto, mapeamento_cad, colunas_extras_escolhidas, coluna_periodo, usa_periodo):
    df_cad_padrao = pd.DataFrame(index=df_bruto.index)
    for campo in ["matricula", "endereco", "consumo", "qtd_economias", "situacao_documental"]:
        coluna = mapeamento_cad.get(campo)
        if coluna and coluna != "(nenhuma)" and coluna in df_bruto.columns:
            df_cad_padrao[campo] = df_bruto[coluna]
        else:
            df_cad_padrao[campo] = ""
    if usa_periodo and coluna_periodo in df_bruto.columns:
        df_cad_padrao["_periodo"] = df_bruto[coluna_periodo]
    for coluna in colunas_extras_escolhidas:
        if coluna in df_bruto.columns:
            df_cad_padrao[coluna] = df_bruto[coluna]
    return df_cad_padrao


def classificar_arquivo(colunas):
    """Identifica se um arquivo parece ser do field ou da base cadastral,
    olhando só para colunas que são características de cada tipo (não usa
    'matrícula', que aparece nos dois com nomes parecidos)."""
    tem_field = any(
        sugerir_coluna(colunas, ALIASES_VISITA.get(c, [])) != "(nenhuma)" for c in CAMPOS_FIELD_DISTINTIVOS
    )
    tem_cadastral = any(
        sugerir_coluna(colunas, ALIASES_CADASTRAL.get(c, [])) != "(nenhuma)" for c in CAMPOS_CADASTRAL_DISTINTIVOS
    )
    if tem_field and not tem_cadastral:
        return "field"
    if tem_cadastral and not tem_field:
        return "cadastral"
    return "desconhecido"


def bloco_importar_visitas(arquivos):
    arquivos_alvo = escolher_arquivos_alvo(arquivos, "field", "forcar_field")
    if not arquivos_alvo:
        return

    df_bruto = io_utils.ler_arquivo(arquivos_alvo[0]["arquivo"])
    st.dataframe(df_bruto.head(10), use_container_width=True)
    if len(arquivos_alvo) > 1:
        st.caption(
            f"{len(arquivos_alvo)} arquivo(s) a processar. O mapeamento de colunas abaixo "
            f"(baseado em **{arquivos_alvo[0]['arquivo'].name}**) será aplicado a todos — assume "
            "que têm a mesma estrutura de colunas."
        )

    st.write("Mapeie as colunas do arquivo para os campos abaixo (sugestão automática já aplicada):")
    colunas_disponiveis = list(df_bruto.columns)
    mapeamento = {}
    colunas_ui = st.columns(3)
    for i, campo in enumerate(CAMPOS_VISITA_TODOS):
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
        return
    if not st.button("Importar visitas do field", type="primary", key="btn_importar_field"):
        return

    barra = st.progress(0.0, text="Importando...")
    total_novas = total_duplicadas = arquivos_ok = 0
    erros = []
    for i, info in enumerate(arquivos_alvo):
        arq = info["arquivo"]
        try:
            df_bruto_i = df_bruto if i == 0 else io_utils.ler_arquivo(arq)
            ausentes = colunas_mapeadas_ausentes(df_bruto_i, mapeamento, CAMPOS_VISITA_TODOS)
            if ausentes:
                erros.append(
                    f"{arq.name}: pulado — não parece um arquivo do field "
                    f"(colunas ausentes: {', '.join(mapeamento[c] for c in ausentes)})"
                )
            else:
                df_padrao = montar_df_visita(df_bruto_i, mapeamento)
                novas, duplicadas = db.importar_visitas(df_padrao, arq.name)
                db.registrar_arquivo_importado("field", arq.name, info["hash"], arq.size)
                total_novas += novas
                total_duplicadas += duplicadas
                arquivos_ok += 1
        except Exception as e:
            erros.append(f"{arq.name}: {e}")
        barra.progress((i + 1) / len(arquivos_alvo), text=f"Importando {i + 1}/{len(arquivos_alvo)}: {arq.name}")
    barra.empty()
    st.toast(
        f"{total_novas} visita(s) nova(s) em {arquivos_ok} arquivo(s) processado(s). "
        f"{total_duplicadas} já existiam e foram ignoradas.",
        icon="✅",
    )
    if erros:
        st.session_state["erros_field"] = erros
    st.rerun()


def bloco_atualizar_cadastral(arquivos):
    arquivos_alvo = escolher_arquivos_alvo(arquivos, "cadastral", "forcar_cadastral")
    if not arquivos_alvo:
        return

    df_cad_bruto = io_utils.ler_arquivo(arquivos_alvo[0]["arquivo"])
    st.dataframe(df_cad_bruto.head(10), use_container_width=True)
    if len(arquivos_alvo) > 1:
        st.caption(
            f"{len(arquivos_alvo)} arquivo(s) a processar. O mapeamento abaixo, baseado em "
            f"**{arquivos_alvo[0]['arquivo'].name}** ({len(df_cad_bruto)} linha(s)), será aplicado a todos."
        )
    else:
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
    st.caption("`periodo` é opcional: deixe '(nenhuma)' se sua base já tem uma linha por matrícula.")

    colunas_mapeadas = {v for v in mapeamento_cad.values() if v != "(nenhuma)"}
    colunas_extras_disponiveis = [c for c in df_cad_bruto.columns if c not in colunas_mapeadas]
    colunas_extras_escolhidas = st.multiselect(
        "Outras colunas para manter junto de cada matrícula (ex: potencial "
        "de incremento, categoria do imóvel, outras oportunidades)",
        colunas_extras_disponiveis,
        key="extras_cadastral",
    )

    faltando_cad = [c for c in CAMPOS_CADASTRAL_OBRIGATORIOS if mapeamento_cad.get(c) in (None, "(nenhuma)")]
    if faltando_cad:
        st.warning(f"Campos obrigatórios sem coluna mapeada: {', '.join(faltando_cad)}")
        return
    if not st.button("Atualizar base cadastral", type="primary", key="btn_atualizar_cadastral"):
        return

    coluna_periodo = mapeamento_cad.get("periodo")
    usa_periodo = bool(coluna_periodo and coluna_periodo != "(nenhuma)")

    barra = st.progress(0.0, text="Processando...")
    total = 0
    erros = []
    for i, info in enumerate(arquivos_alvo):
        arq = info["arquivo"]
        try:
            df_cad_bruto_i = df_cad_bruto if i == 0 else io_utils.ler_arquivo(arq)
            ausentes = colunas_mapeadas_ausentes(df_cad_bruto_i, mapeamento_cad, CAMPOS_CADASTRAL_CONHECIDOS)
            if ausentes:
                erros.append(
                    f"{arq.name}: pulado — não parece um arquivo da base cadastral "
                    f"(colunas ausentes: {', '.join(mapeamento_cad[c] for c in ausentes)})"
                )
            else:
                df_cad_padrao = montar_df_cadastral(
                    df_cad_bruto_i, mapeamento_cad, colunas_extras_escolhidas, coluna_periodo, usa_periodo
                )
                total = db.atualizar_cadastral(
                    df_cad_padrao,
                    colunas_extras_escolhidas,
                    coluna_periodo="_periodo" if usa_periodo else None,
                )
                db.registrar_arquivo_importado("cadastral", arq.name, info["hash"], arq.size)
        except Exception as e:
            erros.append(f"{arq.name}: {e}")
        barra.progress(
            (i + 1) / len(arquivos_alvo), text=f"Processando {i + 1}/{len(arquivos_alvo)}: {arq.name}"
        )
    barra.empty()
    st.toast(f"Base cadastral atualizada. {total} matrícula(s) no total.", icon="✅")
    if erros:
        st.session_state["erros_cadastral"] = erros
    st.rerun()


aba_importar, aba_gerar, aba_consulta = st.tabs(
    ["Importar arquivos", "Gerar base de alvos", "Consultar histórico"]
)

with aba_importar:
    if st.session_state.get("erros_field"):
        st.error(
            "Visitas do field — alguns arquivos tiveram erro e foram pulados:\n"
            + "\n".join(st.session_state.pop("erros_field"))
        )
    if st.session_state.get("erros_cadastral"):
        st.error(
            "Base cadastral — alguns arquivos tiveram erro e foram pulados:\n"
            + "\n".join(st.session_state.pop("erros_cadastral"))
        )

    st.write(
        "Envie os arquivos do field e da base cadastral juntos, de uma vez só "
        "(pode selecionar a pasta inteira) — o app identifica automaticamente "
        "pelo conteúdo de cada arquivo se ele é do field ou da base cadastral, "
        "e organiza a importação certa para cada um."
    )
    arquivos = st.file_uploader(
        "Arquivos do field e da base cadastral (Excel ou CSV)",
        type=["xlsx", "xls", "csv"],
        accept_multiple_files=True,
        key="upload_unificado",
    )

    if arquivos:
        grupos = {"field": [], "cadastral": [], "desconhecido": []}
        for arq in arquivos:
            colunas = list(io_utils.ler_colunas(arq).columns)
            grupos[classificar_arquivo(colunas)].append(arq)

        partes = []
        if grupos["field"]:
            partes.append(f"{len(grupos['field'])} do field")
        if grupos["cadastral"]:
            partes.append(f"{len(grupos['cadastral'])} da base cadastral")
        if partes:
            st.caption("🔍 Identifiquei: " + ", ".join(partes) + ".")

        if grupos["desconhecido"]:
            nomes = ", ".join(a.name for a in grupos["desconhecido"])
            st.warning(
                f"Não identifiquei o tipo de {len(grupos['desconhecido'])} arquivo(s) — colunas não "
                f"batem claramente nem com field nem com base cadastral. Não serão processados: {nomes}"
            )

        if grupos["field"]:
            st.subheader("📋 Visitas do field")
            bloco_importar_visitas(grupos["field"])

        if grupos["cadastral"]:
            if grupos["field"]:
                st.divider()
            st.subheader("🏠 Base cadastral")
            bloco_atualizar_cadastral(grupos["cadastral"])

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
