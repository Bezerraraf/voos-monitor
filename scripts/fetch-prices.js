// Script rodado pelo GitHub Actions a cada 6h
// Busca preços de voos via Travelpayouts para os próximos 6 meses
// e salva na tabela price_history do Supabase

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TP_TOKEN     = process.env.TRAVELPAYOUTS_TOKEN;

const ROUTES = {
  aju: { origin: 'GRU', dest: 'AJU' },
  ssa: { origin: 'VCP', dest: 'SSA' },
  rec: { origin: 'CGH', dest: 'REC' },
  nat: { origin: 'GRU', dest: 'NAT' },
  eze: { origin: 'GRU', dest: 'EZE' },
  scl: { origin: 'GRU', dest: 'SCL' },
  mad: { origin: 'GRU', dest: 'MAD' },
  lis: { origin: 'GRU', dest: 'LIS' },
  ams: { origin: 'GRU', dest: 'AMS' },
};

// Gera os próximos 6 meses a partir do mês atual (ex: ['2026-06','2026-07',...])
function nextMonths(count = 6) {
  const months = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push(d.toISOString().slice(0, 7)); // 'YYYY-MM'
  }
  return months;
}

async function fetchCheapest(origin, dest, month) {
  const params = new URLSearchParams({
    origin,
    destination: dest,
    depart_date: month,
    return_date: month,
    currency: 'brl',
    token: TP_TOKEN,
  });

  const res = await fetch(`https://api.travelpayouts.com/v1/prices/cheap?${params}`, {
    headers: { 'X-Access-Token': TP_TOKEN },
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`TP ${res.status}: ${txt}`);
  }

  const data = await res.json();
  if (!data.success || !data.data?.[dest]) return null;

  const entries = Object.entries(data.data[dest]);
  if (!entries.length) return null;

  const [, cheapest] = entries.reduce((a, b) => (a[1].price < b[1].price ? a : b));

  return {
    price_brl:  cheapest.price,
    airline:    cheapest.airline,
    dep_date:   cheapest.departure_at ? cheapest.departure_at.split('T')[0] : null,
    ret_date:   cheapest.return_at    ? cheapest.return_at.split('T')[0]    : null,
  };
}

async function upsertPrice(routeId, flight) {
  const row = {
    route_id:   routeId,
    price_brl:  flight.price_brl,
    airline:    flight.airline,
    dep_date:   flight.dep_date,
    ret_date:   flight.ret_date,
    checked_at: new Date().toISOString(),
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/price_history`, {
    method: 'POST',
    headers: {
      apikey:          SUPABASE_KEY,
      Authorization:   `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      Prefer:          'resolution=merge-duplicates',
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase insert error ${res.status}: ${txt}`);
  }
}

async function main() {
  if (!TP_TOKEN)     { console.error('TRAVELPAYOUTS_TOKEN não definido'); process.exit(1); }
  if (!SUPABASE_KEY) { console.error('SUPABASE_SERVICE_KEY não definido'); process.exit(1); }

  const months = nextMonths(6);
  console.log(`Buscando preços para: ${months.join(', ')}`);
  console.log(`Rotas: ${Object.keys(ROUTES).join(', ')}`);

  let saved = 0, errors = 0;

  for (const month of months) {
    for (const [routeId, { origin, dest }] of Object.entries(ROUTES)) {
      try {
        // Pequena pausa para não sobrecarregar a API (1 req/s)
        await new Promise(r => setTimeout(r, 1100));

        const flight = await fetchCheapest(origin, dest, month);
        if (!flight || !flight.price_brl) {
          console.log(`  [${month}] ${routeId}: sem resultado`);
          continue;
        }

        await upsertPrice(routeId, flight);
        console.log(`  [${month}] ${routeId}: R$${flight.price_brl} (${flight.airline}) ${flight.dep_date} → ${flight.ret_date}`);
        saved++;
      } catch (e) {
        console.error(`  [${month}] ${routeId}: ERRO — ${e.message}`);
        errors++;
      }
    }
  }

  console.log(`\nConcluído: ${saved} preços salvos, ${errors} erros`);
  if (errors > 0) process.exit(1);
}

main();
