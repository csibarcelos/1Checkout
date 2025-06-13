// Caminho: supabase/functions/gerar-pix/index.ts

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { Database } from '../_shared/db_types.ts'

interface RequestBody {
  payload: any;
  productOwnerUserId: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { payload, productOwnerUserId }: RequestBody = await req.json()

    if (!productOwnerUserId) {
      throw new Error("ID do vendedor é obrigatório.")
    }

    const adminClient = createClient<Database>(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 1. Busca as configurações do vendedor de forma segura
    const { data: settings, error: settingsError } = await adminClient
      .from('app_settings')
      .select('api_tokens')
      .eq('platform_user_id', productOwnerUserId)
      .single()

    if (settingsError) throw new Error(`Erro ao buscar configurações do vendedor: ${settingsError.message}`);
    if (!settings) throw new Error(`Configurações de API não encontradas para o vendedor.`);

    const apiTokens = settings.api_tokens as any;
    const pushinPayToken = apiTokens?.pushinPay;
    const isPushinPayEnabled = apiTokens?.pushinPayEnabled;
    
    if (!isPushinPayEnabled || !pushinPayToken) {
      throw new Error('O pagamento via PIX (PushInPay) não está habilitado ou configurado para este vendedor.');
    }
    
    // 2. Chama a API REAL da PushInPay
    const pushinPayResponse = await fetch('https://api.pushinpay.com.br/api/pix/cashIn', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${pushinPayToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({
            value: payload.value,
            webhook_url: payload.webhook_url
        })
    });

    const pushinPayData = await pushinPayResponse.json();
    if (!pushinPayResponse.ok || !pushinPayData.data) {
        throw new Error(pushinPayData.message || 'Erro no gateway de pagamento.');
    }
    
    // 3. TODO: Disparar evento "venda pendente" para a UTMify aqui no futuro

    // 4. CORREÇÃO PRINCIPAL: Monta e retorna a resposta no formato que o frontend espera
    const finalResponse = {
        success: true,
        // O objeto 'data' da PushInPay é passado diretamente dentro do nosso objeto 'data'
        data: {
            id: pushinPayData.data.id,
            qr_code: pushinPayData.data.qr_code,
            qr_code_base64: pushinPayData.data.qr_code_base64,
            status: pushinPayData.data.status,
            value: pushinPayData.data.value,
        },
        message: "PIX gerado com sucesso."
    };

    return new Response(JSON.stringify(finalResponse), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
    });

  } catch (err: any) {
    console.error("Erro fatal na Edge Function 'gerar-pix':", err.message);
    return new Response(JSON.stringify({ success: false, message: err.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
    });
  }
})