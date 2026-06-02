const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// Vercel Serverless Function: GET /api/config
module.exports = async (req, res) => {
  // CORSヘッダー
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        error: 'Database environment variables are not configured on Vercel.'
      });
    }

    res.status(200).json({
      supabaseUrl: supabaseUrl,
      supabaseKey: supabaseKey
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
