// === アプリケーション状態管理 ===
let guests = [];
let selectedGuestId = null;
let currentTab = '全て';
let searchQuery = '';
let dbClient = null;

// しきい値設定（デフォルト値）
let semiRegularThreshold = 3;
let regularThreshold = 5;
let vipThreshold = 10;

function loadThresholds() {
  semiRegularThreshold = parseInt(localStorage.getItem('threshold_semi_regular') || '3', 10);
  regularThreshold = parseInt(localStorage.getItem('threshold_regular') || '5', 10);
  vipThreshold = parseInt(localStorage.getItem('threshold_vip') || '10', 10);
}

// === 定数 ===
const STORAGE_KEY = 'vrc_cast_companion_guests';
const INDEX_TABS = ['全て', 'キャスト', 'あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ', 'A-Z', '他'];

// === サンプルデモデータ ===
const DEMO_GUEST_DATA = [
  {
    id: "demo-1",
    name: "ひな",
    pronunciation: "ひな",
    vrcName: "Hina_VRC",
    xId: "@hina_vrc_cafe",
    discordId: "hina#9999",
    firstVisit: "2026-03-01",
    lastVisit: "2026-06-01",
    tags: ["常連", "VIP", "甘党"],
    characteristics: "白猫耳のロリータ系アバター。メロンソーダをいつも注文する。おしゃべり好きで、カフェ系ワールドによくいる。",
    notes: [
      { id: "note-1-1", date: "2026-06-01", content: "お嬢のキャスト3周年をお祝いしに来てくれた！シャンパンをあけてくれた。" },
      { id: "note-1-2", date: "2026-05-15", content: "最近新しいアバターの改変にハマっているらしく、衣装の色変えについて相談された。" },
      { id: "note-1-3", date: "2026-04-10", content: "初めての来店。最初は緊張していたようだが、共通の趣味（ゲーム）の話で盛り上がった。" }
    ]
  },
  {
    id: "demo-2",
    name: "クロウ",
    pronunciation: "くろう",
    vrcName: "Crow_Black",
    xId: "@crow_vrc_dj",
    discordId: "crow_dj",
    firstVisit: "2026-04-05",
    lastVisit: "2026-05-28",
    tags: ["準常連", "DJ", "お酒好き"],
    characteristics: "黒髪のスタイリッシュなイケメンアバター。クラブ系ワールドのDJをやっている。ハイボールが好き。",
    notes: [
      { id: "note-2-1", date: "2026-05-28", content: "DJイベントの告知をしてくれた。来週の土曜日にイベントを回すらしい。お嬢も誘われた。" },
      { id: "note-2-2", date: "2026-04-20", content: "音楽の好みについて雑談。クラブミュージック（特にTech House）に詳しい。" }
    ]
  },
  {
    id: "demo-3",
    name: "Alice",
    pronunciation: "ありす",
    vrcName: "Alice_In_VRC",
    xId: "@alice_wonder",
    discordId: "alice_vrc",
    firstVisit: "2026-05-10",
    lastVisit: "2026-05-10",
    tags: ["新規", "英語OK"],
    characteristics: "金髪アリスアバター。海外プレイヤー。日本語は日常会話レベルなら通じる。抹茶のお菓子が好き。",
    notes: [
      { id: "note-3-1", date: "2026-05-10", content: "新規で来店。フレンドの紹介で来てくれた。アバターのギミックがとても綺麗で、見せてもらった。" }
    ]
  }
];

// === 起動時の初期化処理 ===
document.addEventListener('DOMContentLoaded', async () => {
  loadThresholds();
  setupIndexTabs();
  setupEventListeners();
  setupDbWizard();
});

// === データ保存・読み込み ===
async function loadData() {
  if (dbClient) {
    try {
      const { data, error } = await dbClient.from('guests').select('*');
      if (error) throw error;
      
      guests = data.map(dbGuest => ({
        id: dbGuest.id,
        name: dbGuest.name,
        pronunciation: dbGuest.pronunciation || '',
        vrcName: dbGuest.vrc_name || '',
        xId: dbGuest.x_id || '',
        discordId: dbGuest.discord_id || '',
        firstVisit: dbGuest.first_visit || '',
        lastVisit: dbGuest.last_visit || '',
        visitCount: dbGuest.visit_count || 1,
        isCast: dbGuest.is_cast || false,
        isActiveToday: dbGuest.is_active_today || false,
        tags: dbGuest.tags || [],
        characteristics: dbGuest.characteristics || '',
        notes: dbGuest.notes || []
      }));
      
      // 初回起動時かつデータが空の場合、デモデータを投入
      if (guests.length === 0) {
        guests = [...DEMO_GUEST_DATA];
        for (const demoGuest of guests) {
          await saveGuest(demoGuest);
        }
      }
      return;
    } catch (e) {
      console.error("[Supabase] データの取得に失敗しました。ローカルストレージを使用します。", e);
    }
  }

  // サーバーからの読み込み (ローカルデバッグ環境用フォールバック)
  try {
    const response = await fetch('/api/guests');
    if (response.ok) {
      guests = await response.json();
      guests.forEach(g => {
        if (!g.notes) g.notes = [];
        if (!g.tags) g.tags = [];
        if (g.visitCount === undefined) g.visitCount = 1;
        if (g.isCast === undefined) g.isCast = false;
        if (g.isActiveToday === undefined) g.isActiveToday = false;
      });
    } else {
      throw new Error('Server response not OK');
    }
  } catch (e) {
    console.warn("[Storage] サーバーからのデータ取得に失敗しました。ローカルストレージを使用します。", e);
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      try {
        guests = JSON.parse(data);
        guests.forEach(g => {
          if (!g.notes) g.notes = [];
          if (!g.tags) g.tags = [];
          if (g.visitCount === undefined) g.visitCount = 1;
          if (g.isCast === undefined) g.isCast = false;
          if (g.isActiveToday === undefined) g.isActiveToday = false;
        });
      } catch (err) {
        guests = [];
      }
    } else {
      guests = [];
    }
  }

  // 初回起動時かつデータが空の場合、デモデータを投入
  if (guests.length === 0) {
    guests = [...DEMO_GUEST_DATA];
    await saveData();
  }
}

