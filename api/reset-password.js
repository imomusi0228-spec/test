const { createClient } = require('@supabase/supabase-js');

// Vercel Serverless Function: POST /api/reset-password
module.exports = async (req, res) => {
  // CORSヘッダー
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({
      error: 'Server is not configured. "SUPABASE_URL" and "SUPABASE_SERVICE_ROLE_KEY" are required on Vercel environment variables.'
    });
  }

  // 特権権限を持つSupabaseクライアントを作成
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const { username, recovery_key, new_password } = req.body;

  if (!username || !recovery_key || !new_password) {
    return res.status(400).json({ error: 'Required fields are missing.' });
  }

  try {
    // パスワード長の簡易検証
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    // 1. 特権権限でユーザーリストを取得し、該当ユーザーとリカバリーキーを照合
    const cleanUsername = username.trim().toLowerCase();
    const cleanKey = recovery_key.trim().toUpperCase();
    const email = "vrc-companion-" + cleanUsername + "@gmail.com";

    const { data: authData, error: authListError } = await supabase.auth.admin.listUsers({
      perPage: 1000 // ページネーション漏れを防ぐため十分大きな値に設定
    });

    if (authListError || !authData || !authData.users) {
      console.error('Failed to list users:', authListError);
      return res.status(400).json({ error: 'ユーザーIDまたはリカバリーキーが正しくありません。' });
    }

    const targetUser = authData.users.find(u => u.email && u.email.toLowerCase() === email);

    if (!targetUser) {
      return res.status(400).json({ error: 'ユーザーIDまたはリカバリーキーが正しくありません。' });
    }

    const metadata = targetUser.user_metadata || {};
    const storedKey = metadata.recovery_key || '';

    if (!storedKey || storedKey.trim().toUpperCase() !== cleanKey) {
      return res.status(400).json({ error: 'ユーザーIDまたはリカバリーキーが正しくありません。' });
    }

    // 2. 特権権限でユーザーのログイン用パスワードを更新
    const { error: authUpdateError } = await supabase.auth.admin.updateUserById(
      targetUser.id,
      { password: new_password }
    );

    if (authUpdateError) {
      throw authUpdateError;
    }

    return res.status(200).json({ success: true, message: 'パスワードが正常に更新されましたわ。' });

  } catch (err) {
    console.error('[Reset Password API Error]:', err);
    return res.status(500).json({ error: 'サーバー内部エラーが発生しました: ' + err.message });
  }
};
