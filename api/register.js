const { createClient } = require('@supabase/supabase-js');

// Vercel Serverless Function: GET /api/register?name=名前&comment=コメント&vrcid=ID&book_id=手帳UUID
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

  const { name, comment = '', vrcid = '', book_id } = req.query;

  if (!name) {
    return res.status(400).send('Parameter "name" is required.');
  }
  if (!book_id) {
    return res.status(400).send('Parameter "book_id" is required.');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const today = new Date().toISOString().split('T')[0];
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

    if (targetGuest) {
      // 既存顧客: 来店数は増やさず、コメントのみを追加
      visitCount = targetGuest.visit_count || 1;
      const notes = targetGuest.notes || [];
      
      if (comment) {
        notes.push({
          id: 'note-' + Date.now(),
          date: today,
          content: `ゲストブックより: "${comment}"`
        });
      }

      const { error: updateError } = await supabase
        .from('guests')
        .update({
          notes: notes
        })
        .eq('id', targetGuest.id);

      if (updateError) throw updateError;
    } else {
      // 新規顧客
      const notes = comment ? [{
        id: 'note-' + Date.now(),
        date: today,
        content: `ゲストブックより新規登録: "${comment}"`
      }] : [];

      const newGuest = {
        id: 'guest-' + Date.now(),
        book_id: book_id, // 手帳IDを紐づける
        name: name,
        pronunciation: '',
        vrc_name: vrcid || name,
        x_id: '',
        discord_id: '',
        first_visit: new Date().toISOString(),
        last_visit: new Date().toISOString(),
        visit_count: 1,
        tags: ['新規'],
        characteristics: comment ? `記名時のコメント: ${comment}` : '特記事項なし',
        notes: notes
      };

      const { error: insertError } = await supabase
        .from('guests')
        .insert(newGuest);

      if (insertError) throw insertError;
      targetGuest = newGuest;
    }

    // 2. リアルタイムイベントログに書き込み (ダッシュボード用、組織ID org_id を付与)
    const { error: eventError } = await supabase
      .from('realtime_events')
      .insert({
        org_id: orgId, // 組織IDを記録
        type: 'guestbook-register',
        player_name: name,
        comment: comment,
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

    const udonFormat = updatedGuests.map(g => {
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
