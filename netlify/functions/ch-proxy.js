exports.handler = async (event) => {
  const comp_no = event.queryStringParameters?.comp_no;
  if (!comp_no) return { statusCode: 400, body: 'Missing comp_no' };

  try {
    const res = await fetch(
      `https://api.company-information.service.gov.uk/company/${comp_no}`,
      {
        headers: {
          'Authorization': 'Basic ' + Buffer.from('4ec759f4-152c-4680-9f8e-7ab1312aea1a:').toString('base64')
        }
      }
    );
    const data = await res.text();
    return {
      statusCode: res.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: data
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
