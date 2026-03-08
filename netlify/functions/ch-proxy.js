const https = require('https');

exports.handler = async (event) => {
  const comp_no = event.queryStringParameters?.comp_no;
  if (!comp_no) return { statusCode: 400, body: 'Missing comp_no' };

  const auth = Buffer.from('4ec759f4-152c-4680-9f8e-7ab1312aea1a:').toString('base64');

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.company-information.service.gov.uk',
      path: '/company/' + encodeURIComponent(comp_no),
      headers: { 'Authorization': 'Basic ' + auth }
    };

    const req = https.get(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body
      }));
    });

    req.on('error', (e) => resolve({
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message })
    }));

    req.end();
  });
};
