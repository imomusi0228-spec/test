const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const DB_FILE = path.join(__dirname, 'guests.json');

// 静的ファイルのMIMEタイプ
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

// SSEクライアントリスト
let sseClients = [];

// === データベースヘルパー (guests.json) ===
function readDatabase() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return [];
    }
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data || '[]');
  } catch (e) {
    console.error('[DB] データベースの読み込みに失敗しました:', e);
    return [];
  }
}

function writeDatabase(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('[DB] データベースの書き込みに失敗しました:', e);
    return false;
  }
}

// 今日の日付文字列 (YYYY-MM-DD)
function getTodayDateString() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Udon用のプレーンテキスト名簿データを生成する
// フォーマット: 名前|日時|一言コメント|来店数;名前|...
function generateUdonGuestList(guests) {
  // 最終来店日が新しい順にソート
  const sorted = [...guests].sort((a, b) => {
    const timeA = a.lastVisit || '';
    const timeB = b.lastVisit || '';
    return timeB.localeCompare(timeA);
  });

  return sorted.map(g => {
    const name = g.name || 'Unknown';
    const date = g.lastVisit ? g.lastVisit.split('T')[0].replace(/-/g, '/') : getTodayDateString().replace(/-/g, '/');
    
    // 最新のメモか特徴を一言として抽出
    let comment = 'なし';
    if (g.notes && g.notes.length > 0) {
      const latestNote = [...g.notes].sort((a, b) => b.date.localeCompare(a.date))[0];
      comment = latestNote.content.replace(/[|\n\r;]/g, ' '); // 特殊文字をエスケープ
    } else if (g.characteristics) {
      comment = g.characteristics.replace(/[|\n\r;]/g, ' ');
    }
    
    const visits = g.visitCount || 1;
    
    return `${name}|${date}|${comment}|${visits}`;
  }).join(';') + ';';
}

function broadcastEvent(dataObj) {
  const jsonStr = JSON.stringify(dataObj);
  sseClients.forEach(client => {
    client.write(`data: ${jsonStr}\n\n`);
  });
}

