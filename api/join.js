const { createClient } = require('@supabase/supabase-js');

// Vercel Serverless Function: GET /api/join?name=名前&book_id=手帳UUID
module.exports = async (req, res) => {
  // CORSヘッダー
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

  const { name, book_id } = req.query;

  if (!name) {
    return res.status(400).send('Parameter "name" is required.');
  }
  if (!book_id) {
    return res.status(400).send('Parameter "book_id" is required.');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const now = new Date();
    const nowIso = now.toISOString();
    const nameLower = name.toLowerCase();

    // 0. 手帳に紐づく組織ID (org_id) を取得
    const { data: book, error: bookError } = await supabase
      .from('books')
      .select('org_id')
      .eq('id', book_id)
      .single();

    if (bookError || !book) {
      return res.status(404).send('Specfied book not found.');
    }
    const orgId = book.org_id;

    // 1. 指定手帳の既存顧客をチェック
    const { data: existingGuests, error: selectError } = await supabase
      .from('guests')
      .select('*')
      .eq('book_id', book_id);

    if (selectError) throw selectError;

    let targetGuest = existingGuests.find(g => 
      (g.name && g.name.toLowerCase() === nameLower) ||
      (g.vrc_name && g.vrc_name.toLowerCase() === nameLower)
    );

    let visitCount = 1;
    let isNewVisit = true;

    if (targetGuest) {
      // 既存顧客: 時間判定 (12時間重複防止)
      const lastVisitTime = targetGuest.last_visit ? new Date(targetGuest.last_visit).getTime() : 0;
      const hoursPassed = (now.getTime() - lastVisitTime) / (1000 * 60 * 60);

      visitCount = targetGuest.visit_count || 1;

      if (hoursPassed >= 12) {
        // 12時間以上経過しているので新規来店とみなし、カウントアップ
        visitCount += 1;
        const { error: updateError } = await supabase
          .from('guests')
          .update({
            visit_count: visitCount,
            last_visit: nowIso
          })
          .eq('id', targetGuest.id);

        if (updateError) throw updateError;
        targetGuest.visit_count = visitCount;
        targetGuest.last_visit = nowIso;
      } else {
        // 12時間未満: 再接続
        isNewVisit = false;
        const { error: updateError } = await supabase
          .from('guests')
          .update({
            last_visit: nowIso
          })
          .eq('id', targetGuest.id);
        if (updateError) throw updateError;
        targetGuest.last_visit = nowIso;
      }
    } else {
      // 新規顧客: レコード作成
      const newGuest = {
        id: 'guest-' + Date.now(),
        book_id: book_id, // 手帳IDを紐づける
        name: name,
        pronunciation: '',
        vrc_name: name,
        x_id: '',
        discord_id: '',
        first_visit: nowIso,
        last_visit: nowIso,
        visit_count: 1,
        tags: ['新規'],
        characteristics: '自動登録（新規入室）',
        notes: []
      };

      const { error: insertError } = await supabase
        .from('guests')
        .insert(newGuest);

      if (insertError) throw insertError;
      targetGuest = newGuest;
    }

    // 2. リアルタイムイベントログに書き込み (ダッシュボード用通知、組織ID org_id を付与)
    const { error: eventError } = await supabase
      .from('realtime_events')
      .insert({
        org_id: orgId, // 組織IDを記録
        type: isNewVisit ? 'player-join' : 'player-reconnect',
        player_name: name,
        comment: isNewVisit ? `自動来店カウントアップ (通算 ${visitCount} 回目)` : `再接続 (通算 ${visitCount} 回目)`,
        visit_count: visitCount
      });

    if (eventError) console.error('[Supabase] イベントログ追加失敗:', eventError);

    // 3. 最新の手帳データを取得して、UdonSharp形式で返却
    const { data: updatedGuests, error: selectAllError } = await supabase
      .from('guests')
      .select('*')
      .eq('book_id', book_id);

    if (selectAllError) throw selectAllError;

    // ソート (最終来店日が新しい順)
    updatedGuests.sort((a, b) => {
      const timeA = a.last_visit || '';
      const timeB = b.last_visit || '';
      return timeB.localeCompare(timeA);
    });

    const todayDateStr = now.toISOString().split('T')[0];

    const udonFormat = updatedGuests.map(g => {
      const gName = g.name || 'Unknown';
      const gDate = g.last_visit ? g.last_visit.split('T')[0].replace(/-/g, '/') : todayDateStr.replace(/-/g, '/');
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
