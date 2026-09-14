import { notFound } from "next/navigation";
import { Screen, sections } from "@/components/screen";
import { configured } from "@/lib/env";
export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!sections.includes(section)) notFound();
  return <Screen section={section} connected={configured()} />;
}