// === メインサーバー・APIルーティング ===
const server = http.createServer((req, res) => {
  // CORS設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // URLとクエリの解析
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // 1. SSEエンドポイント (ダッシュボードへの通知送信用)
  if (pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('data: {"type":"connected"}\n\n');
    sseClients.push(res);
    req.on('close', () => {
      sseClients = sseClients.filter(c => c !== res);
    });
    return;
  }

  // 2. Webダッシュボード用API: 全顧客取得
  if (pathname === '/api/guests' && req.method === 'GET') {
    const guests = readDatabase();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(guests));
    return;
  }

  // 3. Webダッシュボード用API: 顧客一括保存
  if (pathname === '/api/guests' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (Array.isArray(data)) {
          writeDatabase(data);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(400);
          res.end('Invalid data format');
        }
      } catch (e) {
        res.writeHead(500);
        res.end('Server JSON Parse Error');
      }
    });
    return;
  }

  // 4. VRChat Udon用API: 入室自動カウントアップ
  // GET /api/join?name=名前
  if (pathname === '/api/join' && req.method === 'GET') {
    const name = parsedUrl.searchParams.get('name');

    if (!name) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Parameter "name" is required.');
      return;
    }

    const guests = readDatabase();
    const nameLower = name.toLowerCase();
    const now = new Date();
    const nowIso = now.toISOString();
    
    let targetGuest = guests.find(g => 
      (g.name && g.name.toLowerCase() === nameLower) ||
      (g.vrcName && g.vrcName.toLowerCase() === nameLower)
    );

    let visitCount = 1;
    let isNewVisit = true;

    if (targetGuest) {
      // 12時間重複防止判定
      const lastVisitTime = targetGuest.lastVisit ? new Date(targetGuest.lastVisit).getTime() : 0;
      const hoursPassed = (now.getTime() - lastVisitTime) / (1000 * 60 * 60);

      visitCount = targetGuest.visitCount || 1;

      if (hoursPassed >= 12) {
        // 12時間以上経過しているので新規来店
        visitCount += 1;
        targetGuest.visitCount = visitCount;
        targetGuest.lastVisit = nowIso;
        console.log(`[Join] 既存客「${targetGuest.name}」が来店しました。(通算: ${visitCount}回目)`);
      } else {
        // 12時間未満: 再接続
        isNewVisit = false;
        targetGuest.lastVisit = nowIso;
        console.log(`[Join] 既存客「${targetGuest.name}」が再接続しました。(通算: ${visitCount}回目)`);
      }
    } else {
      // 新規登録
      targetGuest = {
        id: 'guest-' + Date.now(),
        name: name,
        pronunciation: '',
        vrcName: name,
        xId: '',
        discordId: '',
        firstVisit: nowIso,
        lastVisit: nowIso,
        visitCount: 1,
        tags: ['新規'],
        characteristics: '自動登録（新規入室）',
        notes: []
      };
      guests.push(targetGuest);
      console.log(`[Join] 新規客「${name}」を自動登録しました。`);
    }

    writeDatabase(guests);

    // Webダッシュボードへリアルタイム通知 (SSE経由)
    broadcastEvent({
      type: isNewVisit ? 'player-join' : 'player-reconnect',
      playerName: name,
      guest: targetGuest,
      visitCount: visitCount,
      timestamp: nowIso
    });

    // Udon用の最新名簿データをプレーンテキストで返す
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(generateUdonGuestList(guests));
    return;
  }

  // 5. VRChat Udon用API: コメント手動記名登録
  // GET /api/register?name=名前&comment=コメント&vrcid=ID
  if (pathname === '/api/register' && req.method === 'GET') {
    const name = parsedUrl.searchParams.get('name');
    const comment = parsedUrl.searchParams.get('comment') || '';
    const vrcid = parsedUrl.searchParams.get('vrcid') || '';

    if (!name) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Parameter "name" is required.');
      return;
    }

    const guests = readDatabase();
    const nameLower = name.toLowerCase();
    const today = getTodayDateString();
    
    let targetGuest = guests.find(g => 
      (g.name && g.name.toLowerCase() === nameLower) ||
      (g.vrcName && g.vrcName.toLowerCase() === nameLower)
    );

    let visitCount = 1;

    if (targetGuest) {
      // コメントのみ追加（来店回数は増やさない）
      visitCount = targetGuest.visitCount || 1;
      if (comment) {
        if (!targetGuest.notes) targetGuest.notes = [];
        targetGuest.notes.push({
          id: 'note-' + Date.now(),
          date: today,
          content: `ゲストブックより: "${comment}"`
        });
      }
      console.log(`[Register] 既存客「${targetGuest.name}」のコメントを記録しました。`);
    } else {
      // 念のためフォールバック
      targetGuest = {
        id: 'guest-' + Date.now(),
        name: name,
        pronunciation: '',
        vrcName: vrcid || name,
        xId: '',
        discordId: '',
        firstVisit: new Date().toISOString(),
        lastVisit: new Date().toISOString(),
        visitCount: 1,
        tags: ['新規'],
        characteristics: comment ? `記名時のコメント: ${comment}` : '特記事項なし',
        notes: comment ? [{
          id: 'note-' + Date.now(),
          date: today,
          content: `ゲストブックより新規登録: "${comment}"`
        }] : []
      };
      guests.push(targetGuest);
      console.log(`[Register] 新規客「${name}」を登録しました。`);
    }

    writeDatabase(guests);

    // Webダッシュボード側へコメント記名通知を送信
    broadcastEvent({
      type: 'guestbook-register',
      guest: targetGuest,
      playerName: name,
      comment: comment
    });

    // Udon用の最新名簿データをプレーンテキストで返す
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(generateUdonGuestList(guests));
    return;
  }

  // 6. VRChat Udon用API: 名簿一覧取得 (プレーンテキスト)
  if (pathname === '/api/udon/guests' && req.method === 'GET') {
    const guests = readDatabase();
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(generateUdonGuestList(guests));
    return;
  }

  // 静的ファイル処理 (UI)
  let filePath = pathname === '/' ? './index.html' : '.' + pathname;
  filePath = filePath.split('?')[0];

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'text/plain';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found</h1>');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

// サーバー起動
server.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(` VRC Cast Companion デバッグサーバーが起動しました`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log(` (ローカルデバッグ用。ログファイル監視機能は削除されました)`);
  console.log(`===================================================`);

  if (!fs.existsSync(DB_FILE)) {
    writeDatabase([]);
  }
});

process.on('SIGINT', () => {
  server.close(() => {
    console.log('[Server] デバッグサーバーを終了しました。');
    process.exit(0);
  });
});
