// Server-only: loosely typed service-role handle.
//
// The generated Database types lag behind migrations, so orchestrator and
// analytics code query through this handle while app code keeps using the
// explicit row types in lib/types.ts and lib/production/steps.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const adminDb = supabaseAdmin as unknown as SupabaseClient;