async function saveData() {
  updateTotalCount();
  
  // ローカルフォールバック保存
  localStorage.setItem(STORAGE_KEY, JSON.stringify(guests));

  // サーバーに送信 (ローカルデバッグ用)
  try {
    const response = await fetch('/api/guests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(guests)
    });
    if (!response.ok) throw new Error('Server POST failed');
  } catch (e) {
    // デバッグサーバーが動いていない場合は無視
  }
}

async function saveGuest(guest) {
  // グローバル配列内のデータを更新
  const index = guests.findIndex(g => g.id === guest.id);
  if (index !== -1) {
    guests[index] = guest;
  } else {
    guests.push(guest);
  }

  updateTotalCount();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(guests));

  // デバッグサーバー（互換用）
  try {
    await fetch('/api/guests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(guests)
    });
  } catch (e) {}

  // Supabaseに直接保存
  if (dbClient) {
    try {
      const dbGuest = {
        id: guest.id,
        name: guest.name,
        pronunciation: guest.pronunciation || '',
        vrc_name: guest.vrcName || '',
        x_id: guest.xId || '',
        discord_id: guest.discordId || '',
        first_visit: guest.firstVisit || null,
        last_visit: guest.lastVisit || null,
        visit_count: guest.visitCount || 1,
        is_cast: guest.isCast || false,
        is_active_today: guest.isActiveToday || false,
        tags: guest.tags || [],
        characteristics: guest.characteristics || '',
        notes: guest.notes || []
      };
      
      const { error } = await dbClient
        .from('guests')
        .upsert(dbGuest);
      if (error) throw error;
    } catch (e) {
      console.error("[Supabase] データの保存に失敗しました:", e);
    }
  }
}


// === インデックスタブの生成と判定 ===
function setupIndexTabs() {
  const container = document.getElementById('book-tabs');
  container.innerHTML = '';
  
  INDEX_TABS.forEach(tabName => {
    const tab = document.createElement('div');
    tab.className = `index-tab ${tabName === currentTab ? 'active' : ''}`;
    tab.textContent = tabName;
    tab.dataset.tab = tabName;
    tab.addEventListener('click', () => {
      document.querySelectorAll('.index-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tabName;
      renderGuestList();
    });
    container.appendChild(tab);
  });
}

// 日本語のインデックス判定
function getIndexGroup(pronunciation, name) {
  const text = (pronunciation || name || "").trim();
  if (!text) return "他";
  
  const firstChar = text.charAt(0);
  
  // カタカナをひらがなに変換する簡易テーブル
  const hiraChar = katakanaToHiragana(firstChar);
  
  const isBetween = (char, start, end) => char >= start && char <= end;
  
  if (isBetween(hiraChar, 'ぁ', 'お')) return 'あ';
  if (isBetween(hiraChar, 'か', 'ご')) return 'か';
  if (isBetween(hiraChar, 'さ', 'ぞ')) return 'さ';
  if (isBetween(hiraChar, 'た', 'ど')) return 'た';
  if (isBetween(hiraChar, 'な', 'の')) return 'な';
  if (isBetween(hiraChar, 'は', 'ぽ')) return 'は';
  if (isBetween(hiraChar, 'ま', 'も')) return 'ま';
  if (isBetween(hiraChar, 'や', 'よ')) return 'や';
  if (isBetween(hiraChar, 'ら', 'ろ')) return 'ら';
  if (isBetween(hiraChar, 'わ', 'ん') || hiraChar === 'を') return 'わ';
  
  // アルファベット
  if (/^[A-Za-z]/.test(firstChar)) return 'A-Z';
  
  return '他';
}

function katakanaToHiragana(src) {
  return src.replace(/[\u30a1-\u30f6]/g, function(match) {
    var chr = match.charCodeAt(0) - 0x60;
    return String.fromCharCode(chr);
  });
}

// === リストのレンダリング ===
function renderGuestList() {
  const listContainer = document.getElementById('guest-list');
  const noResults = document.getElementById('no-results');
  listContainer.innerHTML = '';
  
  // フィルタリング処理
  let filtered = guests.filter(guest => {
    // 検索クエリでのフィルター
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const nameMatch = guest.name.toLowerCase().includes(query);
      const pronMatch = (guest.pronunciation || "").toLowerCase().includes(query);
      const vrcMatch = (guest.vrcName || "").toLowerCase().includes(query);
      const charMatch = (guest.characteristics || "").toLowerCase().includes(query);
      const tagMatch = guest.tags.some(tag => tag.toLowerCase().includes(query));
      
      if (!nameMatch && !pronMatch && !vrcMatch && !charMatch && !tagMatch) {
        return false;
      }
    }
    
    // インデックスタブでのフィルター
    if (currentTab !== '全て') {
      if (currentTab === 'キャスト') {
        if (!guest.isCast) {
          return false;
        }
      } else {
        const group = getIndexGroup(guest.pronunciation, guest.name);
        if (group !== currentTab) {
          return false;
        }
      }
    }
    
    return true;
  });
  
  // 名前順（ひらがな優先）でソート
  filtered.sort((a, b) => {
    const keyA = a.pronunciation || a.name;
    const keyB = b.pronunciation || b.name;
    return keyA.localeCompare(keyB, 'ja');
  });

  if (filtered.length === 0) {
    noResults.style.display = 'block';
  } else {
    noResults.style.display = 'none';
  }
  
  filtered.forEach(guest => {
    const card = document.createElement('div');
    card.className = `guest-card ${guest.id === selectedGuestId ? 'active' : ''}`;
    card.dataset.id = guest.id;
    
    const initial = guest.name ? guest.name.charAt(0).toUpperCase() : 'G';
    const lastVisitText = guest.lastVisit ? guest.lastVisit.replace(/-/g, '/') : '未設定';
    
    // 自動バッジ算出（VIP, 常連, 準常連）
    let autoBadge = null;
    const visits = guest.visitCount || 1;
    if (visits >= vipThreshold) {
      autoBadge = '👑 VIP';
    } else if (visits >= regularThreshold) {
      autoBadge = '常連';
    } else if (visits >= semiRegularThreshold) {
      autoBadge = '準常連';
    }

    // 元のタグから重複を排除して、しきい値タグを除外
    let cleanTags = (guest.tags || []).filter(t => 
      t !== 'VIP' && t !== '👑 VIP' && t !== '常連' && t !== '準常連'
    );

    // 自動バッジがあれば先頭に追加
    if (autoBadge) {
      cleanTags.unshift(autoBadge);
    }

    // タグのHTML生成
    const tagsHTML = cleanTags.slice(0, 3).map(tag => {
      let extraClass = '';
      if (tag === 'VIP' || tag === '👑 VIP') extraClass = 'tag-vip';
      else if (tag === '常連') extraClass = 'tag-regular';
      else if (tag === '準常連') extraClass = 'tag-semi-regular';
      return `<span class="mini-tag ${extraClass}">${escapeHTML(tag)}</span>`;
    }).join('');
    
    // キャストの場合、お名前の前に 🌟 マークを表示
    const displayName = guest.isCast ? `🌟 ${guest.name}` : guest.name;

    card.innerHTML = `
      <div class="guest-card-avatar">${escapeHTML(initial)}</div>
      <div class="guest-card-info">
        <div class="guest-card-name-row">
          <span class="guest-card-name">${escapeHTML(displayName)}</span>
          <span class="guest-card-last-visit">${escapeHTML(lastVisitText)}</span>
        </div>
        <div class="guest-card-tags">
          ${tagsHTML}
        </div>
      </div>
    `;
    
    card.addEventListener('click', () => selectGuest(guest.id));
    listContainer.appendChild(card);
  });
}

