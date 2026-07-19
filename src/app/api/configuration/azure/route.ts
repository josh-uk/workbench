import {
  disconnectAzure,
  getAzureConnectionState,
} from "@/features/authentication/azure/azure-cli";
import {
  assertTrustedMutation,
  azureErrorResponse,
  azureJson,
} from "@/features/authentication/azure/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return azureJson(await getAzureConnectionState());
}

export async function DELETE(request: Request) {
  try {
    assertTrustedMutation(request);
    await disconnectAzure();
    return azureJson({ ok: true });
  } catch (error) {
    return azureErrorResponse(error);
  }
}
