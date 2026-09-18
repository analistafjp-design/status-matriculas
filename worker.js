// Serve o export estático do Next.js e expõe uma única rota de API
// (/api/interpretar-parecer) que faz a ponte com a API da Anthropic para
// interpretar o texto do "Parecer De Campo". A chave da API fica só aqui
// (variável de ambiente/secret do Worker) — nunca chega ao navegador.
// Nenhuma planilha nem histórico de visitas passa por este Worker além do
// texto do parecer que o usuário pediu pra interpretar.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_PARECER_CHARS = 4000;

const SYSTEM_PROMPT = `Você é um assistente do setor de Cadastro e Crescimento Vegetativo de uma empresa de \
saneamento (água/esgoto). Você recebe o texto de um "Parecer de Campo" escrito por um técnico depois de \
visitar um imóvel, e o contexto da visita (status, tipo de atividade, data).

Sua tarefa é ler o parecer e responder SOMENTE com um JSON válido (sem markdown, sem texto fora do JSON), \
no formato exato:
{"resumo": "...", "oportunidade": true|false, "categoria": "incremento_economias"|"ligacao_nova"|"atualizacao_cadastral"|"nenhuma"|"outro", "recomendacaoVisita": true|false}

Regras:
- "resumo": no máximo 2 frases curtas, em português, resumindo objetivamente o que o parecer relata sobre o \
que foi encontrado no imóvel.
- "categoria": escolha a que melhor descreve uma oportunidade real para o setor de Cadastro e Crescimento \
Vegetativo:
  - "incremento_economias": indícios de mais unidades/famílias/ligações internas no imóvel do que o \
cadastrado (ex: imóvel dividido, kitnets, mais de uma economia aparente).
  - "ligacao_nova": indícios de imóvel sem ligação de água regular, ligação clandestina, obra ou construção \
nova que ainda não tem ligação.
  - "atualizacao_cadastral": indícios de dado cadastral desatualizado (endereço errado, imóvel demolido, \
titularidade mudou, uso do imóvel mudou).
  - "nenhuma": não há oportunidade clara relacionada a esse setor.
  - "outro": há algo relevante, mas não se encaixa nas categorias acima.
- "oportunidade": true só quando há indício real e específico no texto, não apenas porque a visita aconteceu.
- "recomendacaoVisita": true se vale a pena agendar uma nova visita para confirmar ou aproveitar a oportunidade.
- Nunca invente informação que não esteja no texto. Se o parecer estiver vazio, genérico ou não disser nada \
útil, responda com "categoria":"nenhuma" e "oportunidade":false.`;

function json(value, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}

async function interpretarParecer(request, env) {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, { status: 405 });
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: "IA não configurada neste ambiente (falta o secret ANTHROPIC_API_KEY)." }, { status: 501 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corpo inválido." }, { status: 400 });
  }

  const parecer = String(body?.parecer ?? "").trim().slice(0, MAX_PARECER_CHARS);
  if (!parecer) return json({ error: "Texto do Parecer de Campo vazio." }, { status: 400 });

  const contexto = [
    body?.status ? `Status da visita: ${String(body.status).slice(0, 200)}` : null,
    body?.tipoAtividade ? `Tipo de atividade: ${String(body.tipoAtividade).slice(0, 200)}` : null,
    body?.dataVisita ? `Data da visita: ${String(body.dataVisita).slice(0, 40)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const userContent = `${contexto ? contexto + "\n\n" : ""}Parecer de Campo:\n${parecer}`;

  let resposta;
  try {
    resposta = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 400,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
    });
  } catch {
    return json({ error: "Falha ao contatar a IA. Tente novamente." }, { status: 502 });
  }

  if (!resposta.ok) {
    const detalhe = await resposta.text().catch(() => "");
    return json({ error: `IA retornou erro (${resposta.status}).`, detalhe: detalhe.slice(0, 500) }, { status: 502 });
  }

  const dados = await resposta.json();
  const texto = dados?.content?.[0]?.text ?? "";
  let interpretado;
  try {
    const match = texto.match(/\{[\s\S]*\}/);
    interpretado = JSON.parse(match ? match[0] : texto);
  } catch {
    return json({ error: "Não foi possível interpretar a resposta da IA.", bruto: texto.slice(0, 500) }, { status: 502 });
  }

  return json({
    resumo: String(interpretado.resumo ?? "").slice(0, 1000),
    oportunidade: Boolean(interpretado.oportunidade),
    categoria: String(interpretado.categoria ?? "outro"),
    recomendacaoVisita: Boolean(interpretado.recomendacaoVisita),
  });
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/interpretar-parecer") {
      return interpretarParecer(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

export default worker;
