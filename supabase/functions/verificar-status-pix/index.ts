// Caminho: supabase/functions/verificar-status-pix/index.ts

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { Database } from '../_shared/db_types.ts'

interface RequestBody {
  transactionId: string;
  productOwnerUserId: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { transactionId, productOwnerUserId }: RequestBody = await req.json();

    if (!transactionId || !productOwnerUserId) {
      throw new Error("ID da transação e ID do vendedor são obrigatórios.");
    }

    const adminClient = createClient<Database>(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: settings, error: settingsError } = await adminClient
      .from('app_settings')
      .select('api_tokens')
      .eq('platform_user_id', productOwnerUserId)
      .single();

    if (settingsError || !settings) throw new Error("Configurações do vendedor não encontradas.");

    const apiTokens = settings.api_tokens as any;
    const pushinPayToken = apiTokens?.pushinPay;
    if (!pushinPayToken) throw new Error("Token PushInPay não configurado para o vendedor.");

    // LÓGICA REAL: Chamada para a API da PushInPay para verificar o status
    console.log(`Verificando status da transação ${transactionId}...`);
    const statusResponse = await fetch(`https://api.pushinpay.com.br/api/transactions/${transactionId}`, {
        headers: { 'Authorization': `Bearer ${pushinPayToken}` }
    });

    const statusData = await statusResponse.json();
    if (!statusResponse.ok) throw new Error(statusData.message || "Erro ao verificar status do pagamento.");

    return new Response(JSON.stringify({ success: true, data: statusData.data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, message: err.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
    });
  }
})