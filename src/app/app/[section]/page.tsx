import { notFound } from "next/navigation";
import { Screen } from "@/components/screen";
import { configured } from "@/lib/env";

// Route validation runs on the server; values exported by a client boundary
// cannot be consumed here as ordinary JavaScript arrays.
const sections = [
  "office",
  "agents",
  "portfolio",
  "market",
  "news",
  "orders",
  "treasury",
  "risk",
  "audit",
  "settings",
  "health",
  "research",
  "paper",
];
export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!sections.includes(section)) notFound();
  return <Screen section={section} connected={configured()} />;
}
