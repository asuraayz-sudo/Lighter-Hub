const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch'); // npm install node-fetch@2

const app = express();

app.use(cors());          // libera todas as origens
app.use(express.json());  // parseia o body JSON

// Rota: POST /proxy
// Body: { url: "https://...", headers: {}, body: {} }
app.post('/proxy', async (req, res) => {
  const { url, headers = {}, body } = req.body;

  if (!url) return res.status(400).json({ error: 'Missing url' });

  try {
    const response = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body:    JSON.stringify(body),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(3001, () => console.log('Proxy running on http://localhost:3001'));