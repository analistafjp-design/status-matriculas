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

1. **Importar visitas (field)** — sobe o arquivo do field, mapeia as
   colunas (matrícula, data, status, etc.) e acrescenta ao histórico.
   Visitas repetidas (mesma matrícula + data + OS + status) são ignoradas
   automaticamente.
2. **Atualizar base cadastral** — sobe a base cadastral atual (consumo,
   quantidade de economias, situação documental, e quaisquer outras
   colunas de interesse, como potencial de incremento). Cada envio
   atualiza os dados da matrícula.
3. **Regras de resfriamento** (barra lateral) — define, por status de
   visita, quantos dias uma matrícula fica fora de novas bases depois de
   receber aquele status (ex: recusa = 90 dias, sem acesso = 30 dias).
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
