import { Radar } from "lucide-react";
import { PortalsView } from "@/components/portals-view";

export const dynamic = "force-dynamic";

export default function PortalsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-center gap-3">
        <Radar className="size-6 text-brand" />
        <h1 className="font-display text-2xl tracking-tight text-landing">Portais</h1>
      </div>
      <p className="mt-1.5 max-w-xl text-sm text-muted">
        Empresas onde o career-ops procura novas oportunidades. A verificação deteta páginas de emprego que deixaram de
        funcionar; enquanto a ligação estiver quebrada, essa empresa fica fora das pesquisas seguintes.
      </p>
      <p className="mt-1.5 text-xs text-faint">
        A lista está em <code className="text-muted">portals.yml</code>. Podes editar o ficheiro ou pedir ajuda ao assistente.
      </p>
      <div className="mt-6">
        <PortalsView />
      </div>
    </div>
  );
}
