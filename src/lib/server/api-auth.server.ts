// Bearer-token authentication for server routes (createServerFn middleware
// only covers server functions). Verifies the Supabase access token and
// returns the caller's user id — never trusts a user id sent by the client.

import { createClient } from "@supabase/supabase-js";

export interface AuthedCaller {
  userId: string;
}

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

export async function requireApiUser(request: Request): Promise<AuthedCaller> {
  const supabaseUrl = process.env["SUPABASE_URL"];
  const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!supabaseUrl || !publishableKey) throw new UnauthorizedError("Backend not configured");

  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) throw new UnauthorizedError();
  const token = header.slice("Bearer ".length).trim();
  if (!token || token.split(".").length !== 3) throw new UnauthorizedError();

  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (
          isNewSupabaseApiKey(publishableKey) &&
          headers.get("Authorization") === `Bearer ${publishableKey}`
        ) {
          headers.delete("Authorization");
        }
        headers.set("apikey", publishableKey);
        return fetch(input, { ...init, headers });
      },
    },
  });

  // A structurally valid but undecodable token can make the SDK throw instead of
  // returning an error; treat every failure here as unauthorized.
  try {
    const { data, error } = await client.auth.getClaims(token);
    if (error || !data?.claims?.sub) throw new UnauthorizedError();
    return { userId: String(data.claims.sub) };
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError();
  }
}

export function unauthorizedResponse(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
