#!/usr/bin/env node
const http = require('http');

async function postTranscription(transcription) {
  const data = JSON.stringify({ transcription });

  const options = {
    hostname: 'localhost',
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
    path: '/',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed);
        } catch (e) {
          resolve({ raw: body });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const transcription = process.argv.slice(2).join(' ') || 'run: echo hello from mock';
  console.log('Posting transcription:', transcription);
  try {
    const resp = await postTranscription(transcription);
    console.log('Response:', JSON.stringify(resp, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('Error:', e);
    process.exit(2);
  }
})();