// === 顧客の選択と詳細表示 ===
function selectGuest(id) {
  selectedGuestId = id;
  
  // アクティブカードの表示切り替え
  document.querySelectorAll('.guest-card').forEach(card => {
    if (card.dataset.id === id) {
      card.classList.add('active');
    } else {
      card.classList.remove('active');
    }
  });
  
  const guest = guests.find(g => g.id === id);
  if (!guest) return;
  
  // UIの要素を更新
  document.getElementById('no-selection-placeholder').style.display = 'none';
  document.getElementById('detail-content').style.display = 'block';
  
  document.getElementById('detail-name').textContent = guest.isCast ? `🌟 ${guest.name}` : guest.name;
  document.getElementById('detail-pronunciation').textContent = guest.pronunciation ? `（${guest.pronunciation}）` : '';
  document.getElementById('detail-vrc-name').textContent = guest.vrcName ? `@${guest.vrcName}` : '@未登録';
  
  const initial = guest.name ? guest.name.charAt(0).toUpperCase() : 'G';
  document.getElementById('detail-avatar').textContent = initial;
  
  // キャストステータストグル表示
  const castStatusRow = document.getElementById('detail-cast-status-row');
  const activeTodayCheckbox = document.getElementById('detail-is-active-today');
  if (castStatusRow && activeTodayCheckbox) {
    if (guest.isCast) {
      castStatusRow.style.display = 'flex';
      activeTodayCheckbox.checked = guest.isActiveToday || false;
      
      activeTodayCheckbox.onclick = async (e) => {
        guest.isActiveToday = e.target.checked;
        await saveGuest(guest);
        renderGuestList();
        showToast(guest.isActiveToday ? `${guest.name} の本日出勤をオンにしたよ` : `${guest.name} の本日出勤をオフにしたよ`);
      };
    } else {
      castStatusRow.style.display = 'none';
    }
  }

  // SNS/連絡先
  document.getElementById('detail-x-id').textContent = guest.xId || '未登録';
  document.getElementById('detail-discord-id').textContent = guest.discordId || '未登録';
  
  // 来店日
  document.getElementById('detail-first-visit').textContent = guest.firstVisit ? guest.firstVisit.replace(/-/g, '/') : '未登録';
  document.getElementById('detail-last-visit').textContent = guest.lastVisit ? guest.lastVisit.replace(/-/g, '/') : '未登録';
  document.getElementById('detail-visit-count').textContent = `${guest.visitCount || 1}回`;
  
  // 特徴
  document.getElementById('detail-characteristics').textContent = guest.characteristics || '特徴・好みの情報はまだ登録されていません。';
  
  // タグ
  const tagsContainer = document.getElementById('detail-tags');
  tagsContainer.innerHTML = '';
  
  // 自動バッジ算出（VIP, 常連, 準常連）
  let autoBadge = null;
  const visits = guest.visitCount || 1;
  if (visits >= vipThreshold) {
    autoBadge = '👑 VIP';
  } else if (visits >= regularThreshold) {
    autoBadge = '常連';
  } else if (visits >= semiRegularThreshold) {
    autoBadge = '準常連';
  }

  // 重複排除とフィルタリング
  let displayTags = (guest.tags || []).filter(t => 
    t !== 'VIP' && t !== '👑 VIP' && t !== '常連' && t !== '準常連'
  );
  if (autoBadge) {
    displayTags.unshift(autoBadge);
  }

  if (displayTags.length > 0) {
    displayTags.forEach(tag => {
      const span = document.createElement('span');
      let extraClass = '';
      if (tag === 'VIP' || tag === '👑 VIP') extraClass = 'tag-vip';
      else if (tag === '常連') extraClass = 'tag-regular';
      else if (tag === '準常連') extraClass = 'tag-semi-regular';
      span.className = `tag ${extraClass}`;
      span.textContent = tag;
      tagsContainer.appendChild(span);
    });
  } else {
    tagsContainer.innerHTML = '<span style="font-size: 11px; color: var(--text-muted);">タグなし</span>';
  }
  
  // タイムライン
  renderTimeline(guest.notes);
}

