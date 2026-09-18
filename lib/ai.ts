import type { InterpretacaoIA } from "./types";

export type PedidoInterpretacao = {
  matricula: string;
  parecer: string;
  status: string;
  tipoAtividade: string;
  dataVisita: string;
};

// Chama o Worker (worker.js, rota /api/interpretar-parecer) que faz a
// ponte com a API da Anthropic — a chave fica só no servidor. Só funciona
// no site publicado (Cloudflare Workers), não no `next dev` local.
export async function interpretarParecer(pedido: PedidoInterpretacao): Promise<InterpretacaoIA> {
  const resposta = await fetch("/api/interpretar-parecer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(pedido),
  });
  const dados: unknown = await resposta.json().catch(() => null);
  if (!resposta.ok || !dados || typeof dados !== "object") {
    const mensagem =
      dados && typeof dados === "object" && "error" in dados ? String((dados as { error: unknown }).error) : null;
    throw new Error(mensagem || "Falha ao interpretar com IA.");
  }
  return dados as InterpretacaoIA;
}
