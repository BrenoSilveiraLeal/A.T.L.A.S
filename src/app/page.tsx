import { redirect } from "next/navigation";
// The owner enters the ATLAS building first and picks an office floor (owner, 01/11/2026).
export default function Home() {
  redirect("/predio");
}
