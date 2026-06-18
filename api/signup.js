const { createClient } = require('@supabase/supabase-js');

// Vercel Serverless Function: POST /api/signup
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
  // 管理特権キー(service_role_key)を使用
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

  const { username, password, display_name, vrc_name, role, org_name, org_id } = req.body;

  if (!username || !password || !display_name || !role) {
    return res.status(400).json({ error: 'Required fields are missing.' });
  }

  try {
    // 12文字未満などの簡易検証（Supabase Auth側の最小は6文字）
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const DUMMY_PREFIX = "vrc-companion-";
    const DUMMY_DOMAIN = "@gmail.com";
    const email = DUMMY_PREFIX + username.toLowerCase() + DUMMY_DOMAIN;

    // 1. 特権権限で認証ユーザーを作成 (Email Confirmを自動でtrueに設定し、実質的なメール確認をスキップ)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true, // 自動確認済み
      user_metadata: {
        display_name: display_name,
        vrc_name: vrc_name || '',
        role: role,
        username: username.toLowerCase(),
        recovery_key: recoveryKey
      }
    });

    if (authError) {
      if (authError.message.includes('already registered') || authError.message.includes('already exists')) {
        return res.status(400).json({ error: 'このユーザーIDは既に登録されています。' });
      }
      throw authError;
    }

    const user = authData.user;
    // エラー時にクリーンアップするための作成済みユーザー参照
    var createdUser = user;
    let targetOrgId = org_id;

    // 2. 店舗オーナー登録の場合は組織(organizations)を作成
    if (role === 'master') {
      if (!org_name) {
        return res.status(400).json({ error: '店舗名が必要です。' });
      }

      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .insert({ name: org_name })
        .select()
        .single();

      if (orgError) throw orgError;
      targetOrgId = orgData.id;
    } else {
      if (!targetOrgId) {
        return res.status(400).json({ error: '所属店舗ID（招待コード）が必要です。' });
      }
      
      // キャスト登録の場合：組織が存在するかチェック
      const { data: orgExists, error: checkError } = await supabase
        .from('organizations')
        .select('id')
        .eq('id', targetOrgId)
        .single();

      if (checkError || !orgExists) {
        return res.status(400).json({ error: '指定された店舗ID（招待コード）が無効です。正しい店舗IDを入力してください。' });
      }
    }

    // リカバリーキーの生成
    const recoveryKey = generateRecoveryKey();

    // 3. プロフィール情報(member_profiles)をデータベースにインサート
    const { error: profileError } = await supabase
      .from('member_profiles')
      .insert({
        id: user.id,
        org_id: targetOrgId,
        display_name: display_name,
        vrc_name: vrc_name || '',
        role: role
      });

    if (profileError) {
      throw profileError;
    }

    // 4. 手帳（books）の自動初期作成（店舗オーナー登録時のみ）
    if (role === 'master') {
      const { error: bookError } = await supabase
        .from('books')
        .insert({
          org_id: targetOrgId,
          name: 'メイン手帳'
        });
      if (bookError) console.error('初期手帳の作成に失敗しました:', bookError);
    }

    return res.status(200).json({ success: true, username: username, recovery_key: recoveryKey });

  } catch (err) {
    console.error('[Signup API Error]:', err);
    // 作成済みのAuthユーザーがあれば削除してロールバック
    if (typeof createdUser !== 'undefined' && createdUser && createdUser.id) {
      try {
        await supabase.auth.admin.deleteUser(createdUser.id);
      } catch (cleanupErr) {
        console.error('Failed to cleanup user after error:', cleanupErr);
      }
    }
    return res.status(500).json({ error: 'サーバー内部エラーが発生しました: ' + err.message });
  }
};

// リカバリーキー（復元コード）の生成関数
function generateRecoveryKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'RC-';
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) result += '-';
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

