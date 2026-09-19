# Gestão de Alvos de Campo

Ferramenta para cruzar o histórico de visitas do field com a base cadastral
e gerar novas bases de alvos sem repetir endereços já visitados sem
sucesso.

## Problema que resolve

A geração de bases não tinha memória entre execuções: cada nova base era
filtrada só contra o arquivo do momento, então endereços já visitados (e
sem resultado) voltavam a aparecer, gerando reclamação dos colaboradores.

Este app lê as planilhas **direto do seu computador, no navegador** — sem
subir nada pela internet — e mantém um histórico persistente local que se
acumula a cada nova leitura da pasta. Toda base de alvos é gerada contra
esse histórico completo, não contra um único arquivo.

## Como funciona

1. **Conectar pasta** (primeira vez) — escolha a pasta que tem os arquivos
   do field e da base cadastral (pode ter subpastas, ex: "Base Cadastral" e
   "De Janeiro a Agosto" — o app lê tudo recursivamente). O navegador
   guarda essa autorização.
2. **Atualizar** (das próximas vezes em diante) — um clique relê a mesma
   pasta. Arquivos que não mudaram desde a última vez são pulados
   automaticamente (comparando tamanho e data de modificação) — só o que é
   novo ou foi alterado é reprocessado. Sem upload: tudo acontece no seu
   computador.
3. **Classificação automática** — cada arquivo é identificado pelo
   **conteúdo** (quais colunas ele tem), não pelo nome: arquivos do field
   (`Matrícula`, `Status da Atividade`, `Motivo de Não Execução`) viram
   visitas; arquivos da base cadastral (`NUM_LIGACAO`, `CON_MEDIDO`,
   `Mês/Ano`) viram registros de consumo. Motivo de não execução (quando
   houver mais de uma coluna, ex. "Cobrança" e "Normal") é combinado com o
   status para regras de resfriamento mais precisas (ex: `Encerrada com
   Ocorrência - CLIENTE AUSENTE`). Se a base cadastral tiver uma linha por
   matrícula por período (histórico de consumo), o app acumula todos os
   períodos já lidos e calcula consumo médio, consumo do período mais
   recente e quantos períodos tiveram consumo zero — sinal de ligação
   ativa mas sem uso.
4. **Regras de resfriamento** — por quantos dias uma matrícula fica fora da
   base de alvos depois de receber cada status na última visita. Status
   sem regra configurada aparece incluído por padrão (nunca some
   silenciosamente).
5. **Base de alvos** — cruza a base cadastral com o histórico de visitas,
   aplica as regras de resfriamento, e mostra só quem pode ser visitado
   agora — ordenável por qualquer coluna, com filtro por cidade/bairro, um
   botão pra ocultar visualmente quem está com status Cancelada, Paralisada
   ou Pendente (não interessam pro dia a dia, mas continuam contados no
   histórico) e exportação para Excel.
6. **Por região** — quantos alvos disponíveis existem em cada cidade/bairro
   agora, e quantos nunca foram visitados. Clicar numa linha filtra a Base
   de alvos por aquela região.
7. **Oportunidades** — três recortes prontos, sem precisar configurar nada:
   possível incremento de economias (consumo por economia bem acima da
   média, pode indicar mais unidades no imóvel do que o cadastrado),
   atualização cadastral pendente (situação documental vazia, irregular,
   em análise, suspensa ou cancelada) e possível ligação nova/regularização
   (o texto do Parecer de Campo da última visita menciona palavras como
   "ligação clandestina", "sem ligação", "obra nova" etc — é uma busca por
   palavras-chave, pensada pra apontar candidatos pra confirmar na aba
   seguinte).
8. **Buscar matrícula(s)** — cole uma ou várias matrículas (uma por linha)
   ou envie um arquivo com uma coluna de matrícula, e veja pra cada uma: se
   já foi visitada, tipo de atividade, status, data, cidade/bairro e o
   texto completo do Parecer de Campo da última visita, com todo o
   histórico de visitas daquela matrícula. O botão **Interpretar com IA**
   manda o texto do parecer pra um Worker que consulta a API da Anthropic
   (Claude) e devolve um resumo curto, se há indício de oportunidade e de
   que tipo (incremento de economias, ligação nova, atualização cadastral)
   e se vale agendar nova visita — focado no que interessa pro setor de
   Cadastro e Crescimento Vegetativo. Isso só funciona no site publicado
   (ver "IA para interpretar o Parecer de Campo" abaixo); no `next dev`
   local o botão aparece mas a chamada falha, porque não tem Worker rodando.
9. **Consumo Social/Comércio** — cruza a categoria cadastral (`SUB_CATEGORIA`)
   com o histórico de consumo mensal pra achar quem estourou o limite da
   categoria: **Social até 15m³** e **Pequeno Comércio até 10m³**. Só conta
   como estouro quando o consumo **medido E o faturado** passam do limite.
   Exigir os dois evita o falso positivo mais comum: ligação sem consumo
   real (hidrômetro em 0, às vezes cortada) que mesmo assim recebe uma
   cobrança mínima acima do limite — faturado alto sozinho não é consumo de
   verdade. O mês corrente nunca entra na conta enquanto não estiver "fechado" — um
   período só conta como fechado quando tem pelo menos 70% das leituras do
   mês mais completo já lido (os técnicos ainda estão lendo os hidrômetros
   ao longo do mês). O radar usa sempre os **2 meses fechados anteriores**
   (ex: Julho e Agosto); quando o mês corrente fecha, ele vira o terceiro e
   passa a valer pra aba de 3 meses (Julho/Agosto/Setembro). A coluna "Meses
   estourados (detalhe)" mostra exatamente quais meses entraram na conta de
   cada linha. **Conjuntos habitacionais são excluídos de todas as listas**
   desta aba (reconhecidos pelo endereço: "CONJ.HABIT.", "BNH", "COHAB"
   etc) — consumo agregado de várias unidades numa matrícula só não é a
   anomalia que interessa aqui. Social e Pequeno Comércio ficam em cards
   separados (cada um com sua lista de 3 meses e de radar), e cada lista
   tem cidade/bairro e botão de Excel:
   - **Estouraram os 3 meses** (por categoria) — consumo acima do limite
     nos 3 meses fechados mais recentes.
   - **No radar (2 meses fechados anteriores)** (por categoria) — ainda não
     são os 3, mas já merece acompanhamento — um mapeamento do que pode
     virar caso confirmado assim que o mês corrente fechar.
   - **Social com mais de 1 economia** — categoria Social com mais de uma
     economia na mesma matrícula, excluindo conjuntos habitacionais
     (reconhecidos pelo endereço: "CONJ.HABIT.", "BNH", "COHAB" etc — esses
     legitimamente têm muitas economias e não são a anomalia que interessa).
