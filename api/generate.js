export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, intent, lang, tone } = req.body;

  if (!email && !intent) {
    return res.status(400).json({ error: 'Please provide an email or your intent.' });
  }

  const prompt = `You are a professional email writer. Write a ${tone} email reply in ${lang}.

${email ? `Original email received:\n"""\n${email}\n"""` : ''}

${intent ? `What the user wants to say:\n${intent}` : ''}

Write ONLY the email body — no explanation, no subject line prefix, just the reply ready to copy and send. Make it natural, ${tone.toLowerCase()}, and appropriate.`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.ANTHROPIC_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: data?.error?.message || 'AI error' });
    }

    const text = data?.choices?.[0]?.message?.content || '';
    if (!text) throw new Error('Empty response from AI.');

    return res.status(200).json({ reply: text });

  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
