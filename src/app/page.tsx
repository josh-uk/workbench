import { connection } from "next/server";

import { WorkbenchShell } from "@/features/workbench/components/workbench-shell";
import { getWorkbenchNavigation } from "@/features/workspaces/data/workspace-repository";

export default async function Home() {
  await connection();
  const navigation = await getWorkbenchNavigation();

  return <WorkbenchShell navigation={navigation} />;
}
