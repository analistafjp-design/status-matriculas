# Gestão de Alvos de Campo

Ferramenta para cruzar o histórico de visitas do field com a base cadastral
e gerar novas bases de alvos sem repetir endereços já visitados sem
sucesso.

## Problema que resolve

Hoje a geração de bases não tem memória entre execuções: cada nova base é
filtrada só contra o arquivo do momento, então endereços já visitados (e
sem resultado) voltam a aparecer, gerando reclamação dos colaboradores.

Esta ferramenta mantém um **histórico persistente de visitas** (banco
SQLite local) que se acumula a cada arquivo do field importado. Toda nova
base é gerada contra esse histórico completo, não contra um único arquivo.

## Como funciona

1. **Importar visitas (field)** — sobe o arquivo do field. O app já
   sugere automaticamente o mapeamento de colunas para exportações comuns
   (ex: `Matrícula`, `Data`, `Status da Atividade`, `Motivo de Não
   Execução`), mas qualquer coluna pode ser remapeada manualmente. Quando
   existir uma coluna de motivo (ou duas, ex: "Cobrança" e "Normal"), o
   motivo é combinado com o status para regras de resfriamento mais
   precisas (ex: `Encerrada com Ocorrência - CLIENTE AUSENTE`). Visitas
   repetidas (mesma matrícula + data + OS + status) são ignoradas
   automaticamente.
2. **Atualizar base cadastral** — sobe a base cadastral atual (consumo,
   quantidade de economias, situação documental, e quaisquer outras
   colunas de interesse, como potencial de incremento). Se a base tiver
   uma linha por matrícula **por mês** (histórico de consumo), mapeie
   também a coluna de período — o app agrupa por matrícula e calcula
   consumo médio, consumo do último mês e quantos meses tiveram consumo
   zero (sinal forte de ligação ativa mas sem uso — possível oportunidade
   ou irregularidade).
3. **Regras de resfriamento** (barra lateral) — define, por status de
   visita, quantos dias uma matrícula fica fora de novas bases depois de
   receber aquele status. Os valores iniciais são um ponto de partida —
   ajuste conforme os status/motivos reais da sua operação (aparecem na
   base gerada como "sem regra configurada" até serem adicionados aqui,
   e continuam incluídos, nunca somem por falta de regra).
4. **Gerar base de alvos** — cruza a base cadastral com o histórico,
   aplicando as regras de resfriamento, e devolve só quem pode ser
   visitado agora — com o motivo da inclusão — pronta para baixar em
   Excel.
5. **Consultar histórico** — busca todas as visitas já registradas de uma
   matrícula específica.

## Como rodar localmente

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

A aplicação abre em `http://localhost:8501`. O histórico fica salvo em
`data/historico.db` (SQLite), que **não é versionado no git** — precisa
existir no mesmo lugar onde a aplicação roda para manter a memória entre
usos.

## Observação sobre persistência

Se esta aplicação for publicada em um servidor com disco efêmero (alguns
serviços de deploy gratuitos apagam o disco a cada reinício), o arquivo
`data/historico.db` pode ser perdido, junto com o histórico. Para uso
contínuo, rodar localmente ou em um servidor/container com disco
persistente.

## Estrutura

```
app.py           interface Streamlit
config.py        configurações (caminho do banco, regras padrão)
src/db.py        acesso ao banco SQLite (histórico + cadastral + regras)
src/io_utils.py  leitura de arquivos Excel/CSV enviados
src/matching.py  lógica de cruzamento e geração da base de alvos
```
