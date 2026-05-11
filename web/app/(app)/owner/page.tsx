import { redirect } from "next/navigation";
import { supaServer } from "@/lib/supabase-server";
import OwnerDashboard from "./components/OwnerDashboard";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const OWNER_EMAIL = "benny@waterworks.com.br";

export default async function OwnerPage() {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) redirect("/login?next=/owner");
  if ((user.email ?? "").toLowerCase() !== OWNER_EMAIL) {
    redirect("/avulsos");
  }
  return <OwnerDashboard />;
}
