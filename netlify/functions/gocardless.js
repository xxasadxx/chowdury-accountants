exports.handler = async function(event, context) {
  const token = process.env.GOCARDLESS_TOKEN;
  
  if (!token) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'GoCardless token not configured' })
    };
  }

  try {
    const response = await fetch('https://api.gocardless.com/payments?status=confirmed', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'GoCardless-Version': '2015-07-06',
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