function renderTimeline(notes) {
  const timeline = document.getElementById('notes-timeline');
  timeline.innerHTML = '';
  
  if (!notes || notes.length === 0) {
    timeline.innerHTML = '<p style="font-size: 12px; color: var(--text-muted); padding: 10px 0;">まだ会話履歴はありません。</p>';
    return;
  }
  
  // 日付の降順（新しい順）で並び替え
  const sortedNotes = [...notes].sort((a, b) => b.date.localeCompare(a.date));
  
  sortedNotes.forEach(note => {
    const item = document.createElement('div');
    item.className = 'timeline-item';
    
    const dateText = note.date ? note.date.replace(/-/g, '/') : '日付不明';
    
    item.innerHTML = `
      <div class="timeline-card">
        <div class="timeline-header">
          <span class="timeline-date">${escapeHTML(dateText)}</span>
          <button class="delete-note-btn" data-note-id="${note.id}">削除</button>
        </div>
        <div class="timeline-content">${escapeHTML(note.content)}</div>
      </div>
    `;
    
    // メモ削除イベント
    item.querySelector('.delete-note-btn').addEventListener('click', (e) => {
      const noteId = e.target.dataset.noteId;
      if (confirm('このメモを削除してもいいかい？')) {
        deleteNote(noteId);
      }
    });
    
    timeline.appendChild(item);
  });
}

// === メモの追加・削除 ===
function addNote() {
  if (!selectedGuestId) return;
  const input = document.getElementById('new-note-input');
  const dateInput = document.getElementById('new-note-date');
  
  const content = input.value.trim();
  const date = dateInput.value || getTodayDateString();
  
  if (!content) {
    showToast("メモの内容を入力しておくれ");
    return;
  }
  
  const guestIndex = guests.findIndex(g => g.id === selectedGuestId);
  if (guestIndex === -1) return;
  
  const newNote = {
    id: 'note-' + Date.now(),
    date: date,
    content: content
  };
  
  if (!guests[guestIndex].notes) {
    guests[guestIndex].notes = [];
  }
  
  guests[guestIndex].notes.push(newNote);
  
  // ついでに最終来店日もこのメモの日付にアップデートする（メモの日付の方が新しい場合のみ、または未設定の場合）
  if (!guests[guestIndex].lastVisit || date > guests[guestIndex].lastVisit) {
    guests[guestIndex].lastVisit = date;
  }
  
  saveGuest(guests[guestIndex]);
  input.value = '';
  
  // 表示の更新
  selectGuest(selectedGuestId);
  renderGuestList();
  showToast("メモを追加したよ");
}

function deleteNote(noteId) {
  if (!selectedGuestId) return;
  
  const guestIndex = guests.findIndex(g => g.id === selectedGuestId);
  if (guestIndex === -1) return;
  
  guests[guestIndex].notes = guests[guestIndex].notes.filter(n => n.id !== noteId);
  
  saveGuest(guests[guestIndex]);
  selectGuest(selectedGuestId);
  showToast("メモを削除したよ");
}

// === 顧客の登録・編集モーダル ===
function openGuestModal(guestId = null) {
  const modal = document.getElementById('guest-modal');
  const form = document.getElementById('guest-form');
  const title = document.getElementById('modal-title');
  
  form.reset();
  document.getElementById('edit-guest-id').value = '';
  document.getElementById('suggested-tags').textContent = getAllUniqueTags().join(', ') || 'なし';
  
  if (guestId) {
    title.textContent = "顧客プロファイルの編集";
    const guest = guests.find(g => g.id === guestId);
    if (guest) {
      document.getElementById('edit-guest-id').value = guest.id;
      document.getElementById('form-name').value = guest.name || '';
      document.getElementById('form-pronunciation').value = guest.pronunciation || '';
      document.getElementById('form-vrc-name').value = guest.vrcName || '';
      document.getElementById('form-x-id').value = guest.xId || '';
      document.getElementById('form-discord-id').value = guest.discordId || '';
      document.getElementById('form-first-visit').value = guest.firstVisit || '';
      document.getElementById('form-last-visit').value = guest.lastVisit || '';
      document.getElementById('form-visit-count').value = guest.visitCount || 1;
      document.getElementById('form-is-cast').checked = guest.isCast || false;
      document.getElementById('form-is-active-today').checked = guest.isActiveToday || false;
      document.getElementById('form-active-today-container').style.display = guest.isCast ? 'block' : 'none';
      document.getElementById('form-tags').value = (guest.tags || []).join(', ');
      document.getElementById('form-characteristics').value = guest.characteristics || '';
    }
  } else {
    title.textContent = "新規顧客登録";
    // デフォルト日付を今日にする
    document.getElementById('form-first-visit').value = getTodayDateString();
    document.getElementById('form-last-visit').value = getTodayDateString();
    document.getElementById('form-visit-count').value = 1;
    document.getElementById('form-is-cast').checked = false;
    document.getElementById('form-is-active-today').checked = false;
    document.getElementById('form-active-today-container').style.display = 'none';
  }
  
  modal.style.display = 'flex';
}

