import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleAdminUsersRequest } from "../_shared/adminUsersHandler.ts";

serve(handleAdminUsersRequest);
