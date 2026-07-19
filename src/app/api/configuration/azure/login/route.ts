import {
  cancelAzureLogin,
  startAzureLogin,
} from "@/features/authentication/azure/azure-cli";
import {
  assertTrustedMutation,
  azureErrorResponse,
  azureJson,
} from "@/features/authentication/azure/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    return azureJson(await startAzureLogin(await request.json()), {
      status: 202,
    });
  } catch (error) {
    return azureErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertTrustedMutation(request);
    await cancelAzureLogin();
    return azureJson({ ok: true });
  } catch (error) {
    return azureErrorResponse(error);
  }
}