10. **Auditoria** — lista todos os arquivos lidos, o tipo identificado e a
    quantidade de linhas, para conferir se algo não foi reconhecido.

## Requisitos

Funciona melhor no **Chrome ou Edge** (desktop), que suportam a API do
navegador usada para lembrar a pasta autorizada entre usos (File System
Access API). Em outros navegadores (Firefox, Safari) o app ainda funciona,
mas pede pra você reselecionar a pasta a cada visita, sem o atalho de
"Atualizar" com um clique.

A interface é responsiva — funciona em desktop, tablet e celular (abas com
rolagem horizontal, tabelas com rolagem própria, filtros empilhados em
telas estreitas).

## Como rodar localmente

```bash
npm install
npm run dev
```

Abre em `http://localhost:3000`.

## Como publicar

```bash
npm run build
```

Gera um site 100% estático na pasta `out/`. O deploy usa Cloudflare
Workers (`npx wrangler deploy`) porque a rota de IA (`worker.js`) precisa
de um Worker de verdade — as planilhas continuam sem passar por backend
nenhum, só o texto do Parecer de Campo quando alguém clica em "Interpretar
com IA".

## IA para interpretar o Parecer de Campo

O botão "Interpretar com IA" (aba **Buscar matrícula(s)**) chama a rota
`/api/interpretar-parecer`, servida pelo `worker.js`, que repassa o texto
pra API da Anthropic usando uma chave guardada só no servidor — ela nunca
chega ao navegador. Pra ligar isso no site publicado:

1. Crie uma chave em [console.anthropic.com](https://console.anthropic.com)
   (Settings → API Keys).
2. No painel do Cloudflare: **Workers & Pages → status-matriculas →
   Settings → Variables and Secrets → Add** → nome `ANTHROPIC_API_KEY`,
   tipo **Secret**, valor a chave copiada → Save and deploy.

Sem essa variável configurada, o botão continua aparecendo mas mostra um
erro claro ("IA não configurada neste ambiente") em vez de travar o app.
Pra testar essa rota localmente antes de publicar: crie um arquivo
`.dev.vars` na raiz do projeto com `ANTHROPIC_API_KEY="sua-chave"` (esse
arquivo é ignorado pelo git) e rode `npm run build && npx wrangler dev`.

## Sobre onde o histórico fica salvo

O histórico (visitas, consumo, regras) fica no **IndexedDB do navegador**,
neste computador — não é enviado a lugar nenhum. Isso quer dizer:

- Se você limpar os dados do navegador, ou usar outro computador, o
  histórico local se perde — mas nada é perdido de verdade: como o app
  sempre recalcula tudo a partir dos arquivos da pasta, basta reconectar a
  mesma pasta (com todos os arquivos do field acumulados ao longo do
  tempo, sem apagar os antigos) que o histórico completo é reconstruído.
- Por isso é importante **manter os arquivos diários do field na pasta**
  (não apagar os antigos depois de importados) — eles são a fonte de
  verdade; o IndexedDB é só um cache local para não precisar reler tudo
  toda vez.
- Cada pessoa que abrir o app no próprio computador, apontando pra mesma
  pasta (ex: a mesma pasta do OneDrive sincronizada), reconstrói o mesmo
  histórico de forma independente — não há um banco compartilhado.

## Estrutura

```
app/dashboard-client.tsx   interface principal (conectar pasta, abas, tabelas)
app/page.tsx               carrega o leitor de Excel vendorizado
lib/types.ts                tipos compartilhados
lib/classify.ts              mapeamento de colunas e classificação do tipo de arquivo
lib/parse.ts                  leitura de um arquivo (Excel/CSV) para linhas tipadas
lib/matching.ts                combinação dos arquivos em cima do histórico + geração de alvos
lib/oportunidades.ts           heurísticas das 3 categorias da aba "Oportunidades"
lib/consumo-social.ts          limites por categoria e heurística de conjunto habitacional (aba "Consumo Social/Comércio")
lib/buscar-matriculas.ts       extrai matrículas de texto colado ou de um arquivo enviado
lib/ai.ts                      chamada ao Worker pra interpretar o Parecer de Campo com IA
lib/idb.ts                     cache local (IndexedDB): arquivos já processados, regras
lib/fs-access.ts                 leitura recursiva da pasta conectada (File System Access API)
lib/export-xlsx.ts               exportação da base de alvos para Excel
worker.js                        Worker do Cloudflare: serve os arquivos estáticos e a rota de IA
public/vendor/xlsx.full.min.js    leitor de Excel (SheetJS), vendorizado para não depender de CDN
```
