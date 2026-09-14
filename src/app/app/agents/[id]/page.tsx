import { Screen } from "@/components/screen";
import { configured } from "@/lib/env";
export default async function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Screen section="agent-detail" connected={configured()} agentId={id} />
  );
}
