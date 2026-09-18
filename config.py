from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "data" / "historico.db"

# Dias de "resfriamento" por status de visita: por quantos dias uma matrícula
# fica fora de novas bases depois de receber esse status na última visita.
REGRAS_RESFRIAMENTO_PADRAO = {
    "Concluída - sem oportunidade": 180,
    "Concluída - oportunidade identificada": 15,
    "Recusa": 90,
    "Sem acesso": 30,
    "Ausente": 30,
}
