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
   agora — ordenável por qualquer coluna, com exportação para Excel.
6. **Consultar histórico** — todas as visitas já registradas de uma
   matrícula específica.
7. **Auditoria** — lista todos os arquivos lidos, o tipo identificado e a
   quantidade de linhas, para conferir se algo não foi reconhecido.

## Requisitos

Funciona melhor no **Chrome ou Edge** (desktop), que suportam a API do
navegador usada para lembrar a pasta autorizada entre usos (File System
Access API). Em outros navegadores (Firefox, Safari) o app ainda funciona,
mas pede pra você reselecionar a pasta a cada visita, sem o atalho de
"Atualizar" com um clique.

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

Gera um site 100% estático na pasta `out/` — sobe em qualquer host de
arquivos estáticos (Cloudflare Workers/Pages, Vercel, Netlify, etc.). Não
precisa de servidor Node.js em produção; nenhuma planilha passa por um
backend.

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
lib/idb.ts                     cache local (IndexedDB): arquivos já processados, regras
lib/fs-access.ts                 leitura recursiva da pasta conectada (File System Access API)
lib/export-xlsx.ts               exportação da base de alvos para Excel
public/vendor/xlsx.full.min.js    leitor de Excel (SheetJS), vendorizado para não depender de CDN
```