function closeGuestModal() {
  document.getElementById('guest-modal').style.display = 'none';
}

async function handleGuestFormSubmit(e) {
  e.preventDefault();
  
  const id = document.getElementById('edit-guest-id').value;
  const name = document.getElementById('form-name').value.trim();
  const pronunciation = document.getElementById('form-pronunciation').value.trim();
  const vrcName = document.getElementById('form-vrc-name').value.trim();
  const xId = document.getElementById('form-x-id').value.trim();
  const discordId = document.getElementById('form-discord-id').value.trim();
  const firstVisit = document.getElementById('form-first-visit').value;
  const lastVisit = document.getElementById('form-last-visit').value;
  const visitCount = parseInt(document.getElementById('form-visit-count').value, 10) || 1;
  const isCast = document.getElementById('form-is-cast').checked;
  const isActiveToday = isCast ? document.getElementById('form-is-active-today').checked : false;
  const characteristics = document.getElementById('form-characteristics').value.trim();
  
  // タグ文字列のパース (カンマまたはスペース区切り)
  const tagsRaw = document.getElementById('form-tags').value;
  const tags = tagsRaw.split(/[,，\s]+/)
    .map(t => t.trim())
    .filter(t => t.length > 0);
    
  if (id) {
    // 既存の編集
    const index = guests.findIndex(g => g.id === id);
    if (index !== -1) {
      guests[index] = {
        ...guests[index],
        name,
        pronunciation,
        vrcName,
        xId,
        discordId,
        firstVisit,
        lastVisit,
        visitCount,
        isCast,
        isActiveToday,
        tags,
        characteristics
      };
      await saveGuest(guests[index]);
      showToast("顧客情報を更新したよ");
    }
  } else {
    // 新規追加
    const newGuest = {
      id: 'guest-' + Date.now(),
      name,
      pronunciation,
      vrcName,
      xId,
      discordId,
      firstVisit,
      lastVisit,
      visitCount,
      isCast,
      isActiveToday,
      tags,
      characteristics,
      notes: []
    };
    guests.push(newGuest);
    await saveGuest(newGuest);
    selectedGuestId = newGuest.id; // 新規追加した人を自動選択
    showToast("新しく顧客を顧客名簿に加えたよ");
  }
  
  closeGuestModal();
  renderGuestList();
  if (selectedGuestId) {
    selectGuest(selectedGuestId);
  }
}

async function deleteGuest(id) {
  if (!confirm("本当にこの顧客を削除するかい？メモや会話履歴もすべて消えてしまうよ。")) {
    return;
  }
  
  guests = guests.filter(g => g.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(guests));
  
  // デバッグサーバー（互換用）
  try {
    await fetch('/api/guests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(guests)
    });
  } catch (e) {}

  if (dbClient) {
    try {
      const { error } = await dbClient.from('guests').delete().eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.error("[Supabase] データの削除に失敗しました:", e);
    }
  }
  
  selectedGuestId = null;
  document.getElementById('no-selection-placeholder').style.display = 'flex';
  document.getElementById('detail-content').style.display = 'none';
  
  renderGuestList();
  showToast("顧客を顧客名簿から削除したよ");
}

// === データ管理（インポート/エクスポート） ===
function openSettingsModal() {
  document.getElementById('settings-modal').style.display = 'flex';
  document.getElementById('selected-file-name').textContent = "選択されていません";
  document.getElementById('import-btn').disabled = true;
  document.getElementById('import-file-input').value = '';
  
  // しきい値を入力欄にセット
  document.getElementById('threshold-semi-regular').value = semiRegularThreshold;
  document.getElementById('threshold-regular').value = regularThreshold;
  document.getElementById('threshold-vip').value = vipThreshold;
}

function closeSettingsModal() {
  document.getElementById('settings-modal').style.display = 'none';
}

