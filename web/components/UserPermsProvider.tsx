"use client";

import { createContext, useContext } from "react";
import type { UserPerms } from "@/lib/permissions";

const Ctx = createContext<UserPerms | null>(null);

export function UserPermsProvider({
  user, children,
}: {
  user: UserPerms | null;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={user}>{children}</Ctx.Provider>;
}

export function useUserPerms(): UserPerms | null {
  return useContext(Ctx);
}
