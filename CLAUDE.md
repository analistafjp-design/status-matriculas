# Gestão de Alvos de Campo (status-matriculas) — instruções para a Claude

O app cruza o **histórico de visitas do field** com a **base cadastral** para
gerar bases de alvos **sem repetir endereços já visitados sem sucesso**. As
planilhas são lidas **no navegador** (File System Access API, melhor no
Chrome ou no Edge). O histórico fica acumulado localmente (IndexedDB), e
nenhuma planilha sai do computador.

O `README.md` tem todas as regras (resfriamento, oportunidades, consumo
Social/Comércio, IA) e é a referência principal.

## Como trabalhar com o usuário

- Converse sempre em **português do Brasil**, de forma direta.
- Preserve o que já funciona. Não mude regra, aba ou cálculo além do que foi
  pedido.
- Não invente dados, resultados nem testes. Se algo não foi verificado, diga
  que não foi.
- **Nunca versione segredos.** A `ANTHROPIC_API_KEY` é um secret do Worker na
  Cloudflare.
- O **branch padrão** deste repositório é
  `claude/practical-archimedes-umwsya`, não `main`. Crie os branches a partir
  dele e abra os PRs (draft) contra ele.
- **Só mescle quando o usuário disser "Pode mesclar"** (ou "Pode").
- Escreva as mensagens de commit e as descrições de PR em português.

## Regras de negócio já combinadas

- **Classificação de arquivos pelo conteúdo (colunas)**, não pelo nome:
  - field: `Matrícula`, `Status da Atividade`, `Motivo de Não Execução`;
  - base cadastral: `NUM_LIGACAO`, `CON_MEDIDO`, `Mês/Ano`.
- **Resfriamento**: cada status deixa a matrícula fora da base de alvos por N
  dias. Um status sem regra configurada aparece incluído por padrão, nunca
  some em silêncio.
- **Consumo Social/Comércio**:
  - Os limites são **Social até 15 m³** e **Pequeno Comércio até 10 m³**.
  - Só é estouro quando o **medido E o faturado** passam do limite.
  - A base são os **2 meses fechados mais recentes**, nunca o mês corrente.
    Um mês é "fechado" com ≥ 70% das leituras do mês mais completo.
  - O 3º mês entra **por matrícula**, quando aquela matrícula tiver leitura
    dele. Se estourou de novo, vai para a lista de 3 meses; se voltou ao
    limite, fica no radar.
  - Cada matrícula é avaliada pelo **próprio histórico**.
  - **Conjuntos habitacionais ficam fora** das listas de estouro.
  - Social e Pequeno Comércio ficam em **cards separados**.
- **IA (Interpretar com IA)**: o `worker.js` faz a ponte com a API da
  Anthropic na rota `/api/interpretar-parecer`. Só o texto do Parecer de
  Campo passa por ele, e isso só funciona no site publicado.

## Estrutura e publicação

- **Stack**: Next.js com export estático (`out/`).
  - Interface em `app/dashboard-client.tsx`.
  - Regras em `lib/`: `parse.ts`, `classify.ts`, `matching.ts`,
    `consumo-social.ts`, `oportunidades.ts`, `buscar-matriculas.ts`,
    `idb.ts`, `fs-access.ts`, `export-xlsx.ts` e `ai.ts`.
- **Publicação**: Cloudflare Workers (`wrangler.jsonc` serve `out/` e o
  `worker.js`).
- **Checagens antes do commit**: `npm run lint` e `npm run build`. Não há
  testes automatizados: ao mudar uma regra de `lib/`, confira o resultado
  com um caso pequeno antes de dizer que está certo.
