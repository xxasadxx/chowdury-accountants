exports.handler = async function(event, context) {
  const token = process.env.GOCARDLESS_TOKEN;
  if (!token) return { statusCode: 500, body: JSON.stringify({ error: 'Token not set' }) };

  try {
    let all = [], cursor = null, hasMore = true;
    while (hasMore) {
      const url = new URL('https://api.gocardless.com/payments');
      url.searchParams.set('limit', '500');
      if (cursor) url.searchParams.set('after', cursor);
      const res = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${token}`, 'GoCardless-Version': '2015-07-06' }
      });
      const data = await res.json();
      const pays = data.payments || [];
      all = all.concat(pays);
      cursor = data.meta?.cursors?.after;
      hasMore = !!(cursor && pays.length === 500);
    }

    const monthly = {};
    all.forEach(p => {
      const d = new Date(p.charge_date || p.created_at);
      const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
      if (!monthly[key]) monthly[key] = { total: 0, count: 0 };
      monthly[key].total += p.amount;
      monthly[key].count++;
    });

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ total: all.length, monthly })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
