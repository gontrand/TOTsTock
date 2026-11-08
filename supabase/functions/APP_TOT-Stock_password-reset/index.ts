import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { handlePasswordResetRequest } from '../_shared/passwordResetHandler.ts';

serve(handlePasswordResetRequest);
