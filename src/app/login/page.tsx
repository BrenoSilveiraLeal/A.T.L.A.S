import { Login } from "@/components/login";
import { configured } from "@/lib/env";
export default function LoginPage() { return <Login configured={configured()} />; }