function exportData() {
  const jsonString = JSON.stringify(guests, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  const dateStr = getTodayDateString().replace(/-/g, '');
  a.href = url;
  a.download = `vrc_cast_companion_backup_${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showToast("データをJSONファイルでエクスポートしたよ！");
}

function exportSingleGuest(guestId) {
  const guest = guests.find(g => g.id === guestId);
  if (!guest) return;
  
  let txt = `=========================================\n`;
  txt += ` VRC CAST COMPANION - GUEST CARD\n`;
  txt += `=========================================\n`;
  txt += `【名前】 ${guest.name}`;
  if (guest.pronunciation) txt += ` (${guest.pronunciation})`;
  txt += `\n`;
  if (guest.vrcName) txt += `【VRChat ID】 @${guest.vrcName}\n`;
  if (guest.xId) txt += `【X (Twitter)】 ${guest.xId}\n`;
  if (guest.discordId) txt += `【Discord】 ${guest.discordId}\n`;
  txt += `-----------------------------------------\n`;
  txt += `【初回来店日】 ${guest.firstVisit ? guest.firstVisit.replace(/-/g, '/') : '未設定'}\n`;
  txt += `【最終来店日】 ${guest.lastVisit ? guest.lastVisit.replace(/-/g, '/') : '未設定'}\n`;
  txt += `【タグ】 ${(guest.tags || []).join(', ') || 'なし'}\n`;
  txt += `-----------------------------------------\n`;
  txt += `【特徴・好み】\n${guest.characteristics || '未設定'}\n`;
  txt += `-----------------------------------------\n`;
  txt += `【会話履歴・メモ】\n`;
  
  if (guest.notes && guest.notes.length > 0) {
    const sortedNotes = [...guest.notes].sort((a, b) => b.date.localeCompare(a.date));
    sortedNotes.forEach(note => {
      txt += `[${note.date.replace(/-/g, '/')}]\n${note.content}\n\n`;
    });
  } else {
    txt += `履歴なし\n`;
  }
  txt += `=========================================\n`;

  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `guest_${guest.name}_card.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showToast(`${guest.name} のページを抜き出して保存したよ！`);
}

function triggerImportFile() {
  document.getElementById('import-file-input').click();
}

function handleImportFileChange(e) {
  const file = e.target.files[0];
  const label = document.getElementById('selected-file-name');
  const importBtn = document.getElementById('import-btn');
  
  if (file) {
    label.textContent = file.name;
    importBtn.disabled = false;
  } else {
    label.textContent = "選択されていません";
    importBtn.disabled = true;
  }
}

function importData() {
  const fileInput = document.getElementById('import-file-input');
  const file = fileInput.files[0];
  if (!file) return;
  
  if (!confirm("現在のデータはすべて上書きされるけど、本当に復元していいかい？")) {
    return;
  }
  
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const importedData = JSON.parse(e.target.result);
      if (Array.isArray(importedData)) {
        // 最低限のデータ構造バリデーション
        const isValid = importedData.every(item => item && typeof item.name === 'string');
        if (isValid) {
          guests = importedData.map(item => ({
            id: item.id || ('guest-' + Date.now() + Math.random().toString(36).substr(2, 5)),
            name: item.name,
            pronunciation: item.pronunciation || '',
            vrcName: item.vrcName || '',
            xId: item.xId || '',
            discordId: item.discordId || '',
            firstVisit: item.firstVisit || '',
            lastVisit: item.lastVisit || '',
            tags: item.tags || [],
            characteristics: item.characteristics || '',
            notes: item.notes || []
          }));
          saveData();
          selectedGuestId = null;
          document.getElementById('no-selection-placeholder').style.display = 'flex';
          document.getElementById('detail-content').style.display = 'none';
          
          renderGuestList();
          closeSettingsModal();
          showToast("データを正常に復元したよ！");
        } else {
          alert("ファイルのフォーマットが正しくありません。");
        }
      } else {
        alert("ファイル内容が配列ではありません。");
      }
    } catch (err) {
      alert("ファイルの解析に失敗しました。正しいJSONファイルか確認してください。");
      console.error(err);
    }
  };
  reader.readAsText(file);
}

function generateDemoData() {
  // 既存のIDと重複しないようにデモデータをマージ
  const newDemoData = DEMO_GUEST_DATA.filter(demo => !guests.some(g => g.vrcName === demo.vrcName));
  if (newDemoData.length === 0) {
    showToast("デモデータはすでにすべて登録されているよ");
    return;
  }
  
  guests = [...guests, ...newDemoData.map(d => ({...d, id: 'guest-demo-' + Date.now() + Math.random().toString(36).substring(2, 4)}))];
  saveData();
  renderGuestList();
  closeSettingsModal();
  showToast("デモデータを追加したよ！");
}

