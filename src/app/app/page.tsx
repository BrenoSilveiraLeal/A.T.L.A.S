import { Screen } from "@/components/screen";
import { configured } from "@/lib/env";
export default function Dashboard() { return <Screen section="overview" connected={configured()} />; }
