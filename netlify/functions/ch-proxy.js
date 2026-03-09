const https = require('https');

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const auth = Buffer.from('4ec759f4-152c-4680-9f8e-7ab1312aea1a:').toString('base64');

  // Support both ?comp_no=... (old sync) and ?path=... (new search)
  let path;
  if (params.path) {
    path = '/' + params.path;
  } else if (params.comp_no) {
    path = '/company/' + encodeURIComponent(params.comp_no);
  } else {
    return { statusCode: 400, headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}, body: JSON.stringify({ error: 'Missing comp_no or path' }) };
  }

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.company-information.service.gov.uk',
      path,
      headers: { 'Authorization': 'Basic ' + auth }
    };

    const req = https.get(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body
      }));
    });

    req.on('error', (e) => resolve({
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message })
    }));

    req.end();
  });
};