// === イベントリスナー紐付け ===
function setupEventListeners() {
  // 検索入力
  const searchInput = document.getElementById('search-input');
  const clearSearch = document.getElementById('clear-search');
  
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    if (searchQuery) {
      clearSearch.style.display = 'block';
    } else {
      clearSearch.style.display = 'none';
    }
    renderGuestList();
  });
  
  clearSearch.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    clearSearch.style.display = 'none';
    renderGuestList();
    searchInput.focus();
  });
  
  // キーボードショートカット (Ctrl+K or Cmd+K) で検索フォーカス
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      searchInput.focus();
    }
    // ESCで検索クリア & フォーカスアウト
    if (e.key === 'Escape' && document.activeElement === searchInput) {
      searchInput.blur();
    }
  });
  
  // 新規登録ボタン
  document.getElementById('add-guest-btn').addEventListener('click', () => openGuestModal());
  
  // モーダルクローズ
  document.getElementById('modal-close').addEventListener('click', closeGuestModal);
  document.getElementById('modal-cancel').addEventListener('click', closeGuestModal);
  
  // モーダル枠外クリックで閉じる
  window.addEventListener('click', (e) => {
    const guestModal = document.getElementById('guest-modal');
    const settingsModal = document.getElementById('settings-modal');
    if (e.target === guestModal) closeGuestModal();
    if (e.target === settingsModal) closeSettingsModal();
  });
  
  // フォーム送信
  document.getElementById('guest-form').addEventListener('submit', handleGuestFormSubmit);
  
  // キャスト登録チェックボックスのトグル監視（出勤登録欄の表示/非表示）
  const formIsCast = document.getElementById('form-is-cast');
  if (formIsCast) {
    formIsCast.addEventListener('change', (e) => {
      const container = document.getElementById('form-active-today-container');
      if (container) {
        container.style.display = e.target.checked ? 'block' : 'none';
        if (!e.target.checked) {
          // キャストから外された場合は出勤も自動でオフにする
          const activeTodayInput = document.getElementById('form-is-active-today');
          if (activeTodayInput) activeTodayInput.checked = false;
        }
      }
    });
  }

  // 右ページ編集・削除・抜き出し
  document.getElementById('export-single-guest-btn').addEventListener('click', () => {
    if (selectedGuestId) exportSingleGuest(selectedGuestId);
  });
  document.getElementById('edit-guest-btn').addEventListener('click', () => {
    if (selectedGuestId) openGuestModal(selectedGuestId);
  });
  document.getElementById('delete-guest-btn').addEventListener('click', () => {
    if (selectedGuestId) deleteGuest(selectedGuestId);
  });
  
  // メモ追加
  document.getElementById('add-note-btn').addEventListener('click', addNote);
  document.getElementById('new-note-input').addEventListener('keydown', (e) => {
    // Ctrl + Enter でメモ送信
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      addNote();
    }
  });
  
  // 設定関連
  document.getElementById('settings-btn').addEventListener('click', openSettingsModal);
  document.getElementById('settings-close').addEventListener('click', closeSettingsModal);
  document.getElementById('export-btn').addEventListener('click', exportData);
  document.getElementById('import-trigger-btn').addEventListener('click', triggerImportFile);
  document.getElementById('import-file-input').addEventListener('change', handleImportFileChange);
  document.getElementById('import-btn').addEventListener('click', importData);
  document.getElementById('demo-data-btn').addEventListener('click', generateDemoData);
  
  // しきい値の保存処理
  const saveThresholdsBtn = document.getElementById('save-thresholds-btn');
  if (saveThresholdsBtn) {
    saveThresholdsBtn.addEventListener('click', () => {
      const semiVal = parseInt(document.getElementById('threshold-semi-regular').value, 10) || 3;
      const regVal = parseInt(document.getElementById('threshold-regular').value, 10) || 5;
      const vipVal = parseInt(document.getElementById('threshold-vip').value, 10) || 10;
      
      if (semiVal >= regVal || regVal >= vipVal) {
        alert("しきい値の順序が正しくありません。(準常連 < 常連 < VIP となるようにしてください)");
        return;
      }
      
      semiRegularThreshold = semiVal;
      regularThreshold = regVal;
      vipThreshold = vipVal;
      
      localStorage.setItem('threshold_semi_regular', semiVal);
      localStorage.setItem('threshold_regular', regVal);
      localStorage.setItem('threshold_vip', vipVal);
      
      renderGuestList();
      if (selectedGuestId) {
        selectGuest(selectedGuestId);
      }
      showToast("しきい値設定を保存しました");
    });
  }

  const editDbBtn = document.getElementById('edit-db-btn');
  if (editDbBtn) {
    editDbBtn.addEventListener('click', () => {
      const url = localStorage.getItem('supabase_url') || '';
      const key = localStorage.getItem('supabase_key') || '';
      
      const urlInput = document.getElementById('setup-db-url');
      const keyInput = document.getElementById('setup-db-key');
      
      // URLからProject IDのみを抽出して入力欄にプリセットする
      let displayUrlOrId = url;
      if (url && url.startsWith('https://') && url.endsWith('.supabase.co')) {
        displayUrlOrId = url.replace('https://', '').replace('.supabase.co', '');
      }
      
      if (urlInput) urlInput.value = displayUrlOrId;
      if (keyInput) keyInput.value = key;
      
      closeSettingsModal();
      
      const setupCloseBtn = document.getElementById('db-setup-close');
      if (setupCloseBtn) {
        if (url && key) {
          setupCloseBtn.style.display = 'block';
        } else {
          setupCloseBtn.style.display = 'none';
        }
      }
      
      const setupModal = document.getElementById('db-setup-modal');
      if (setupModal) setupModal.style.display = 'flex';
    });
  }

  const setupCloseBtn = document.getElementById('db-setup-close');
  if (setupCloseBtn) {
    setupCloseBtn.addEventListener('click', () => {
      const setupModal = document.getElementById('db-setup-modal');
      if (setupModal) setupModal.style.display = 'none';
    });
  }
  
  // デフォルト日付インプットの初期値
  document.getElementById('new-note-date').value = getTodayDateString();
}

// === ヘルパーユーティリティ ===
function getTodayDateString() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function updateTotalCount() {
  document.getElementById('total-guests-count').textContent = guests.length;
}

function getAllUniqueTags() {
  const allTags = [];
  guests.forEach(g => {
    if (g.tags) {
      g.tags.forEach(tag => {
        if (!allTags.includes(tag)) {
          allTags.push(tag);
        }
      });
    }
  });
  return allTags;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  
  // 既存のトーストアニメーションがあれば一度消す
  toast.style.display = 'none';
  // 強制リフローさせてアニメーションを初期化
  void toast.offsetWidth;
  
  toast.textContent = message;
  toast.style.display = 'block';
  
  // 3秒後に非表示にする
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}

