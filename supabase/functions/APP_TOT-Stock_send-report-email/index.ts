import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleSendReportEmailRequest } from "../_shared/sendReportEmailHandler.ts";

serve(handleSendReportEmailRequest);
