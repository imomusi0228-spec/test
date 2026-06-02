const { createClient } = require('@supabase/supabase-js');

// Vercel Serverless Function: GET /api/udon/guests?book_id=手帳UUID
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).send('Database environment variables are not configured.');
  }

  const { book_id } = req.query;
  if (!book_id) {
    return res.status(400).send('Parameter "book_id" is required.');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { data: guests, error } = await supabase
      .from('guests')
      .select('*')
      .eq('book_id', book_id);

    if (error) throw error;

    // ソート (最終来店日が新しい順)
    guests.sort((a, b) => {
      const timeA = a.last_visit || '';
      const timeB = b.last_visit || '';
      return timeB.localeCompare(timeA);
    });

    const today = new Date().toISOString().split('T')[0];

    // Udon用の文字列フォーマット (名前|日付|コメント|来店数;)
    const udonFormat = guests.map(g => {
      const gName = g.name || 'Unknown';
      const gDate = g.last_visit ? g.last_visit.split('T')[0].replace(/-/g, '/') : today.replace(/-/g, '/');
      let gComment = 'なし';
      if (g.notes && g.notes.length > 0) {
        const sortedNotes = [...g.notes].sort((a, b) => b.date.localeCompare(a.date));
        gComment = sortedNotes[0].content.replace(/[|\n\r;]/g, ' ');
      } else if (g.characteristics) {
        gComment = g.characteristics.replace(/[|\n\r;]/g, ' ');
      }
      const gVisits = g.visit_count || 1;
      return `${gName}|${gDate}|${gComment}|${gVisits}`;
    }).join(';') + ';';

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(udonFormat);

  } catch (err) {
    console.error(err);
    res.status(500).send(`Server API Error: ${err.message}`);
  }
};