function escapeHTML(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// === Supabase初期化 ===
async function initSupabase(url, key) {
  if (window.supabase) {
    try {
      dbClient = window.supabase.createClient(url, key);
      await loadData();
      renderGuestList();
      updateTotalCount();
      setupSupabaseRealtime();
    } catch (err) {
      console.error("Supabaseの初期化またはデータロードに失敗しました:", err);
      // 接続情報をクリアして再設定を促す
      localStorage.removeItem('supabase_url');
      localStorage.removeItem('supabase_key');
      document.getElementById('db-setup-modal').style.display = 'flex';
      alert("Supabaseへの接続に失敗しました。以前の接続情報をクリアしますので、もう一度正しい設定を入力してください。\n\nエラー: " + err.message);
      throw err;
    }
  } else {
    const errorMsg = "Supabase JS SDKがロードされていません。インターネット接続状態や、アドブロックによってSDK(cdn.jsdelivr.net)の通信がブロックされていないか確認してください。";
    console.error(errorMsg);
    alert(errorMsg);
    // 初期化に失敗したため、ローカルモードで動作させる
    await loadData();
    renderGuestList();
    updateTotalCount();
  }
}

// === データベース初期設定ウィザード ===
function setupDbWizard() {
  const modal = document.getElementById('db-setup-modal');
  if (!modal) return;
  
  const form = document.getElementById('db-setup-form');
  const closeBtn = document.getElementById('db-setup-close');
  
  const url = localStorage.getItem('supabase_url');
  const key = localStorage.getItem('supabase_key');
  
  if (!url || !key) {
    if (closeBtn) closeBtn.style.display = 'none';
    modal.style.display = 'flex';
  } else {
    if (closeBtn) closeBtn.style.display = 'block';
    initSupabase(url, key).catch(() => {
      // 起動時初期化に失敗した場合はモーダルを開く
      modal.style.display = 'flex';
    });
  }
  
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      let inputUrl = document.getElementById('setup-db-url').value.trim();
      const inputKey = document.getElementById('setup-db-key').value.trim();
      
      // Project IDが入力された場合はURL形式に補完
      if (inputUrl && !inputUrl.startsWith('http://') && !inputUrl.startsWith('https://')) {
        const cleanId = inputUrl.replace(/[^a-zA-Z0-9]/g, '');
        inputUrl = `https://${cleanId}.supabase.co`;
      }
      
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "接続確認中...";
      }
      
      try {
        if (!window.supabase) {
          throw new Error("Supabase SDKが読み込まれていません。ページを再読み込みしてください。");
        }
        // 接続テスト
        const tempClient = window.supabase.createClient(inputUrl, inputKey);
        const { error } = await tempClient.from('guests').select('count', { count: 'exact', head: true });
        if (error) throw error;
        
        localStorage.setItem('supabase_url', inputUrl);
        localStorage.setItem('supabase_key', inputKey);
        modal.style.display = 'none';
        showToast("クラウドDBへの接続に成功しました！");
        
        await initSupabase(inputUrl, inputKey);
      } catch (err) {
        console.error(err);
        alert("データベースに接続できませんでした。以下の原因が考えられます：\n\n1. URLかanon keyが間違っている\n2. SQL Editorでテーブル作成用クエリを実行していない\n\nエラー詳細: " + err.message);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "接続して顧客名簿を展開する 👥";
        }
      }
    });
  }
}

// === Supabase リアルタイム同期連携 ===
function setupSupabaseRealtime() {
  if (!dbClient) return;
  
  // guests テーブルの変更検知（他ブラウザからの追加・編集をリアルタイム受信）
  dbClient
    .channel('db-guests-channel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'guests' }, async () => {
      await loadData();
      renderGuestList();
      if (selectedGuestId) {
        selectGuest(selectedGuestId);
      }
    })
    .subscribe();
    
  // realtime_events テーブルの検知（ローカル監視スクリプトやUdonからの通知）
  dbClient
    .channel('db-events-channel')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'realtime_events' }, payload => {
      const newEvent = payload.new;
      if (newEvent.type === 'player-join') {
        handlePlayerJoinEvent(newEvent.player_name);
      } else if (newEvent.type === 'guestbook-register') {
        // 芳名帳記名通知
        handleGuestbookRegisterEvent(newEvent.player_name, newEvent.comment, newEvent.visit_count);
      }
    })
    .subscribe();
}

function handlePlayerJoinEvent(playerName) {
  const nameLower = playerName.toLowerCase();
  
  // 登録メンバー照合
  const foundGuest = guests.find(g => 
    (g.name && g.name.toLowerCase() === nameLower) ||
    (g.pronunciation && g.pronunciation.toLowerCase() === nameLower) ||
    (g.vrcName && g.vrcName.toLowerCase() === nameLower)
  );
  
  if (foundGuest) {
    selectGuest(foundGuest.id);
    showToast(`✨ ${foundGuest.name} がインスタンスに入室しました。カルテを開きます。`);
  } else {
    const escapedName = escapeHTML(playerName).replace(/'/g, "\\'");
    showToastWithAction(
      `👤 未登録の「${escapeHTML(playerName)}」が入室しました。`,
      `登録する`,
      `window.quickRegisterGuest('${escapedName}')`
    );
  }
}

async function handleGuestbookRegisterEvent(playerName, comment, visitCount) {
  await loadData();
  renderGuestList();
  
  // 記名されたゲストを検索
  const nameLower = playerName.toLowerCase();
  const guest = guests.find(g => 
    (g.name && g.name.toLowerCase() === nameLower) ||
    (g.vrcName && g.vrcName.toLowerCase() === nameLower)
  );
  
  if (guest) {
    selectedGuestId = guest.id;
    selectGuest(guest.id);
  }
  
  let msg = `📖 芳名帳に「${escapeHTML(playerName)}」さんが記名しました！(来店:${visitCount || 1}回目)`;
  if (comment) {
    msg += ` ↳ "${escapeHTML(comment)}"`;
  }
  showToast(msg);
}

function showToastWithAction(message, actionLabel, actionJS) {
  const toast = document.getElementById('toast');
  toast.style.display = 'none';
  void toast.offsetWidth; // リフロー
  
  toast.innerHTML = `${message} <button class="btn btn-primary btn-sm" style="margin-left: 10px; padding: 4px 8px; font-size: 10px; box-shadow: var(--glow-cyan);" onclick="${actionJS}">${actionLabel}</button>`;
  toast.style.display = 'block';
}

// クイック追加アクション
window.quickRegisterGuest = function(name) {
  openGuestModal();
  document.getElementById('form-name').value = name;
  document.getElementById('form-vrc-name').value = name;
  document.getElementById('toast').style.display = 'none';
};
