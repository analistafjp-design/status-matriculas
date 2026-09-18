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

1. **Importar visitas (field)** — sobe um ou vários arquivos do field de
   uma vez (ex: um por dia — selecione todos juntos no seletor de
   arquivos). O app já sugere automaticamente o mapeamento de colunas para
   exportações comuns (ex: `Matrícula`, `Data`, `Status da Atividade`,
   `Motivo de Não Execução`), com base no primeiro arquivo, aplicado a
   todos; pode ser remapeado manualmente. Quando existir uma coluna de
   motivo (ou duas, ex: "Cobrança" e "Normal"), o motivo é combinado com o
   status para regras de resfriamento mais precisas (ex: `Encerrada com
   Ocorrência - CLIENTE AUSENTE`). Visitas repetidas (mesma matrícula +
   data + OS + status) são ignoradas automaticamente, mesmo vindas de
   arquivos diferentes.
2. **Atualizar base cadastral** — sobe um ou vários arquivos da base
   cadastral (consumo, quantidade de economias, situação documental, e
   quaisquer outras colunas de interesse, como potencial de incremento).
   Se a base tiver uma linha por matrícula **por período** (histórico de
   consumo), mapeie também a coluna de período — o app acumula os
   períodos de todos os arquivos já importados (mesmo em envios separados
   ao longo do tempo, ex: um arquivo por mês) e calcula consumo médio,
   consumo do período mais recente e quantos períodos tiveram consumo
   zero (sinal forte de ligação ativa mas sem uso — possível oportunidade
   ou irregularidade).
3. **Memória de arquivos já importados** — cada arquivo enviado (field ou
   cadastral) é identificado pelo nome + um hash do conteúdo. Se você
   selecionar a mesma pasta de novo (ex: todos os arquivos do ano), os que
   já foram importados sem alteração são pulados automaticamente — só o
   que é novo ou foi modificado é reprocessado. Também existe uma proteção
   cruzada: um arquivo do tipo errado (ex: base cadastral enviada na aba
   do field) é detectado pelas colunas ausentes e pulado com aviso, em vez
   de importado com os dados em branco.
4. **Regras de resfriamento** (barra lateral) — define, por status de
   visita, quantos dias uma matrícula fica fora de novas bases depois de
   receber aquele status. Os valores iniciais são um ponto de partida —
   ajuste conforme os status/motivos reais da sua operação (aparecem na
   base gerada como "sem regra configurada" até serem adicionados aqui,
   e continuam incluídos, nunca somem por falta de regra).
5. **Gerar base de alvos** — cruza a base cadastral com o histórico,
   aplicando as regras de resfriamento, e devolve só quem pode ser
   visitado agora — com o motivo da inclusão — pronta para baixar em
   Excel.
6. **Consultar histórico** — busca todas as visitas já registradas de uma
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
