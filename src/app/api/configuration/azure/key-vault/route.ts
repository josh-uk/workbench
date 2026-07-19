import { testKeyVaultReferenceSchema } from "@/features/authentication/azure/domain";
import {
  assertTrustedMutation,
  azureErrorResponse,
  azureJson,
} from "@/features/authentication/azure/http";
import { testKeyVaultSecretReference } from "@/features/authentication/azure/key-vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const input = testKeyVaultReferenceSchema.parse(await request.json());
    return azureJson(await testKeyVaultSecretReference(input.reference));
  } catch (error) {
    return azureErrorResponse(error);
  }
}
