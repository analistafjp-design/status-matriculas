from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "data" / "historico.db"

# Dias de "resfriamento" por status de visita: por quantos dias uma matrícula
# fica fora de novas bases depois de receber esse status na última visita.
# Valores iniciais baseados nos status/motivos mais comuns de uma exportação
# real do field (Status da Atividade + Motivo de Não Execução combinados). A
# lista real de motivos costuma ser grande e específica da operação — o que
# não estiver aqui aparece marcado como "sem regra configurada" ao gerar a
# base (e continua incluído, nunca some) até você adicionar/ajustar a regra
# na barra lateral do app.
REGRAS_RESFRIAMENTO_PADRAO = {
    "Finalizada": 365,
    "Encerrada com Ocorrência - CLIENTE AUSENTE": 15,
    "Encerrada com Ocorrência - RETORNAR DEPOIS": 7,
    "Encerrada com Ocorrência - SUSPENSO": 180,
    "Encerrada com Ocorrência - NADA A FAZER NO LOCAL": 90,
    "Encerrada com Ocorrência - ENDEREÇO NÃO LOCALIZADO": 90,
    "Cancelada - SUSPENSO": 180,
    "Paralisada": 10,
    "Pendente": 3,
}
