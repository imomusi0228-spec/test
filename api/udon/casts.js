const { createClient } = require('@supabase/supabase-js');

// Vercel Serverless Function: GET /api/udon/casts?book_id=手帳UUID
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
    const { data: casts, error } = await supabase
      .from('guests')
      .select('name')
      .eq('book_id', book_id)
      .eq('is_cast', true)
      .eq('is_active_today', true);

    if (error) throw error;

    if (!casts || casts.length === 0) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('none');
    }

    // キャスト名をパイプ記号で連結する (例: キャストA|キャストB|キャストC)
    const castNames = casts.map(c => c.name || 'Unknown').join('|');

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(castNames);

  } catch (err) {
    console.error(err);
    res.status(500).send(`Server API Error: ${err.message}`);
  }
};
