// firebaseから関数をインポート
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, get, set } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// ReactのフックをUMDビルドから取り出す
const { useState, useEffect, useRef, useCallback } = React;


// firebaseの接続設定
const firebaseConfig = {
    apiKey:            "AIzaSyB-nACMRS4MaPbkeYuqqhrbsoIjBJSsM5g",
    authDomain:        "pken-schedule.firebaseapp.com",
    databaseURL:       "https://pken-schedule-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId:         "pken-schedule",
    storageBucket:     "pken-schedule.firebasestorage.app",
    messagingSenderId: "896999009755",
    appId:             "1:896999009755:web:ba18d17906013f2b0d8bfe"
};

// firebaseの初期化、realtime databaseへの参照を取得
const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// realtime database内のデータパス定数
const DB_SCH_PATH   = "schedules";
const DB_PASS_PATH  = "adminPassword";
const DB_USERS_PATH = "users";          // ユーザー { name: {password, email} }
const DB_NOTIF_PATH  = "userNotifPrefs"; // 通知設定 { notifyOwn, notifyOthers }
const DB_EVENT_PATH  = "events";          // イベント設定 { dateKey: { name, blockBooking } }

// EmailJSの接続設定
const EMAILJS_SERVICE_ID  = "service_1ycm187";
const EMAILJS_TEMPLATE_ID = "template_t13ebb1";
const EMAILJS_PUBLIC_KEY  = "oSDByclYIPt0J03C6";

// カレンダー用の曜日ラベル (火曜日から)
const DAYS_JA = ["火", "水", "木", "金", "土", "日", "月"];

// デフォルトの管理者パスワード (難読化)
const _EK = 0x5A;
const _EP = [42, 49, 63, 52, 116, 59, 62, 55, 51, 52, 116, 107, 104, 105, 110];
const DEFAULT_PASS = _EP.map(b => String.fromCharCode(b ^ _EK)).join("");

// 色パレット (18色) { 背景色, 文字色 }
const PALETTE = [
    {bg:"#FF6B9D", text:"#fff"}, {bg:"#26C6DA", text:"#fff"}, {bg:"#42A5F5", text:"#fff"},
    {bg:"#66BB6A", text:"#fff"}, {bg:"#FFA726", text:"#fff"}, {bg:"#AB47BC", text:"#fff"},
    {bg:"#5C6BC0", text:"#fff"}, {bg:"#E67E22", text:"#fff"}, {bg:"#EC407A", text:"#fff"},
    {bg:"#26A69A", text:"#fff"}, {bg:"#8D6E63", text:"#fff"}, {bg:"#546E7A", text:"#fff"},
    {bg:"#EF5350", text:"#fff"}, {bg:"#7E57C2", text:"#fff"}, {bg:"#29B6F6", text:"#fff"},
    {bg:"#9CCC65", text:"#fff"}, {bg:"#FF7043", text:"#fff"}, {bg:"#00ACC1", text:"#fff"},
];

// 同じ名前は同じ色にする処理
const nameColorMap = new Map();

const customColorMap = new Map();

function textColorForBg(hex){
    const r = parseInt(hex.slice(1, 3), 16),g=parseInt(hex.slice(3, 5), 16),b=parseInt(hex.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 >= 145 ? "#2d2d3a":"#fff";
}

function colorFor(name, scheduleId){
    if(scheduleId!=null && customColorMap.has(scheduleId)) return customColorMap.get(scheduleId);
    const key = name.trim().toLowerCase();
    if (!key) return PALETTE[0]; // 空名前はデフォルト色

    // 既にマップに登録済みならそのインデックスの色を返す
    if (nameColorMap.has(key)) return PALETTE[nameColorMap.get(key)];

    // 既に使用中のインデックスを収集して衝突を避ける
    const usedIndices = new Set([...nameColorMap.values()]);

    // 名前文字列をハッシュ化して最初の候補インデックスを決める
    let h = 0;
    for (let c of key) h = (h * 31 + c.charCodeAt(0)) % PALETTE.length;

    // 候補が既に使用中なら次の未使用インデックスを線形探索
    if (usedIndices.has(h)){
        for (let i = 0; i < PALETTE.length; i++){
            const idx = (h + i + 1) % PALETTE.length;
            if (!usedIndices.has(idx)){
                h = idx; break;
            }
        }
    }

    // 決定したインデックスをマップに登録
    nameColorMap.set(key, h);
    return PALETTE[h];
}

// Date オブジェクトを "YYYY-MM-DD" 形式の文字列に変換
function dateKey(dt){
    return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
}

// 分数を "H:MM" 形式に変換
function fmtTime(min){
    return Math.floor(min / 60) + ":" + String(min % 60).padStart(2, "0");
}

// Date を "M/D" 形式に変換 (カレンダー表示用)
function formatDate(dt){
    return (dt.getMonth() + 1) + "/" + dt.getDate();
}

// 火曜日始まりで7日分のDate配列を返す (0が今週)
function buildWeekDates(offsetWeeks){
    const base = new Date();
    base.setDate(base.getDate() + (offsetWeeks || 0) * 7);
    const day = base.getDay(); // 0 = 日, 1 = 月, ... , 6 = 土
    // 火曜日 (2)からの差を求めて週の先頭(火)の日付を計算
    const diff = day >= 2 ? (day - 2) : (day + 5);
    const tue = new Date(base);
    tue.setDate(base.getDate() - diff);
    // 火 ~ 月の7日分を生成して返す
    return Array.from({length:7},(_,i) => { const dt = new Date(tue); dt.setDate(tue.getDate() + i); return dt; });
}

// 現在時刻から次の空き2時間スロットの開始時を返す
// スロット候補: 10, 12, 14, 16, 18 時 (現在時刻が全スロット以降なら10を返す)
function defaultStartHour() {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes();
    const slots = [10, 12, 14, 16, 18];
    for (const s of slots) {
        if (h < s) return s;              // 現時刻よりあとのスロット
        if (h === s && m === 0) return s; // ちょうどスロット開始時刻
        if (h >= s && h < (s + 2)) return (s + 2) <= 20 ? (s + 2) : 10; // 現在スロット進行中は次へ
    }
    return 10;
}

// 今日の日付が週の何番目かを返す（予定追加フォームの曜日初期値用）
function defaultDayIndex(weekDates) {
    const todayKey = dateKey(new Date());
    const idx = weekDates.findIndex(d => dateKey(d) === todayKey);
    return idx >= 0 ? idx : 0;
}

// 予定追加フォームの1行分の初期データを生成
// _id はリスト操作用のローカル一意キー
function newRow(weekDates, isAdmin) {
    const sh = defaultStartHour();
    const di = defaultDayIndex(weekDates);
    return { _id: Math.random(), name:"", dayIndex:di, startH:sh, startM:0, endH:Math.min((sh + 2), 20), endM:0, pin:"", color:"" };
}

// 予定1件の入力フォーム行コンポーネント
function RowEditor({row, idx, rowCount, isAdmin, cls, weekDates, hourRange, minuteSteps, updateRow, removeRow}) {
    // 名前が入力済みならプレビュー用の色を取得
    const pal = row.name.trim() ? colorFor(row.name.trim()) : null;
    return (
        // 重複警告がある行はカード背景を赤/黄に変える
        <div className = {(isAdmin?"row-card-a":"row-card") + (row.warn?" warn-row":"")} style = {{marginBottom:12}}>

        {/* 2行以上ある場合のみ行削除ボタンを右上に表示 */}
        {rowCount > 1 && (
            <button onClick={() => removeRow(row._id)} style = {{position:"absolute", top:10, right:10, background:"none", border:"none", cursor:"pointer", fontSize:17, color:"#9ca3af", fontWeight:800, lineHeight:1}}>×</button>
        )}

        {/* 行番号ラベル */}
        <div style = {{fontWeight:800, fontSize:12, color:isAdmin?"#b45309":"#7c73ff", marginBottom:10}}>予定 {idx + 1}</div>

        {/* 名前 + PIN 入力欄 */}
        <div style = {{display:"grid", gridTemplateColumns:"1fr 120px", gap:10, marginBottom:10}}>
            <div>
            <label className = "lbl">名前</label>
            <input className = {cls} placeholder = "名前" value = {row.name} onChange = {e => updateRow(row._id,"name",e.target.value)}/>
            </div>
            <div>
                <label className = "lbl">PIN（4桁）</label>
                {/* inputMode="numeric" でスマホに数字キーパッドを表示 */}
                <input className = {cls} type = "password" inputMode = "numeric" maxLength = {4}
                value={row.pin || ""}
                onChange={e => updateRow(row._id, "pin", e.target.value.replace(/[^0-9]/g,"").slice(0, 4))}/>
            </div>
        </div>

        {/* 曜日・日付セレクター */}
        <div style = {{marginBottom:10}}>
            <label className = "lbl">曜日・日付</label>
            <select className = {cls} value = {row.dayIndex} onChange = {e => updateRow(row._id,"dayIndex", +e.target.value)}>
            {weekDates.map((dt, i) => <option key={i} value={i}> {DAYS_JA[i]}曜日（{dt.getMonth() + 1} / {dt.getDate()}）</option>)}
            </select>
        </div>

        {/* 開始・終了時刻セレクター */}
        <div style = {{display:"grid", gridTemplateColumns:"1fr 20px 1fr", gap:6, alignItems:"flex-end"}}>
            <div>
            <label className = "lbl">開始</label>
            <div style = {{display:"flex", gap:4}}>
                {/* 終了時を開始時の+2hに自動更新 */}
                <select className = {cls} value = {row.startH} onChange = {e => updateRow(row._id,"startH", +e.target.value)}>
                {hourRange.map(h => <option key = {h} value = {h}> {h}時</option>)}
                </select>
                <select className = {cls} value = {row.startM} onChange = {e => updateRow(row._id,"startM", +e.target.value)}>
                {minuteSteps.map(m => <option key = {m} value = {m}> {String(m).padStart(2, "0")}分</option>)}
                </select>
            </div>
            </div>
            <div style = {{textAlign:"center", paddingBottom:8, color:"#c4c4d4", fontWeight:700, fontSize:14}}>→</div>
            <div>
            <label className = "lbl">終了</label>
            <div style = {{display:"flex", gap:4}}>
                {/* 終了時を開始時の-2hに自動更新 */}
                <select className = {cls} value = {row.endH} onChange = {e => updateRow(row._id,"endH", +e.target.value)}>
                {hourRange.map(h => <option key = {h} value = {h}> {h}時</option>)}
                </select>
                <select className = {cls} value = {row.endM} onChange = {e => updateRow(row._id,"endM", +e.target.value)}>
                {minuteSteps.map(m => <option key = {m} value = {m}> {String(m).padStart(2, "0")}分</option>)}
                </select>
            </div>
            </div>
        </div>

        {/* バリデーション警告メッセージ */}
        {row.warn && (
            <div className = {isAdmin?"wbox-a":"wbox"} style = {{marginTop:10, fontSize:12}}>
            {row.warn}
            {/* 管理者かつ強制追加可能な場合は追加の案内テキストを表示 */}
            {isAdmin && row.forceOk && <div style = {{marginTop:3, fontSize:11, fontWeight:700}}>このまま「追加する」を押すと強制追加します。</div>}
            </div>
        )}

        <div style = {{marginTop:10, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap"}}>
            <span style = {{fontSize:11, fontWeight:800, color:isAdmin?"#b45309":"#7c73ff"}}>ブロックの色</span>
            <input type = "color" value = {row.color || (pal?pal.bg:"#6c63ff")}
                onChange = {e => updateRow(row._id,"color",e.target.value)}
                style = {{width:32, height:28, border:"none", borderRadius:7, cursor:"pointer", padding:2}}/>
            {row.color && <button onClick={() => updateRow(row._id,"color","")}
                style = {{background:"none", border:"1px solid #e5e7eb", cursor:"pointer", fontSize:11, color:"#9ca3af", fontWeight:700, padding:"2px 8px", borderRadius:6, fontFamily:"inherit"}}>自動に戻す</button>}
            <span style = {{fontSize:11, color:"#b0b0c4"}}> {row.color?"カスタムカラー":"自動"}</span>
        </div>
        {pal && (() => {
            const bg = row.color || pal.bg, tx = row.color?textColorForBg(row.color):pal.text;
            return <div style = {{marginTop:8}}><span style={{display:"inline-flex", alignItems:"center", gap:5, padding:"4px 10px", borderRadius:24, background:bg, color:tx, fontSize:12, fontWeight:700, boxShadow:"0 2px 8px " + bg + "40"}}>
                {row.name}　{DAYS_JA[row.dayIndex]}　{row.startH}:{String(row.startM).padStart(2,"0")}〜{row.endH}:{String(row.endM).padStart(2, "0")}
            </span></div>;
        })()}
        </div>
    );
}

// アプリ本体コンポーネント
function App(){
    const today = new Date(); // 今日の日付 (TODAY ハイライト用)

    // スケジュールデータと読み込み・保存状態
    const [schedules, setSchedules] = useState([]);
    const [loading, setLoading] = useState(true);   // Firebase 読み込み中フラグ
    const [saving, setSaving] = useState(false);     // Firebase 書き込み中フラグ

    // 管理者モード関連の状態
    const [adminPass, setAdminPass] = useState(DEFAULT_PASS); // 現在有効な管理者パスワード
    const [isAdmin, setIsAdmin] = useState(false);            // 管理者ログイン済みフラグ
    const [showLogin, setShowLogin] = useState(false);        // ログインモーダル表示フラグ
    const [loginInput, setLoginInput] = useState("");         // ログインフォームの入力値
    const [loginErr, setLoginErr] = useState("");             // ログインエラーメッセージ
    const [weekOffset, setWeekOffset] = useState(0);          // 週ナビのオフセット

    // パスワード変更モーダル関連の状態
    const [showPassChange, setShowPassChange] = useState(false);
    const [passOld, setPassOld] = useState("");   // 現在のパスワード入力値
    const [passNew, setPassNew] = useState("");   // 新しいパスワード入力値
    const [passNew2, setPassNew2] = useState(""); // 新しいパスワード (確認用)
    const [passErr, setPassErr] = useState("");   // エラーメッセージ
    const [passOk, setPassOk] = useState(false);  // 変更成功フラグ

    // 予定追加モーダル関連の状態
    const [showForm, setShowForm] = useState(false);  // 追加モーダル表示フラグ
    const [rows, setRows] = useState([]);             // 追加フォームの行データ配列
    const [globalWarn, setGlobalWarn] = useState(""); // 全体向けの警告メッセージ
    // PIN 一括設定：全行に同じPINを適用するための入力値
    const [bulkPin, setBulkPin] = useState("");

    // 詳細モーダル (左クリック・タップで開く)
    const [selected, setSelected] = useState(null); // 表示中の予定オブジェクト

    // 右クリックコンテキストメニュー
    const [ctxMenu, setCtxMenu] = useState(null); // { x, y, s } または null
    const ctxRef = useRef(null);                 // メニュー DOM への参照 (外側クリック検知用)
    const captureRef = useRef(null);             // カレンダー部分への参照 (画像保存用)
    const [capturing, setCapturing] = useState(false);
    // イベント設定関連
    const [events, setEvents] = useState({});               // { dateKey: { name, blockBooking } }
    const [showEventModal, setShowEventModal] = useState(false); // イベント設定モーダル
    const [eventDateKey, setEventDateKey] = useState("");   // 設定対象の日付
    const [eventName, setEventName] = useState("");         // イベント名入力値
    const [eventBlock, setEventBlock] = useState(false);    // 予約ブロックON/OFF
    const [eventSaving, setEventSaving] = useState(false);  // 保存中フラグ

    const [showHowto, setShowHowto] = useState(false);   // 使い方モーダル
    const [howtoText, setHowtoText] = useState("");         // howto.txt の内容

    // howto.txt をサイトルートから取得する
    useEffect(() => {
        fetch("howto.txt")
            .then(r => r.text())
            .then(t => setHowtoText(t))
            .catch(() => setHowtoText("howto.txtを読み込めませんでした。"));
    },[]);

    // ユーザーログイン関連
    const [users, setUsers] = useState({});
    const [currentUser, setCurrentUser] = useState(null); // {name, ntfyTopic} or null
    const [showUserLogin, setShowUserLogin] = useState(false);
    const [userLoginName, setUserLoginName] = useState("");
    const [userLoginPass, setUserLoginPass] = useState("");
    const [userLoginErr, setUserLoginErr] = useState("");
    const [showRegister, setShowRegister] = useState(false);
    const [regName, setRegName] = useState("");
    const [regPass, setRegPass] = useState("");
    const [regEmail, setRegEmail] = useState("");
    const [regErr, setRegErr] = useState("");
    const [regOk, setRegOk] = useState(false);
    const [showDeleteAccount, setShowDeleteAccount] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState("");
    const [deleteErr, setDeleteErr] = useState("");

    // 通知設定
    const [notifyOwn, setNotifyOwn] = useState(true);
    const [notifyOthers, setNotifyOthers] = useState(true);
    const [showNotifSetup, setShowNotifSetup] = useState(false);
    const [toastList, setToastList] = useState([]);

    // 編集モーダル関連の状態
    const [editTarget, setEditTarget] = useState(null);   // 編集対象の予定オブジェクト
    const [editForm, setEditForm] = useState(null);       // 編集フォームの現在値
    const [editWarn, setEditWarn] = useState("");          // バリデーション警告メッセージ
    const [forceEdit, setForceEdit] = useState(false);    // 管理者の強制上書きフラグ
    const [editPinInput, setEditPinInput] = useState(""); // PIN 確認フォームの入力値
    const [editPinErr, setEditPinErr] = useState("");     // PIN 不一致エラーメッセージ
    const [editPinOk, setEditPinOk] = useState(false);   // PIN 確認済みフラグ

    // 削除 PIN 確認モーダル関連の状態
    const [deleteTarget, setDeleteTarget] = useState(null);   // 削除対象の予定オブジェクト
    const [deletePinInput, setDeletePinInput] = useState(""); // 削除 PIN 入力値
    const [deletePinErr, setDeletePinErr] = useState("");     // 削除 PIN エラーメッセージ

    // 現在表示する週の日付配列
    const weekDates = buildWeekDates(isAdmin?weekOffset:0);

    // 週ナビの移動制限
    // 前方上限: 約1ヶ月前(-4週)まで
    const minWeekOffset = -4;
    // 後方上限: 予定が存在する最も遠い週か今から+4週のどちらか近い方まで
    const maxWeekOffset = (() => {
        if (!schedules.length) return 4;
        // 今週の火曜から何週先かを計算する
        const maxKey = schedules.reduce((m, s) => s.dateKey > m ? s.dateKey : m, "0000-00-00");
        const todayTue = buildWeekDates(0)[0]; // 今週の火曜
        const maxDate = new Date(maxKey);
        const diffMs = maxDate - todayTue;
        const diffWeeks = Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
        return Math.min(diffWeeks + 1, 4); // 予定がある週の翌週まで、ただし+4週が上限
    })();

    // firebaseからスケジュール一覧と管理者パスワードを読み込む
    async function load() {
        try {
        const schSnap  = await get(ref(db, DB_SCH_PATH));
        const passSnap = await get(ref(db, DB_PASS_PATH));
        const loadedSch = schSnap.exists() ? schSnap.val() : [];

        // 1ヶ月以上前の予定を自動削除する (読み込み直後に実行)
        const now = new Date();
        const cutoff = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        const cutoffKey = dateKey(cutoff); // YYYY-MM-DD 形式で比較
        const filteredSch = loadedSch.filter(s => s.dateKey >= cutoffKey);
        // 削除対象がある場合のみfirebaseを更新する
        if (filteredSch.length < loadedSch.length) {
            await set(ref(db, DB_SCH_PATH), filteredSch);
        }

        // 読み込んだ名前を順番に色マップへ登録
        nameColorMap.clear(); customColorMap.clear();
        const seen = [];
        for (const s of filteredSch) {
            const k = (s.name || "").trim().toLowerCase();
            if (k && !nameColorMap.has(k)) { colorFor(k); seen.push(k); }
            if (s.color) customColorMap.set(s.id, {bg:s.color, text:textColorForBg(s.color)});
        }
        setSchedules(filteredSch);
        if (passSnap.exists() && passSnap.val()) setAdminPass(passSnap.val());
        const usersSnap = await get(ref(db, DB_USERS_PATH));
        if (usersSnap.exists()) setUsers(usersSnap.val());
        // イベント設定を読み込む
        const eventSnap = await get(ref(db, DB_EVENT_PATH));
        if (eventSnap.exists()) setEvents(eventSnap.val()); else setEvents({});
        } catch (e) {
        console.error("Firebase read error:", e);
        setSchedules([]);
        }
        setLoading(false);
    }

    // スケジュール一覧をfirebaseに保存する
    async function saveSch(list) {
        await set(ref(db, DB_SCH_PATH), list);
    }

    // 管理者パスワードをfirebaseに保存する
    async function saveAdminPass(p) {
        await set(ref(db, DB_PASS_PATH), p);
    }

    // 初回マウント時にデータを読み込む
    useEffect(() => {load();}, []);

    // コンテキストメニューが表示されているときにメニュー外をクリックしたら閉じる
    useEffect(() => {
        function h(e){
            if(ctxRef.current && !ctxRef.current.contains(e.target))setCtxMenu(null);
        }
        // メニューを開いたクリック自体で即閉じるのを防ぐ
        if(ctxMenu)setTimeout(() => document.addEventListener("mousedown", h), 0);
        return() => document.removeEventListener("mousedown", h);
    }, [ctxMenu]);

    // 管理者ログイン処理
    function handleLogin(){
        if(loginInput === adminPass){
            setIsAdmin(true);
            setShowLogin(false);
            setLoginInput("");
            setLoginErr("");
        }
        else setLoginErr("パスワードが違います");
    }

    // 管理者ログアウト
    function handleLogout(){
        setIsAdmin(false); setWeekOffset(0);
    }

    // パスワード変更処理
    async function handlePassChange(){
        setPassErr("");
        setPassOk(false);
        if(passOld !== adminPass){
            setPassErr("現在のパスワードが違います");
            return;
        }
        if(passNew.length < 6){
            setPassErr("新しいパスワードは6文字以上にしてください");
            return;
        }
        if(passNew !== passNew2){
            setPassErr("新しいパスワードが一致しません");
            return;
        }
        setAdminPass(passNew);
        await saveAdminPass(passNew);
        setPassOk(true);
        setPassOld("");
        setPassNew("");
        setPassNew2("");
    }

    // 初期パスワードへのリセット
    async function handleResetPass(){
        if(!window.confirm("初期パスワードに戻します。よろしいですか？")) return;
        setPassErr("");
        setPassOk(false);
        setAdminPass(DEFAULT_PASS);
        await saveAdminPass(DEFAULT_PASS);
        setPassOk(true);
        setPassOld("");
        setPassNew("");
        setPassNew2("");
    }

    // ユーザーログイン・EmailJS通知

    function addToast(msg){
        const id = Date.now();
        setToastList(l => [...l,{id,msg}]);
        setTimeout(() => setToastList(l => l.filter(t => t.id !== id)), 5000);
    }

    // EmailJSでメールを1通送信
    async function sendEmail(toEmail, subject, message){
        if(EMAILJS_SERVICE_ID === "YOUR_SERVICE_ID") return;
        if(!window.emailjs){
            await new Promise((res,rej) => {
                const s = document.createElement("script");
                s.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
                s.onload = () => { window.emailjs.init(EMAILJS_PUBLIC_KEY); res(); };
                s.onerror=rej;
                document.head.appendChild(s);
            });
        }
        try {
            await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID,
                {to_email:toEmail, subject, message});
        } catch(e){ console.warn("EmailJS送信エラー:", e); }
    }

    // 他ユーザー全員にメール通知
    async function notifyOtherUsers(addedBy, item){
        const notifPrefsSnap = await get(ref(db, DB_NOTIF_PATH));
        const prefs = notifPrefsSnap.exists() ? notifPrefsSnap.val() : {};
        for(const [uid, udata] of Object.entries(users)){
            if(!udata.email) continue;
            const pref = prefs[uid];
            if(pref && pref.notifyOthers === false) continue;
            const subject = `[P研 倉庫] ${item.name} さんが予定を追加しました`;
            const message = `${item.name} さんが予定を追加しました。\n日時：${item.dateKey} ${DAYS_JA[item.dayIndex]}曜 ${fmtTime(item.startMin)}〜${fmtTime(item.endMin)}`;
            await sendEmail(udata.email, subject, message);
        }
    }

    // 自分の予定の1時間前・開始時刻をメール通知する
    const notifiedSet = useRef(new Set());
    useEffect(() => {
        if(!currentUser || !notifyOwn) return;
        const timer = setInterval(async() => {
            const now = new Date();
            const tk = dateKey(now);
            const nm = now.getHours() * 60 + now.getMinutes();
            const mine = schedules.filter(s => s.name.trim().toLowerCase() === (currentUser.name || "").trim().toLowerCase() && s.dateKey >= tk);
            for(const s of mine){
                const k1h = s.id + "_1h";
                if(!notifiedSet.current.has(k1h) && s.dateKey === tk && nm >= (s.startMin - 60) && nm < (s.startMin - 55)){
                    notifiedSet.current.add(k1h);
                    await sendEmail(currentUser.email,"[P研 倉庫] 1時間後に予定があります",`1時間後に予定があります。${s.dateKey} ${DAYS_JA[s.dayIndex]}曜 ${fmtTime(s.startMin)}〜${fmtTime(s.endMin)}`);
                    addToast("📧 1時間前通知をメールで送信しました");
                }
                const ks = s.id + "_start";
                if(!notifiedSet.current.has(ks) && s.dateKey === tk && nm >= s.startMin && nm < (s.startMin + 5)){
                    notifiedSet.current.add(ks);
                    await sendEmail(users[currentUser.name]?.email,"[P研 倉庫] 予定の時刻になりました",`予定の時刻になりました。${s.dateKey} ${DAYS_JA[s.dayIndex]}曜 ${fmtTime(s.startMin)}〜${fmtTime(s.endMin)}`);
                    addToast("📧 開始時刻の通知をメールで送信しました");
                }
            }
        }, 60000);
        return () => clearInterval(timer);
    },[currentUser,notifyOwn,schedules]);

    function handleUserLogin(){
        // メールアドレスでユーザーを検索
        const entry = Object.entries(users).find(([,u]) => u.email === userLoginName);
        if(!entry){
            setUserLoginErr("メールアドレスまたはパスワードが違います");
            return;
        }
        const [uid, u] = entry;
        if(u.password !== userLoginPass){
            setUserLoginErr("メールアドレスまたはパスワードが違います");
            return;
        }
        setCurrentUser({uid, name:u.email, email:u.email});
        setShowUserLogin(false);
        setUserLoginName("");
        setUserLoginPass("");
        setUserLoginErr("");
        get(ref(db, DB_NOTIF_PATH + "/" + uid)).then(snap => {
            if(snap.exists()){
                const p = snap.val();
                setNotifyOwn(p.notifyOwn !== false);
                setNotifyOthers(p.notifyOthers !== false);
            } else {
                setShowNotifSetup(true);
            }
        });
    }

    async function handleNotifSetup(own, others){
        setNotifyOwn(own);
        setNotifyOthers(others);
        setShowNotifSetup(false);
        if(currentUser) await set(ref(db,DB_NOTIF_PATH + "/" + currentUser.uid), {notifyOwn:own, notifyOthers:others});
    }

    async function toggleNotif(type) {
        if(!currentUser) return;
        if(type === "own"){
            const v = !notifyOwn;
            setNotifyOwn(v);
            await set(ref(db,DB_NOTIF_PATH + "/" + currentUser.uid + "/notifyOwn"), v);
        } else {
            const v = !notifyOthers; setNotifyOthers(v);
            await set(ref(db, DB_NOTIF_PATH + "/" + currentUser.uid + "/notifyOthers"), v);
        }
    }

    function handleUserLogout(){
        setCurrentUser(null);
        notifiedSet.current.clear();
    }

    async function handleDeleteAccount(){
        if(deleteConfirm !== currentUser.email){
            setDeleteErr("メールアドレスが一致しません");
            return;
        }
        try {
            await set(ref(db, DB_USERS_PATH + "/" + currentUser.uid), null);
            await set(ref(db, DB_NOTIF_PATH + "/" + currentUser.uid), null);
            const updated = {...users};
            delete updated[currentUser.uid];
            setUsers(updated);
            setShowDeleteAccount(false);
            handleUserLogout();
        } catch(e){
            setDeleteErr("削除に失敗しました: " + e.message);
        }
    }

    async function handleRegister(){
        setRegErr("");
        setRegOk(false);
        const email = regEmail.trim();
        if(!email){
            setRegErr("メールアドレスを入力してください");
            return;
        }
        if(!/^[^@]+@[^@]+\.[^@]+$/.test(email)){
            setRegErr("正しいメールアドレスを入力してください");
            return;
        }
        if(regPass.length < 4){
            setRegErr("パスワードは4文字以上にしてください");
            return;
        }
        const already = Object.values(users).some(u => u.email === email);
        if(already){
            setRegErr("このメールアドレスはすでに登録されています");
            return;
        }
        setRegErr("登録中...");
        try {
            const uid = "u" + Date.now();
            const newUser = {password:regPass, email};
            await set(ref(db, DB_USERS_PATH + "/" + uid), newUser);
            const updated = {...users, [uid]: newUser};
            setUsers(updated);
            setRegOk(true);
            setRegErr("");
            setRegPass("");
            setRegEmail("");
        } catch(e) {
            setRegErr("登録に失敗しました: " + e.message);
        }
    }

    // イベント設定モーダルを開く（管理者専用）
    function openEventModal(dk) {
        const ev = events[dk] || {};
        setEventDateKey(dk);
        setEventName(ev.name || "");
        setEventBlock(ev.blockBooking || false);
        setShowEventModal(true);
    }

    // イベント設定を保存する
    async function handleSaveEvent() {
        setEventSaving(true);
        const updated = { ...events };
        if (eventName.trim()) {
            updated[eventDateKey] = { name: eventName.trim(), blockBooking: eventBlock };
        } else {
            delete updated[eventDateKey]; // 名前が空なら削除
        }
        await set(ref(db, DB_EVENT_PATH), updated);
        setEvents(updated);
        setEventSaving(false);
        setShowEventModal(false);
    }

    // イベントを削除する
    async function handleDeleteEvent() {
        const updated = { ...events };
        delete updated[eventDateKey];
        await set(ref(db, DB_EVENT_PATH), updated);
        setEvents(updated);
        setShowEventModal(false);
    }

    // カレンダーをCanvasに直接描画して画像として保存する
    async function handleCapture(){
        if(capturing) return;
        setCapturing(true);
        try {
            // レイアウト定数
            const FONT   = "'M PLUS Rounded 1c', 'Noto Sans JP', sans-serif";
            const W      = 1100;  // 画像の論理幅(px) PCコンテナ幅(maxWidth:1160)
            const SCALE  = 2;     // Retina 対応倍率
            const TLEFT  = 48;    // 時刻ラベル列幅
            const HEAD_H = 58;    // 曜日ヘッダー行高さ
            const CAL_H  = 600;   // カレンダー本体高さ
            const H      = HEAD_H + CAL_H;
            const COL_W  = (W - TLEFT) / 7; // 1列幅

            const canvas = document.createElement("canvas");
            canvas.width  = W * SCALE;
            canvas.height = H * SCALE;
            const ctx = canvas.getContext("2d");
            ctx.scale(SCALE, SCALE);

            // 背景
            ctx.fillStyle = isAdmin ? "#fffbeb" : "#f8f9ff";
            ctx.fillRect(0, 0, W, H);

            // カレンダーカード背景
            ctx.fillStyle = isAdmin ? "rgba(255,249,237,0.97)" : "rgba(255,255,255,0.97)";
            roundRect(ctx, 0, 0, W, H, 18);
            ctx.fill();

            // 時間軸の範囲
            const weekSch = schedules.filter(s => weekDates.some(d => dateKey(d) === s.dateKey));
            const vsH2 = Math.min(10, ...(weekSch.length ? weekSch.map(s => Math.floor(s.startMin/60)) : [10]));
            const veH2 = Math.max(20, ...(weekSch.length ? weekSch.map(s => Math.ceil(s.endMin/60))   : [20]));
            const VS2 = vsH2 * 60, VE2 = veH2 * 60, VT2 = VE2 - VS2;
            const pct2 = min => ((min - VS2) / VT2) * CAL_H; // 分 -> px (CAL_H基準)
            const allH2 = Array.from({length: veH2 - vsH2 + 1}, (_, i) => i + vsH2);
            const mjH2  = allH2.filter(h => h % 2 === 0);

            const today2 = new Date();
            const DAYS = ["火","水","木","金","土","日","月"];
            const colBorder = isAdmin ? "rgba(245,158,11,0.18)" : "rgba(108,99,255,0.12)";
            const headBg    = isAdmin ? "rgba(245,158,11,0.07)" : "rgba(108,99,255,0.05)";
            const todayBg   = isAdmin ? "rgba(245,158,11,0.08)" : "rgba(108,99,255,0.07)";
            const accentCol = isAdmin ? "#d97706" : "#6c63ff";

            // 曜日ヘッダー
            ctx.fillStyle = headBg;
            ctx.fillRect(0, 0, W, HEAD_H);
            ctx.strokeStyle = isAdmin ? "rgba(245,158,11,0.15)" : "rgba(108,99,255,0.09)";
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(0, HEAD_H); ctx.lineTo(W, HEAD_H); ctx.stroke();

            weekDates.forEach((dt, i) => {
                const x    = TLEFT + i * COL_W;
                const isT  = dateKey(dt) === dateKey(today2);
                const isSat = i === 4, isSun = i === 5;
                // 今日の列の背景
                if (isT){
                    ctx.fillStyle = todayBg;
                    ctx.fillRect(x, 0, COL_W, HEAD_H);
                }
                // 縦区切り線
                ctx.strokeStyle = colBorder;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, HEAD_H);
                ctx.stroke();
                // 曜日
                ctx.font = "800 16px " + FONT;
                ctx.textAlign = "center";
                ctx.fillStyle = isT ? accentCol : isSat ? "#3b82f6" : isSun ? "#ef4444" : "#2d2d3a";
                ctx.fillText(DAYS[i], x + COL_W / 2, 24);
                // 日付
                ctx.font = "600 10px " + FONT;
                ctx.fillStyle = "#b0b0c4";
                ctx.fillText((dt.getMonth() + 1) + "/" + dt.getDate(), x + COL_W / 2, 38);
                // TODAY バッジ
                if (isT) {
                    const bw = 40, bh = 14, bx = x + (COL_W / 2) - (bw / 2), by = 43;
                    ctx.fillStyle = isAdmin ? "#f59e0b" : "#6c63ff";
                    roundRect(ctx, bx, by, bw, bh, 7);
                    ctx.fill();
                    ctx.font = "800 8px " + FONT;
                    ctx.fillStyle = "#fff";
                    ctx.fillText("TODAY", x + (COL_W / 2), by + 10);
                }
            });

            // タイムライン本体
            // グリッド線
            allH2.forEach(h => {
                const y = HEAD_H + pct2(h * 60);
                const isMj = mjH2.includes(h);
                ctx.strokeStyle = isMj
                    ? (isAdmin ? "rgba(245,158,11,0.18)" : "rgba(108,99,255,0.14)")
                    : (isAdmin ? "rgba(245,158,11,0.08)" : "rgba(108,99,255,0.07)");
                ctx.lineWidth = isMj ? 1.5 : 1;
                ctx.beginPath();
                ctx.moveTo(TLEFT, y);
                ctx.lineTo(W, y);
                ctx.stroke();
                // 時刻ラベル
                if (h < veH2) {
                    ctx.font = (isMj ? "800 10px " : "500 9px ") + FONT;
                    ctx.textAlign = "right";
                    ctx.fillStyle = isMj ? (isAdmin ? "#d97706" : "#7c73ff") : "#d1d5db";
                    const tf = h === vsH2 ? HEAD_H + 10 : h === veH2 ? HEAD_H + pct2(h * 60) : HEAD_H + pct2(h * 60) + 4;
                    ctx.fillText(h + ":00", TLEFT - 5, tf);
                }
            });

            // 列の縦線 & 今日背景 & 予定ブロック
            weekDates.forEach((dt, i) => {
                const x  = TLEFT + i * COL_W;
                const dk = dateKey(dt);
                const isT = dk === dateKey(today2);
                // 今日の背景
                if (isT){
                    ctx.fillStyle = todayBg;
                    ctx.fillRect(x, HEAD_H, COL_W, CAL_H);
                }
                // 縦区切り線
                ctx.strokeStyle = colBorder;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, HEAD_H);
                ctx.lineTo(x, HEAD_H + CAL_H);
                ctx.stroke();
                // 予定ブロック
                const daySch = schedules.filter(s => s.dateKey === dk);
                daySch.forEach(s => {
                    const pal = colorFor(s.name);
                    const top  = HEAD_H + pct2(s.startMin);
                    const ht   = Math.max(pct2(s.endMin) - pct2(s.startMin), 14);
                    const bx   = x + 2, bw = COL_W - 4;
                    // ブロック背景
                    ctx.fillStyle = pal.bg;
                    roundRect(ctx, bx, top, bw, ht, 7);
                    ctx.fill();
                    // 名前
                    ctx.font = "800 13px " + FONT;
                    ctx.textAlign = "left";
                    ctx.fillStyle = pal.text;
                    ctx.save();
                    ctx.rect(bx, top, bw, ht); ctx.clip();
                    ctx.fillText(s.name, bx + 6, top + 15);
                    // 時刻
                    if (ht > 28) {
                        ctx.font = "500 10px " + FONT;
                        ctx.fillStyle = pal.text;
                        ctx.globalAlpha = 0.85;
                        ctx.fillText(fmtTime(s.startMin) + "〜" + fmtTime(s.endMin), bx + 6, top + 28);
                        ctx.globalAlpha = 1;
                    }
                    ctx.restore();
                });
            });

            // ファイル名
            const wd  = weekDates;
            const fn  = "schedule_" + wd[0].getFullYear() + "-" + (wd[0].getMonth() + 1) + "-" + wd[0].getDate() + "_" + wd[6].getFullYear() + "-" + (wd[6].getMonth() + 1) + "-" + wd[6].getDate() + ".png";
            const dataUrl = canvas.toDataURL("image/png");

            // iOS / Android: Web Share API で写真アプリへ直接保存
            const isIOS     = /iP(hone|ad|od)/.test(navigator.userAgent);
            const isAndroid = /Android/.test(navigator.userAgent);
            if ((isIOS || isAndroid) && navigator.share && navigator.canShare) {
                const res2 = await fetch(dataUrl);
                const blob = await res2.blob();
                const file = new File([blob], fn, {type: "image/png"});
                if (navigator.canShare({files: [file]})) {
                    await navigator.share({files: [file], title: "倉庫スケジュール"});
                    setCapturing(false);
                    return;
                }
            }
            // PC / share 非対応: 通常のダウンロード
            const a = document.createElement("a");
            a.href = dataUrl; a.download = fn; a.click();

        } catch(e) {
            if (e && e.name === "AbortError") {
                // ユーザーがshareシートをキャンセルした場合は何もしない
            } else {
                console.error("capture error:", e);
                alert("画像の保存に失敗しました。");
            }
        }
        setCapturing(false);
    }

    // Canvasに角丸矩形を描くヘルパー
    function roundRect(ctx, x, y, w, h, r){
        if(ctx.roundRect){
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, r);
        }
        else {
            ctx.beginPath();
            ctx.moveTo(x+r, y);
            ctx.lineTo(x+w-r, y); ctx.arcTo(x+w, y, x+w, y+r, r);
            ctx.lineTo(x+w, y+h-r); ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
            ctx.lineTo(x+r, y+h); ctx.arcTo(x, y+h, x, y+h-r, r);
            ctx.lineTo(x, y+r); ctx.arcTo(x, y, x+r, y, r);
            ctx.closePath();
        }
    }

    // 時間のセレクター用配列
    const hourRange = Array.from({length:11},(_,i) => (i + 10));
    // 分のセレクター用配列：管理者は 5 分刻み、一般は 15 分刻み
    const minuteSteps = isAdmin?Array.from({length:12},(_,i) => (i * 5)):[0, 10, 20, 30, 40, 50];

    // 既存スケジュールとの時間重複チェック
    function checkOverlapExisting(item, excludeId = null){
        return schedules.filter(s => s.id !== excludeId && s.dateKey === item.dateKey && s.startMin < item.endMin && s.endMin > item.startMin);
    }

    // 同一バッチ内との時間重複チェック
    function checkOverlapRows(item, rowId, pendingRows){
        return pendingRows.filter(r => r._id !== rowId && r.dateKey === item.dateKey && r.startMin < item.endMin && r.endMin > item.startMin && r.startMin !== undefined);
    }

    // 予定追加フォームを開く：フォーム表示状態をリセットして1行目を初期化
    function openAdd(){
        setShowForm(true);
        setGlobalWarn("");
        setBulkPin("");
        setRows([newRow(weekDates, isAdmin)]);
    }

    // 追加フォームに新しい行を追加する
    function addRow(){
        setRows(r => [...r,newRow(weekDates,isAdmin)]);
    }

    // 指定IDの行を追加フォームから削除する
    function removeRow(id){
        setRows(r => r.filter(x => x._id !== id));
    }

    // 追加フォームの1行の特定フィールドを更新
    function updateRow(id, key, val){
        setRows(r => r.map(x => {
            if(x._id !== id) return x;
            const updated = {...x, [key]:val, warn:"", forceOk:false};
            if(key === "startH"){
                // 開始時刻を変えたとき：終了が開始以下になる場合のみ終了を開始+2hに揃える
                if(+val >= updated.endH){ updated.endH = Math.min(+val + 2, 20); }
            }
            // endH / endM を変えたとき：開始時刻はそのまま（何もしない）
            return updated;
        }));
    }

    // PIN一括設定：bulkPinを全行に適用する
    function applyBulkPin(pin){
        setBulkPin(pin);
        if(/^\d{4}$/.test(pin)){
            // 4桁の数字が揃ったら全行のPINを一括更新する
            setRows(r => r.map(x => ({...x, pin:pin, warn:"", forceOk:false})));
        }
    }

    // 予定追加の実行処理
    // 1. 入力バリデーション (名前・時刻範囲・PIN 形式)
    // 2. 候補データ生成 (分単位の startMin / endMin を計算)
    // 3. 重複チェック (既存スケジュールおよびバッチ内の他行と照合)
    // 4. 問題なければfirebaseに保存
    async function handleAdd(){
        setGlobalWarn("");

        // 1. バリデーション：各行の必須入力・時刻範囲・PIN 形式を確認
        let anyErr = false;
        const validated = rows.map(row => {
        if(!row.name.trim()) return{...row, warn:"名前を入力してください"};
        const s = row.startH * 60 + row.startM, e = row.endH * 60 + row.endM;
        if(e <= s) return{...row,warn:"終了時間は開始時間より後にしてください"};
        if(!/^\d{4}$/.test(row.pin || "")) return{...row, warn:"4桁のPINを入力してください"};
        return row;
        });
        const hasFieldErr = validated.some(r => r.warn && r.warn !== "");
        if(hasFieldErr){
            setRows(validated);
            return;
        }

        // 2-a. イベント予約ブロックチェック（管理者は除く）
        if (!isAdmin) {
            for (const row of rows) {
                const dk = dateKey(weekDates[row.dayIndex]);
                const ev = events[dk];
                if (ev && ev.blockBooking) {
                    setGlobalWarn(DAYS_JA[row.dayIndex] + "（" + formatDate(weekDates[row.dayIndex]) + "）はイベント「" + ev.name + "」のため予約できません");
                    return;
                }
            }
        }

        // 2. 各行を Firebase 保存用オブジェクトに変換
        const candidates = rows.map(row => {
        const s = row.startH * 60 + row.startM, e=row.endH * 60 + row.endM;
        return{_id:row._id, name:row.name.trim(), dateKey:dateKey(weekDates[row.dayIndex]), dayIndex:row.dayIndex, startMin:s, endMin:e, pin:row.pin, color:row.color||''};
        });

        // 3. 重複チェック：既存スケジュールおよびバッチ内の他行と比較
        const withWarn = rows.map((row, i) => {
        const c = candidates[i];
        const ovEx = checkOverlapExisting(c);
        const ovRow = candidates.filter((cc, j) => j !== i && cc.dateKey === c.dateKey && cc.startMin < c.endMin && cc.endMin > c.startMin);
        const allOv = [...ovEx, ...ovRow];
        if(allOv.length > 0 && !row.forceOk){
            const msg = "重複あり：" + allOv.map(x => "「" + (x.name || "(他の行)") + "」(" + fmtTime(x.startMin) + "〜" + fmtTime(x.endMin) + ")").join("、");
            // 管理者の場合はforceOkをtrueにして強制追加を許可
            return{...row, warn:msg, forceOk:isAdmin};
        }
        return row;
        });

        const hasOverlapErr = withWarn.some(r => r.warn && !r.forceOk);
        if(hasOverlapErr){
            setRows(withWarn);
            if(!isAdmin) return; // 一般ユーザーは重複があれば保存不可
            // 管理者：全行に forceOk が設定されていれば次のクリックで保存できる
            const allForce = withWarn.every(r => !r.warn || (r.warn && r.forceOk));
            if(!allForce) return;
        }

        // 4. 全チェック通過 -> firebaseに保存
        setSaving(true);
        // idはDate.now()+インデックスで一意に
        const newItems = candidates.map((c, i) => {
            const id = Date.now() + i;
            if(c.color) customColorMap.set(id, {bg:c.color, text:textColorForBg(c.color)});
            return {id, name:c.name, dateKey:c.dateKey, dayIndex:c.dayIndex, startMin:c.startMin, endMin:c.endMin, pin:c.pin, color:c.color || ""};
        });
        const upd=[...schedules,...newItems];
        setSchedules(upd);
        await saveSch(upd);
        // 他ユーザーへのメール通知
        const addedBy = currentUser?currentUser.name:"（未ログイン）";
        for(const item of newItems){
            await notifyOtherUsers(addedBy, item);
        }
        setSaving(false);
        setShowForm(false);
        setRows([]);
        setGlobalWarn("");
        setBulkPin("");
    }

    // 管理者専用の強制追加：バリデーション・重複チェックをスキップして即保存する
    async function handleForceAdd(){
        setSaving(true);
        const newItems = rows.map((row, i) => {
        const s = row.startH * 60 + row.startM, e=row.endH * 60 + row.endM;
        return{id:Date.now()+i, name:row.name.trim(), dateKey:dateKey(weekDates[row.dayIndex]), dayIndex:row.dayIndex, startMin:s, endMin:e, pin:row.pin};
        });
        const upd=[...schedules, ...newItems];
        setSchedules(upd);
        await saveSch(upd);
        setSaving(false);
        setShowForm(false);
        setRows([]);
        setBulkPin("");
    }

    // 削除開始処理：
    // 管理者またはPIN未設定なら即削除、それ以外はPIN確認モーダルを開く
    function askDelete(s){
        setCtxMenu(null);
        setSelected(null);
        if(isAdmin || s.pin === null){
            doDelete(s.id);
            return;
        }
        setDeleteTarget(s);
        setDeletePinInput("");
        setDeletePinErr("");
    }

    // 指定IDの予定をfirebaseから削除する
    async function doDelete(id){
        const upd = schedules.filter(s => s.id !== id);
        setSchedules(upd);
        await saveSch(upd);
        setDeleteTarget(null);
        setSelected(null);
        setCtxMenu(null);
    }

    // PIN 確認付き削除：入力 PIN と予定の PIN を照合してから削除する
    function handleDeleteWithPin(){
        if(deletePinInput !== deleteTarget.pin){
            setDeletePinErr("PINが違います");
            return;
        }
        doDelete(deleteTarget.id);
    }

    // 編集モーダルを開く：対象予定の現在値をフォームに展開する
    // 管理者またはPIN未設定の場合はPIN確認ステップをスキップする
    function openEdit(s){
        setCtxMenu(null);
        setEditTarget(s);
        setEditWarn("");
        setForceEdit(false);
        setEditPinInput("");
        setEditPinErr("");
        setEditForm({name:s.name, dayIndex:s.dayIndex, startH:Math.floor(s.startMin/60), startM:s.startMin%60, endH:Math.floor(s.endMin/60), endM:s.endMin%60, pin:s.pin || ""});
        setEditPinOk(isAdmin || s.pin === null);
    }

    // 編集用 PIN 確認処理：入力 PIN が正しければ編集フォームを表示する
    function handleEditPinSubmit(){
        if(editPinInput !== editTarget.pin){
            setEditPinErr("PINが違います");
            return;
        }
        setEditPinOk(true);
        setEditPinErr("");
    }

    // 編集内容の保存処理：
    // 1. 名前・時刻バリデーション
    // 2. 重複チェック
    // 3. firebaseに保存
    async function handleEditSave(){
        const s = editForm.startH * 60 + editForm.startM, e = editForm.endH * 60 + editForm.endM;
        if(!editForm.name.trim()){
            setEditWarn("名前を入力してください");
            return;
        }
        if(e <= s){
            setEditWarn("終了時間は開始時間より後にしてください");
            return;
        }
        if(isAdmin && !/^\d{4}$/.test(editForm.pin || "")){
            setEditWarn("PINは4桁の数字で入力してください");
            return;
        }
        // PIN更新：管理者はフォーム値、一般ユーザーは有効な入力値があれば更新
        const newPin = isAdmin?editForm.pin:(editForm.pin && /^\d{4}$/.test(editForm.pin)?editForm.pin:editTarget.pin);
        const upd={...editTarget, name:editForm.name.trim(), dayIndex:editForm.dayIndex, dateKey:dateKey(weekDates[editForm.dayIndex]), startMin:s, endMin:e, pin:newPin};
        // 重複チェック
        const ov = schedules.filter(x => x.id !== editTarget.id && x.dateKey === upd.dateKey && x.startMin < upd.endMin && x.endMin > upd.startMin);
        if(ov.length && !forceEdit){
            setEditWarn("重複あり：" + ov.map(x => "「" + x.name + "」(" + fmtTime(x.startMin) + "〜" + fmtTime(x.endMin) + ")").join("、"));
            if(isAdmin)setForceEdit(true); // 管理者は次回クリックで強制保存
            return;
        }
        // firebaseに保存
        setSaving(true);
        const list=schedules.map(x => x.id === editTarget.id?upd:x);
        setSchedules(list);
        await saveSch(list);
        setSaving(false);
        setEditTarget(null);
        setEditForm(null);
        setForceEdit(false);
    }

    // カレンダー描画のための計算
    // 管理者モード: 表示週のスケジュールに合わせて時間軸範囲を動的に絞る
    const viewSch = isAdmin?schedules.filter(s => weekDates.some(d => dateKey(d) === s.dateKey)):[];
    // vsH: 表示開始時 veH: 表示終了時
    const vsH = isAdmin?Math.min(10, ...(viewSch.length?viewSch.map(s => Math.floor(s.startMin / 60)):[10])):10;
    const veH = isAdmin?Math.max(20, ...(viewSch.length?viewSch.map(s => Math.ceil(s.endMin / 60)):[20])):20;
    const VS = vsH * 60, VE = veH * 60, VT = VE - VS; // 表示範囲の開始分・終了分・合計分

    // 分を時間軸上の%位置に変換する関数
    const pct = min => ((min - VS) / VT) * 100;

    // カレンダー本体の高さは.cal-bodyクラスで制御する
    const calH = "100%";

    // 時間軸に描画するすべての時間ラベル配列
    const allH = Array.from({length:veH - vsH + 1}, (_,i) => i + vsH);
    // 偶数時間のみ太いグリッド線を引く
    const mjH = allH.filter(h => h % 2 === 0);

    // 追加フォームに強制追加可能な行が1件以上あるか
    const hasForceRows = rows.some(r => r.warn && r.forceOk);

    return(
        // 管理者モードに応じてページ背景グラデーションを切り替える
        <div style = {{minHeight:"100vh", background:isAdmin?"linear-gradient(160deg,#fffbeb 0%,#fef3c7 40%,#fff7ed 100%)":"linear-gradient(160deg,#f8f9ff 0%,#eef2ff 50%,#fdf0ff 100%)", fontFamily:"'M PLUS Rounded 1c','Noto Sans JP',sans-serif", transition:"background 0.4s"}}>

        {/* 背景の装飾用ぼかし円（pointer-events:none でクリックに干渉しない） */}
        <div style = {{position:"fixed", inset:0, overflow:"hidden", zIndex:0, pointerEvents:"none"}}>
            {isAdmin?<>
            <div style = {{position:"absolute", width:400, height:400, borderRadius:"50%", background:"rgba(245,158,11,0.07)", filter:"blur(50px)", top:-100, right:-80}}/>
            <div style = {{position:"absolute", width:300, height:300, borderRadius:"50%", background:"rgba(251,191,36,0.05)", filter:"blur(50px)", bottom:60, left:-60}}/>
            </>:<>
            <div style = {{position:"absolute", width:400, height:400, borderRadius:"50%", background:"rgba(108,99,255,0.07)", filter:"blur(50px)", top:-100, right:-80}}/>
            <div style = {{position:"absolute", width:300, height:300, borderRadius:"50%", background:"rgba(255,101,132,0.06)", filter:"blur(50px)", bottom:60, left:-60}}/>
            </>}
        </div>

        <div style = {{maxWidth:1160, margin:"0 auto", padding:"20px 14px", position:"relative", zIndex:1}}>

            {/* ヘッダー：アイコン・タイトル・表示週範囲 */}
            <div style = {{marginBottom:18}}>
            <div style = {{display:"flex", alignItems:"center", gap:10, marginBottom:10, flexWrap:"wrap"}}>
                {/* アイコンバッジ (icon.png を表示。管理者モードで枠色を変更) */}
                <div style = {{width:42, height:42, borderRadius:12, flexShrink:0, overflow:"hidden", outline:isAdmin?"2.5px solid #f59e0b":"2.5px solid #a855f7", outlineOffset:"1px", boxShadow:isAdmin?"0 3px 14px rgba(245,158,11,0.30)":"0 3px 14px rgba(108,99,255,0.30)", background:"#fff", cursor:"pointer"}} onClick={()=>setShowHowto(true)} onContextMenu={e => {e.preventDefault();setShowHowto(true);}}>
                    <img src = "icon.png" alt="P研" style={{width:"100%", height:"100%", objectFit:"cover", display:"block"}}/>
                </div>
                <div style = {{flex:1, minWidth:0}}>
                <div style = {{display:"flex", alignItems:"center", gap:7, flexWrap:"wrap"}}>
                    <h1 style = {{fontSize:20, fontWeight:800, color:"#2d2d3a", letterSpacing:"-0.4px"}}>[P研] 倉庫スケジュール</h1>
                    {isAdmin && <span className="adm-b">管理者モード</span>}
                </div>
                {/* 表示中の週範囲を表示 */}
                <p style = {{fontSize:11, color:"#9ca3af", marginTop:1, fontWeight:500}}>
                    {isAdmin?weekDates[0].getFullYear() + "/" + formatDate(weekDates[0]) + "（火）〜 " + weekDates[6].getFullYear() + "/" + formatDate(weekDates[6]) + "（月）":formatDate(weekDates[0]) + "（火）〜 " + formatDate(weekDates[6])+"（月）"}
                </p>
                </div>
            </div>

            {/* 操作ボタン行：週ナビ・更新・追加・PW変更・ログアウト/管理 */}
            <div className = "btn-scroll-wrap" style = {{display:"flex", gap:6, flexWrap:"wrap", alignItems:"center"}}>
                {isAdmin && <>
                {/* 管理者専用：週ナビゲーションボタン（前後1ヶ月＋予定がある週まで） */}
                <button className = "wkbtn" disabled = {weekOffset <= minWeekOffset} onClick = {() => setWeekOffset(w => Math.max(w - 1, minWeekOffset))}>◀ 前週</button>
                <button className = "wkbtn" style = {{background:weekOffset === 0?"rgba(245,158,11,0.18)":"rgba(245,158,11,0.09)"}} onClick = {() => setWeekOffset(0)}>今週</button>
                <button className = "wkbtn" disabled = {weekOffset >= maxWeekOffset} onClick = {() => setWeekOffset(w => Math.min(w + 1, maxWeekOffset))}>次週 ▶</button>
                <div style = {{width:1, height:24, background:"rgba(245,158,11,0.25)", margin:"0 2px"}}/>
                </>}
                {/* Firebase からデータを再取得する更新ボタン */}
                <button className = {"btn btn-sm " + (isAdmin?"btn-ghost-amber":"btn-ghost")} onClick = {load}>更新</button>
                {/* カレンダーを画像として保存するボタン */}
                <button className = {"btn btn-sm " + (isAdmin?"btn-ghost-amber":"btn-ghost")} onClick={handleCapture} disabled = {capturing}>{capturing?"保存中...":"画像保存"}</button>
                {/* 予定追加フォームを開くボタン */}
                <button className = {"btn btn-sm " + (isAdmin?"btn-amber":"btn-purple")} onClick = {openAdd}>+ 予定を追加</button>
                {isAdmin?<>
                <button className = "btn btn-sm btn-ghost-amber" onClick = {() => openEventModal(dateKey(weekDates[0]))}>イベント設定</button>
                <button className = "btn btn-sm btn-ghost-amber" onClick = {() => {setShowPassChange(true); setPassErr(""); setPassOk(false); setPassOld(""); etPassNew(""); setPassNew2("");}}>PW変更</button>
                <button className = "btn btn-sm btn-ghost-amber" onClick = {handleLogout}>通常モード</button>
                </>:<button className = "btn btn-sm btn-ghost" onClick = {() => {setShowLogin(true); setLoginErr(""); setLoginInput("");}}>管理</button>}
                <div style = {{width:1, height:22, background:"rgba(108,99,255,0.18)", margin:"0 2px"}}/>
                {currentUser?(<>
                    <span style = {{fontSize:12, fontWeight:700, color:"#2d2d3a", padding:"4px 9px", borderRadius:8, background:isAdmin?"rgba(245,158,11,0.12)":"rgba(108,99,255,0.07)", border:"1px solid " + (isAdmin?"rgba(245,158,11,0.30)":"rgba(108,99,255,0.15)")}}>{currentUser.email || currentUser.name}</span>
                    <button className = {"btn btn-sm " + (isAdmin?"btn-ghost-amber":"btn-ghost")} onClick = {() => setShowNotifSetup(true)}>通知設定</button>
                    <button className = {"btn btn-sm " + (isAdmin?"btn-ghost-amber":"btn-ghost")} onClick = {handleUserLogout}>退出</button>
                    <button className = {"btn btn-sm " + (isAdmin?"btn-ghost-amber":"btn-ghost")} onClick = {() => {setShowDeleteAccount(true); setDeleteConfirm(""); setDeleteErr("");}}>登録解除</button>
                </>):(
                    <><button className = {"btn btn-sm " + (isAdmin?"btn-ghost-amber":"btn-ghost")} onClick = {() => {setShowUserLogin(true); setUserLoginErr(""); setUserLoginName(""); setUserLoginPass("");}}>ログイン</button>
                    <button className = {"btn btn-sm " + (isAdmin?"btn-ghost-amber":"btn-ghost")} onClick = {() => {setShowRegister(true); setRegErr(""); setRegOk(false); setRegPass(""); setRegEmail("");}}>新規登録</button></>
                )}
            </div>
            </div>

            {/* カレンダー本体 */}
            <div ref = {captureRef} className = {isAdmin?"admin-glass":"glass"} style = {{borderRadius:18}}>
            {/* overflowX:autoでスマホの横スクロールを有効にする */}
            <div style = {{overflowX:"auto", WebkitOverflowScrolling:"touch"}}>
                {/* minWidth:520でスマホでも7列のレイアウトを崩さない */}
                <div style = {{minWidth:520}}>

                {/* 曜日ヘッダー行：火 ~ 月の7列 */}
                <div style = {{display:"flex", background:isAdmin?"linear-gradient(135deg,rgba(245,158,11,0.07),rgba(217,119,6,0.03))":"linear-gradient(135deg,rgba(108,99,255,0.05),rgba(168,85,247,0.03))", borderBottom:isAdmin?"1px solid rgba(245,158,11,0.15)":"1px solid rgba(108,99,255,0.09)"}}>
                    {/* 時刻ラベル列の幅確保用スペーサー */}
                    <div style = {{width:48, flexShrink:0}}/>
                    {weekDates.map((dt, i) => {
                    const isT = dateKey(dt) === dateKey(today), isSat = i === 4, isSun = i === 5;
                    return(<div key = {i} style = {{flex:1, textAlign:"center", padding:"11px 3px", borderLeft:isAdmin?"1px solid rgba(245,158,11,0.10)":"1px solid rgba(108,99,255,0.07)", background:isT?(isAdmin?"rgba(245,158,11,0.07)":"rgba(108,99,255,0.06)"):"transparent"}}>
                        {/* 今日は強調色、土曜は青、日曜は赤で表示 */}
                        <div style = {{fontSize:16, fontWeight:800, color:isT?(isAdmin?"#d97706":"#6c63ff"):isSat?"#3b82f6":isSun?"#ef4444":"#2d2d3a"}}>{DAYS_JA[i]}</div>
                        <div style = {{fontSize:10, color:"#b0b0c4", fontWeight:600, marginTop:1}}>{formatDate(dt)}</div>
                        {isT && <div style = {{marginTop:3}}><span className="today-b">TODAY</span></div>}
                        {/* イベントバナー：イベントが設定されている日に表示 */}
                        {events[dateKey(dt)] && <div style = {{marginTop:3, padding:"2px 4px", borderRadius:5, background: events[dateKey(dt)].blockBooking?"rgba(239,68,68,0.12)":"rgba(108,99,255,0.10)", border:"1px solid " + (events[dateKey(dt)].blockBooking?"rgba(239,68,68,0.30)":"rgba(108,99,255,0.22)")}}>
                            <div style = {{fontSize:9, fontWeight:800, color:events[dateKey(dt)].blockBooking?"#dc2626":"#6c63ff", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:"100%"}}>
                                {events[dateKey(dt)].name}
                            </div>
                            {events[dateKey(dt)].blockBooking && <div style = {{fontSize:8, color:"#ef4444", fontWeight:700}}>予約不可</div>}
                        </div>}
                        {/* 管理者：クリックしてイベント設定を開く */}
                        {isAdmin && <div style = {{fontSize:8, color:"#d97706", fontWeight:600, marginTop:2, cursor:"pointer", opacity:0.7}} onClick = {e => {e.stopPropagation(); openEventModal(dateKey(dt));}}>⚙ イベント設定</div>}
                    </div>);
                    })}
                </div>

                {/* タイムライン本体：読み込み中はメッセージを表示 */}
                {loading?<div style = {{textAlign:"center", padding:"48px 0", color:"#b0b0c4", fontWeight:600}}>読み込み中...</div>:(
                    <div className = "cal-body" style = {{display:"flex"}}>

                    {/* 時刻ラベル列 (左端 48px) overflow:visibleで上下端ラベルが切れないようにする */}
                    <div style = {{width:48, flexShrink:0, position:"relative", height:calH, overflow:"visible"}}>
                        {allH.map(h => {
                            // 最上端・最下端のラベルはtransformを調整してはみ出しを防ぐ
                            const isFirst = h === vsH, isLast = h === veH;
                            const tf = isFirst?"translateY(0)":isLast?"translateY(-100%)":"translateY(-50%)";
                            return <div key = {h} style = {{position:"absolute", top:pct(h*60)+"%", right:7, transform:tf, fontSize:mjH.includes(h)?10:9, fontWeight:mjH.includes(h)?800:500, color:mjH.includes(h)?(isAdmin?"#d97706":"#7c73ff"):"#d1d5db"}}>{h}:00</div>;
                        })}
                    </div>

                    {/* 7列の曜日カラム */}
                    {weekDates.map((dt,dayIdx) => {
                        const dk = dateKey(dt);
                        const daySch = schedules.filter(s => s.dateKey === dk); // その日の予定一覧
                        const isT = dk === dateKey(today);
                        return(<div key={dayIdx} className = "day-col" style = {{height:calH, background:isT?(isAdmin?"rgba(245,158,11,0.022)":"rgba(108,99,255,0.020)"):"transparent", borderLeft:isAdmin?"1px solid rgba(245,158,11,0.08)":"1px solid rgba(108,99,255,0.07)"}}>

                        {/* 時間グリッド線：偶数時間は太線（gl-mj）、奇数時間は細線（gl-mn） */}
                        {allH.map(h => <div key = {h} className = {mjH.includes(h)?"gl-mj":"gl-mn"} style = {{top:pct(h * 60) + "%", background:mjH.includes(h)?(isAdmin?"rgba(245,158,11,0.13)":"rgba(108,99,255,0.10)"):(isAdmin?"rgba(245,158,11,0.06)":"rgba(108,99,255,0.05)")}}/>)}

                        {/* 予定ブロック：上位置・高さをpct()でパーセント指定 */}
                        {daySch.map(s => {
                            const pal = colorFor(s.name,s.id);
                            const top = pct(s.startMin), ht=pct(s.endMin)-top;
                            return(<div key = {s.id} className = "blk ba" style = {{top:top + "%", height:Math.max(ht, 3.5) + "%", background:"linear-gradient(160deg," + pal.bg + "f0," + pal.bg + "c8)", boxShadow:"0 2px 10px " + pal.bg + "45"}}
                            // 左クリック / タップ：詳細モーダルを開く
                            onClick = {() => {setSelected(s); setCtxMenu(null);}}
                            // 右クリック：コンテキストメニューを開く
                            onContextMenu = {e => {e.preventDefault(); e.stopPropagation(); setSelected(null); setCtxMenu({x:e.clientX, y:e.clientY,s});}}>
                            <div style = {{fontWeight:800, fontSize:14, color:pal.text, lineHeight:1.3, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{s.name}</div>
                            {/* ブロックが十分な高さ(5%以上)のとき時刻を表示 */}
                            {ht>5&&<div style = {{fontSize:11, color:pal.text,opacity:0.85, marginTop:2}}>{fmtTime(s.startMin)}〜{fmtTime(s.endMin)}</div>}
                            </div>);
                        })}
                        </div>);
                    })}
                    </div>
                )}
                </div>
            </div>
            </div>

            {/* 操作ヒントテキスト：タッチデバイスとPCで文言を変える */}
            <p style = {{textAlign:"center", fontSize:11, color:"#c4c4d4", marginTop:10, fontWeight:500}}>
                {'ontouchstart' in window
                    ? "タッチで詳細・編集・削除"
                    : "左クリックで詳細 / 右クリックで編集・削除"}
            </p>
        </div>

        {/* ユーザーログインモーダル */}
        {showUserLogin && <div className = "overlay" onClick = {e => {if(e.target === e.currentTarget) setShowUserLogin(false);}}>
            <div className = "modal" style = {{maxWidth:320}}>
            <div className = "drag-bar"/>
            <h2 style = {{fontSize:16, fontWeight:800, color:"#2d2d3a", marginBottom:4}}>ログイン</h2>
            <p style = {{fontSize:11, color:"#9ca3af", marginBottom:14}}>アカウントにログインして通知機能を使えます</p>
            {userLoginErr && <div className = "wbox" style = {{marginBottom:10, fontSize:12}}>{userLoginErr}</div>}
            <div style = {{display:"flex", flexDirection:"column", gap:10, marginBottom:14}}>
                <div><label className = "lbl">メールアドレス</label>
                <input className = "inp" type = "email" value = {userLoginName} onChange = {e => {setUserLoginName(e.target.value);setUserLoginErr("");}} autoFocus/></div>
                <div><label className = "lbl">パスワード</label>
                <input className = "inp" type = "password" autoComplete = "current-password" value = {userLoginPass} onChange = {e => {setUserLoginPass(e.target.value); setUserLoginErr("");}} onKeyDown = {e => e.key === "Enter" && handleUserLogin()}/></div>
            </div>
            <div style = {{display:"flex", gap:8, justifyContent:"flex-end"}}>
                <button className = "btn btn-ghost" onClick = {() => setShowUserLogin(false)}>キャンセル</button>
                <button className = "btn btn-purple" onClick = {handleUserLogin}>ログイン</button>
            </div>
            </div>
        </div>}

        {/* 初回ログイン：通知設定モーダル */}
        {showNotifSetup && <div className = "overlay" onClick = {e => {if(e.target === e.currentTarget) setShowNotifSetup(false);}}>
            <div className = "modal" style = {{maxWidth:390}}>
            <h2 style = {{fontSize:16, fontWeight:800, color:"#2d2d3a", marginBottom:6}}>通知設定</h2>
            <p style = {{fontSize:11, color:"#9ca3af", marginBottom:16}}>受け取る通知をON/OFFで切り替えられます。</p>
            <div style = {{display:"flex", flexDirection:"column", gap:12, marginBottom:20}}>
                {[
                    {key:"own",   label:"自分の予定の時刻通知",desc:"予定の1時間前・開始時刻にメールが届きます"},
                    {key:"others",label:"予定追加の通知",      desc:"誰かが予定を追加したときにメールが届きます"},
                ].map(item => {
                    const val = item.key === "own"?notifyOwn:notifyOthers;
                    const set2 = item.key === "own"?setNotifyOwn:setNotifyOthers;
                    return(
                    <div key = {item.key} onClick = {() => set2(v => !v)}
                        style = {{display:"flex", alignItems:"center", gap:14, padding:"13px 14px", borderRadius:12,
                        border:"1.5px solid " + (val?"#6c63ff":"rgba(108,99,255,0.15)"),
                        background:val?"rgba(108,99,255,0.04)":"transparent",cursor:"pointer"}}>
                        <div style = {{width:42, height:24, borderRadius:12, background:val?"#6c63ff":"#d1d5db", position:"relative", flexShrink:0, transition:"background 0.2s"}}>
                            <div style = {{position:"absolute", top:3, left:val?20:3, width:18, height:18, borderRadius:"50%", background:"#fff", transition:"left 0.2s"}}/>
                        </div>
                        <div>
                            <div style = {{fontSize:13, fontWeight:700, color:"#2d2d3a"}}>{item.label}<span style = {{fontSize:11, fontWeight:500, color:val?"#6c63ff":"#9ca3af", marginLeft:8}}>{val?"ON":"OFF"}</span></div>
                            <div style = {{fontSize:11, color:"#9ca3af", marginTop:2}}>{item.desc}</div>
                        </div>
                    </div>);
                })}
            </div>
            <div style = {{display:"flex", gap:8, justifyContent:"flex-end"}}>
                <button className = "btn btn-ghost" onClick = {() => setShowNotifSetup(false)}>閉じる</button>
                <button className = "btn btn-purple" onClick = {() => handleNotifSetup(notifyOwn, notifyOthers)}>保存</button>
            </div>
            </div>
        </div>}

        {/* 新規ユーザー登録モーダル */}
        {showRegister && <div className = "overlay" onClick = {e => {if(e.target === e.currentTarget) setShowRegister(false);}}>
            <div className = "modal" style = {{maxWidth:380}}>
            <div className = "drag-bar"/>
            <h2 style = {{fontSize:16, fontWeight:800, color:"#2d2d3a", marginBottom:4}}>新規登録</h2>
            <p style = {{fontSize:11, color:"#9ca3af", marginBottom:14}}>アカウントを作成してログインできるようになります。</p>
            {regErr && <div className = "wbox-a" style = {{marginBottom:10, fontSize:12}}>{regErr}</div>}
            {regOk && <div className = "sbox" style = {{marginBottom:10, fontSize:12}}>ユーザーを登録しました。</div>}
            <div style = {{display:"flex", flexDirection:"column", gap:10, marginBottom:14}}>
                <div><label className = "lbl">メールアドレス</label>
                <input className = "inp-a" type = "email" placeholder = "例: user@gmail.com" value = {regEmail} autoFocus onChange = {e => {setRegEmail(e.target.value); setRegErr(""); setRegOk(false);}}/></div>
                <div><label className = "lbl">パスワード（4文字以上）</label>
                <input className = "inp-a" type = "password" autoComplete = "new-password" value = {regPass} onChange = {e => {setRegPass(e.target.value); setRegErr(""); setRegOk(false);}} onKeyDown={e=>e.key==="Enter"&&handleRegister()}/></div>
            </div>
            <div style = {{display:"flex", gap:8, justifyContent:"flex-end"}}>
                <button className = "btn btn-ghost" onClick = {() => setShowRegister(false)}>閉じる</button>
                <button className = "btn btn-purple" onClick = {handleRegister}>登録する</button>
            </div>
            </div>
        </div>}

        {/* 登録解除確認モーダル */}
        {showDeleteAccount && <div className = "overlay" onClick = {e => {if (e.target === e.currentTarget) setShowDeleteAccount(false);}}>
            <div className = "modal" style = {{maxWidth: 360}}>
            <h2 style = {{fontSize: 16, fontWeight: 800, color: "#ef4444", marginBottom: 4}}>登録解除</h2>
            <p style = {{fontSize: 12, color: "#6b7280", marginBottom: 14}}>アカウントを削除します。この操作は取り消せません。<br/></p>
            {deleteErr && <div className = "wbox" style = {{marginBottom: 10, fontSize: 12}}>{deleteErr}</div>}
            <div style = {{marginBottom: 14}}>
                <label className = "lbl">メールアドレス（確認）</label>
                <input className = "inp" type = "email" placeholder = {currentUser?.email} value = {deleteConfirm}
                    onChange = {e => {setDeleteConfirm(e.target.value); setDeleteErr("");}}
                    onKeyDown = {e => e.key === "Enter" && handleDeleteAccount()}/>
            </div>
            <div style = {{display: "flex", gap: 8, justifyContent: "flex-end"}}>
                <button className = "btn btn-ghost" onClick = {() => setShowDeleteAccount(false)}>キャンセル</button>
                <button className = "btn" style = {{background: "#ef4444", color: "#fff", border: "none", borderRadius: 10, padding: "8px 18px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit"}} onClick = {handleDeleteAccount}>削除する</button>
            </div>
            </div>
        </div>}

        {/* 使い方モーダル */}
        {showHowto && <div className = "overlay" onClick = {e => {if (e.target === e.currentTarget) setShowHowto(false);}} style = {{alignItems: "center", justifyContent: "center"}}>
            <div className = "modal" style = {{maxWidth: 680, position: "relative", padding: "28px 24px 24px"}}>
                {/* 閉じるボタン */}
                <button onClick = {() => setShowHowto(false)} style = {{position: "absolute", top: 14, right: 14, width: 32, height: 32, borderRadius: "50%", border: "none", background: "rgba(108,99,255,0.08)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#6c63ff", fontWeight: 900, fontFamily: "inherit", lineHeight: 1, flexShrink: 0}}>×</button>
                <h2 style = {{fontSize: 16, fontWeight: 800, color: "#2d2d3a", marginBottom: 16, paddingRight: 32}}>使い方ガイド</h2>
                <pre style = {{whiteSpace: "pre-wrap", fontFamily: "'M PLUS Rounded 1c',sans-serif", fontSize: 13, lineHeight: 1.8, color: "#374151", overflowY: "auto", overflowX: "auto", maxHeight: "65vh", margin: 0}}>{howtoText || "読み込み中..."}</pre>
            </div>
        </div>}

        {/* ── イベント設定モーダル（管理者専用） ── */}
        {showEventModal && <div className = "overlay" onClick = {e => {if(e.target === e.currentTarget) setShowEventModal(false);}}>
            <div className = "modal" style = {{maxWidth:380}}>
            <div className = "drag-bar"/>
            <h2 style = {{fontSize:16, fontWeight:800, color:"#2d2d3a", marginBottom:4}}>イベント設定</h2>
            <p style = {{fontSize:11, color:"#9ca3af", marginBottom:14}}>{eventDateKey} の日のイベントを設定します。</p>
            <div style = {{display:"flex", flexDirection:"column", gap:12, marginBottom:16}}>
                <div>
                    <label className = "lbl">イベント名（空欄で削除）</label>
                    <input className = "inp-a" placeholder = "例：P研定期発表会" value = {eventName}
                        onChange = {e => setEventName(e.target.value)}
                        onKeyDown = {e => e.key === "Enter" && handleSaveEvent()}
                        autoFocus/>
                </div>
                <div onClick = {() => setEventBlock(v => !v)}
                    style = {{display:"flex", alignItems:"center", gap:14, padding:"13px 14px", borderRadius:12,
                    border:"1.5px solid " + (eventBlock?"#ef4444":"rgba(108,99,255,0.15)"),
                    background:eventBlock?"rgba(239,68,68,0.04)":"transparent", cursor:"pointer"}}>
                    <div style = {{width:42, height:24, borderRadius:12, background:eventBlock?"#ef4444":"#d1d5db", position:"relative", flexShrink:0, transition:"background 0.2s"}}>
                        <div style = {{position:"absolute", top:3, left:eventBlock?20:3, width:18, height:18, borderRadius:"50%", background:"#fff", transition:"left 0.2s"}}/>
                    </div>
                    <div>
                        <div style = {{fontSize:13, fontWeight:700, color:"#2d2d3a"}}>予約ブロック<span style = {{fontSize:11, fontWeight:500, color:eventBlock?"#ef4444":"#9ca3af", marginLeft:8}}>{eventBlock?"ON（予約不可）":"OFF（予約可能）"}</span></div>
                        <div style = {{fontSize:11, color:"#9ca3af", marginTop:2}}>ONにすると一般ユーザーがその日に予定を追加できなくなります</div>
                    </div>
                </div>
            </div>
            <div style = {{display:"flex", gap:8, justifyContent:"flex-end"}}>
                {events[eventDateKey] && <button className = "btn" style = {{background:"#fee2e2", color:"#dc2626", border:"none", borderRadius:9, padding:"7px 14px", fontWeight:700, cursor:"pointer", fontFamily:"inherit", fontSize:12}} onClick = {handleDeleteEvent}>削除</button>}
                <button className = "btn btn-ghost" onClick = {() => setShowEventModal(false)}>キャンセル</button>
                <button className = "btn btn-amber" onClick = {handleSaveEvent} disabled = {eventSaving}>{eventSaving?"保存中...":"保存"}</button>
            </div>
            </div>
        </div>}

        {/* トースト通知 */}
        <div style = {{position: "fixed", bottom: 20, right: 16, zIndex: 3000, display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end", pointerEvents: "none"}}>
            {toastList.map(t => (
                <div key = {t.id} style = {{background: "rgba(45,45,58,0.92)", color: "#fff", borderRadius: 12, padding: "10px 16px", fontSize: 13, fontWeight: 600, boxShadow: "0 4px 20px rgba(0,0,0,0.25)", maxWidth: 280, lineHeight: 1.5}}>
                    {t.msg}
                </div>
            ))}
        </div>

        {/* 管理者ログインモーダル */}
        {showLogin && <div className = "overlay" onClick = {e => {if (e.target === e.currentTarget) setShowLogin(false);}}>
            <div className = "modal" style = {{maxWidth: 320}}>
            <div className = "drag-bar"/>
            <h2 style = {{fontSize: 16, fontWeight: 800, color: "#2d2d3a", marginBottom: 14}}>管理者ログイン</h2>
            {loginErr && <div className = "wbox" style = {{marginBottom: 10, fontSize: 12}}>{loginErr}</div>}
            <div style = {{marginBottom: 14}}>
                <label className = "lbl">パスワード</label>
                {/* onKeyDown で Enter キーによるログインも受け付ける */}
                <input className = "inp-a" type = "password" autoComplete = "current-password" value = {loginInput} onChange = {e => {setLoginInput(e.target.value); setLoginErr("");}} onKeyDown = {e => e.key === "Enter" && handleLogin()} autoFocus/>
            </div>
            <div style = {{display: "flex", gap: 8, justifyContent: "flex-end"}}>
                <button className = "btn btn-ghost" onClick = {() => setShowLogin(false)}>キャンセル</button>
                <button className = "btn btn-amber" onClick = {handleLogin}>ログイン</button>
            </div>
            </div>
        </div>}

        {/* パスワード変更モーダル */}
        {showPassChange && <div className = "overlay" onClick = {e => {if (e.target === e.currentTarget) setShowPassChange(false);}}>
            <div className = "modal" style = {{maxWidth: 360}}>
            <div className = "drag-bar"/>
            <h2 style = {{fontSize: 16, fontWeight: 800, color: "#2d2d3a", marginBottom: 4}}>パスワードを変更</h2>
            <p style = {{fontSize: 11, color: "#9ca3af", marginBottom: 14}}>管理者ログインに使用するパスワードを変更します。</p>
            {passErr && <div className = "wbox-a" style = {{marginBottom: 10, fontSize: 12}}>{passErr}</div>}
            {passOk && <div className = "sbox" style = {{marginBottom: 10, fontSize: 12}}>パスワードを変更しました。</div>}
            <div style = {{display: "flex", flexDirection: "column", gap: 10}}>
                <div><label className = "lbl">現在のパスワード</label><input className = "inp-a" type = "password" value = {passOld} onChange = {e => {setPassOld(e.target.value); setPassErr(""); setPassOk(false);}} autoFocus/></div>
                <div style = {{borderTop: "1px solid rgba(245,158,11,0.15)", paddingTop: 10}}>
                <div style = {{marginBottom: 10}}><label className = "lbl">新しいパスワード（6文字以上）</label><input className = "inp-a" type = "password" value = {passNew} onChange = {e => {setPassNew(e.target.value); setPassErr(""); setPassOk(false);}}/></div>
                {/* Enter キーで変更を保存 */}
                <div><label className = "lbl">確認</label><input className = "inp-a" type = "password" value = {passNew2} onChange = {e => {setPassNew2(e.target.value); setPassErr(""); setPassOk(false);}} onKeyDown = {e => e.key === "Enter" && handlePassChange()}/></div>
                </div>
            </div>
            {/* 初期パスワードリセット */}
            <div style = {{borderTop: "1px dashed rgba(245,158,11,0.25)", paddingTop: 12, marginTop: 14}}>
                <p style = {{fontSize: 11, color: "#9ca3af", marginBottom: 8}}>※ 現在のパスワード入力なしで実行できます</p>
                <button className = "btn btn-sm btn-ghost-amber" style = {{width: "100%"}} onClick = {handleResetPass}>初期パスワードに戻す</button>
            </div>
            <div style = {{display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14}}>
                <button className = "btn btn-ghost" onClick = {() => setShowPassChange(false)}>閉じる</button>
                <button className = "btn btn-amber" onClick = {handlePassChange}>変更を保存</button>
            </div>
            </div>
        </div>}

        {/* 右クリックコンテキストメニュー 画面端に収まるよう座標を補正 */}
        {ctxMenu && (() => {
            const pal = colorFor(ctxMenu.s.name);
            // ウィンドウ右端・下端にはみ出さないようx/yを補正する
            const x = Math.min(ctxMenu.x, window.innerWidth - 185), y = Math.min(ctxMenu.y, window.innerHeight - 140);
            return (<div ref = {ctxRef} className = "ctx" style = {{left: x, top: y}}>
            {/* メニューヘッダー：予定名と色ドットを表示 */}
            <div style = {{padding: "7px 12px 8px", display: "flex", alignItems: "center", gap: 7}}>
                <span style = {{width: 8, height: 8, borderRadius: 2, background: pal.bg, flexShrink: 0, display: "inline-block"}}/>
                <span style = {{fontWeight: 800, fontSize: 12, color: "#2d2d3a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 125}}>{ctxMenu.s.name}</span>
            </div>
            <div className = "cdiv"/>
            <button className = "ci" onClick = {() => openEdit(ctxMenu.s)}>日時を編集</button>
            <button className = "ci" onClick = {() => {setCtxMenu(null); setSelected(ctxMenu.s);}}>詳細を表示</button>
            <div className = "cdiv"/>
            <button className = "ci red" onClick = {() => askDelete(ctxMenu.s)}>削除する</button>
            </div>);
        })()}

        {/* 削除PIN確認モーダル：予定名を表示してPINの入力を求める */}
        {deleteTarget && <div className = "overlay" onClick = {e => {if (e.target === e.currentTarget) setDeleteTarget(null);}}>
            <div className = "modal" style = {{maxWidth: 300}}>
            <div className = "drag-bar"/>
            <h2 style = {{fontSize: 16, fontWeight: 800, color: "#2d2d3a", marginBottom: 6}}>予定の削除</h2>
            <p style = {{fontSize: 12, color: "#6b7280", marginBottom: 14}}>
                <span style = {{display: "inline-flex", padding: "2px 9px", borderRadius: 18, fontSize: 12, background: colorFor(deleteTarget.name).bg, color: colorFor(deleteTarget.name).text, fontWeight: 700, marginRight: 5}}>{deleteTarget.name}</span>
                を削除するにはPINを入力してください。
            </p>
            {deletePinErr && <p style = {{color: "#dc2626", fontSize: 13, fontWeight: 600, marginBottom: 8}}>{deletePinErr}</p>}
            {/* inputMode="numeric" でスマホに数字キーパッドを表示 */}
            <input className = "inp" type = "password" inputMode = "numeric" maxLength = {4} placeholder = "4桁のPIN" autoFocus value = {deletePinInput} onChange = {e => {setDeletePinInput(e.target.value.replace(/[^0-9]/g, "").slice(0, 4)); setDeletePinErr("");}} onKeyDown = {e => e.key === "Enter" && handleDeleteWithPin()}/>
            <div style = {{display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16}}>
                <button className = "btn btn-ghost" onClick = {() => setDeleteTarget(null)}>キャンセル</button>
                <button className = "btn btn-red" onClick = {handleDeleteWithPin}>削除する</button>
            </div>
            </div>
        </div>}

        {/* 編集モーダル：PIN未確認時はPIN入力画面、確認済み後は編集フォームを表示 */}
        {editTarget && editForm && <div className = "overlay" onClick = {e => {if (e.target === e.currentTarget) {setEditTarget(null); setEditForm(null);}}}>
            <div className = "modal">
            <div className = "drag-bar"/>
            <h2 style = {{fontSize: 16, fontWeight: 800, color: "#2d2d3a", marginBottom: 4}}>予定を編集</h2>
            {/* 編集対象の名前・元の日時をヘッダーに表示 */}
            <div style = {{marginBottom: 14, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap"}}>
                <span style = {{display: "inline-flex", padding: "3px 10px", borderRadius: 18, fontSize: 12, background: colorFor(editTarget.name).bg, color: colorFor(editTarget.name).text, fontWeight: 700}}>{editTarget.name}</span>
                <span style = {{fontSize: 11, color: "#9ca3af"}}>{DAYS_JA[editTarget.dayIndex]}曜　{fmtTime(editTarget.startMin)}〜{fmtTime(editTarget.endMin)}</span>
            </div>
            {/* PIN確認前後でコンテンツを切り替える */}
            {!editPinOk ? (<>
                {/* PIN確認画面 */}
                <p style = {{fontSize: 13, color: "#6b7280", marginBottom: 4}}>編集するにはPINを入力してください。</p>
                <input className = "inp" type = "password" inputMode = "numeric" maxLength = {4}
                placeholder = "4桁のPIN" autoFocus
                value = {editPinInput}
                onChange = {e => {setEditPinInput(e.target.value.replace(/[^0-9]/g, "").slice(0, 4)); setEditPinErr("");}}
                onKeyDown = {e => e.key === "Enter" && handleEditPinSubmit()}/>
                {editPinErr && <p style = {{color: "#dc2626", fontSize: 12, fontWeight: 600, marginTop: 4}}>{editPinErr}</p>}
                <div style = {{display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16}}>
                <button className = "btn btn-ghost" onClick = {() => {setEditTarget(null); setEditForm(null);}}>キャンセル</button>
                <button className = "btn btn-purple" onClick = {handleEditPinSubmit}>確認</button>
                </div>
            </>) : (<>
                {/* 編集フォーム */}
                {editWarn && <div className = {isAdmin ? "wbox-a" : "wbox"} style = {{marginBottom: 10, fontSize: 12}}>
                {editWarn}
                {/* 管理者かつ強制保存モードの場合は追加の説明を表示 */}
                {isAdmin && forceEdit && <div style = {{marginTop: 3, fontSize: 11, fontWeight: 700}}>もう一度押すと強制保存します。</div>}
                </div>}
                <div style = {{display: "flex", flexDirection: "column", gap: 10}}>
                {/* 名前変更フィールド */}
                <div>
                    <label className = "lbl">名前</label>
                    <input className = {isAdmin ? "inp-a" : "inp"} placeholder = "名前" value = {editForm.name} onChange = {e => {setEditForm(f => ({...f, name: e.target.value})); setEditWarn("");}}/>
                </div>
                {/* 曜日変更セレクター */}
                <div>
                    <label className = "lbl">曜日・日付</label>
                    <select className = {isAdmin ? "inp-a" : "inp"} value = {editForm.dayIndex} onChange = {e => setEditForm(f => ({...f, dayIndex: +e.target.value}))}>
                    {weekDates.map((dt, i) => <option key = {i} value = {i}>{DAYS_JA[i]}曜日（{dt.getMonth() + 1}/{dt.getDate()}）</option>)}
                    </select>
                </div>
                {/* 開始・終了時刻変更 */}
                <div style = {{display: "grid", gridTemplateColumns: "1fr 20px 1fr", gap: 6, alignItems: "flex-end"}}>
                    <div>
                    <label className = "lbl">開始</label>
                    <div style = {{display: "flex", gap: 4}}>
                        <select className = {isAdmin ? "inp-a" : "inp"} value = {editForm.startH} onChange = {e => {const v = +e.target.value; setEditForm(f => ({...f, startH: v, endH: Math.min(v + 2, 20)})); setEditWarn(""); setForceEdit(false);}}>
                        {hourRange.map(h => <option key = {h} value = {h}>{h}時</option>)}
                        </select>
                        <select className = {isAdmin ? "inp-a" : "inp"} value = {editForm.startM} onChange = {e => {setEditForm(f => ({...f, startM: +e.target.value})); setEditWarn(""); setForceEdit(false);}}>
                        {minuteSteps.map(m => <option key = {m} value = {m}>{String(m).padStart(2, "0")}分</option>)}
                        </select>
                    </div>
                    </div>
                    <div style = {{textAlign: "center", paddingBottom: 8, color: "#c4c4d4", fontWeight: 700}}>→</div>
                    <div>
                    <label className = "lbl">終了</label>
                    <div style = {{display: "flex", gap: 4}}>
                        <select className = {isAdmin ? "inp-a" : "inp"} value = {editForm.endH} onChange = {e => {const v = +e.target.value; setEditForm(f => ({...f, endH: v, startH: Math.max(v - 2, 10)})); setEditWarn(""); setForceEdit(false);}}>
                        {hourRange.map(h => <option key = {h} value = {h}>{h}時</option>)}
                        </select>
                        <select className = {isAdmin ? "inp-a" : "inp"} value = {editForm.endM} onChange = {e => {setEditForm(f => ({...f, endM: +e.target.value})); setEditWarn(""); setForceEdit(false);}}>
                        {minuteSteps.map(m => <option key = {m} value = {m}>{String(m).padStart(2, "0")}分</option>)}
                        </select>
                    </div>
                    </div>
                </div>
                </div>
                {/* 変更後のプレビュー表示 */}
                <div style = {{marginTop: 10, padding: "8px 11px", borderRadius: 9, background: "linear-gradient(135deg,rgba(16,185,129,0.06),rgba(5,150,105,0.03))", border: "1px dashed rgba(16,185,129,0.26)", fontSize: 12, color: "#065f46", fontWeight: 600}}>
                変更後：{editForm.name || "(名前未入力)"}　{DAYS_JA[editForm.dayIndex]}曜　{editForm.startH}:{String(editForm.startM).padStart(2, "0")}〜{editForm.endH}:{String(editForm.endM).padStart(2, "0")}
                </div>
                {/* 管理者のみPIN変更フィールドを表示 */}
                {isAdmin && (
                <div style = {{marginTop: 10}}>
                    <label className = "lbl">PIN（4桁・変更する場合）</label>
                    <input className = "inp-a" type = "password" inputMode = "numeric" maxLength = {4}
                    placeholder = "4桁のPIN" value = {editForm.pin || ""}
                    onChange = {e => setEditForm(f => ({...f, pin: e.target.value.replace(/[^0-9]/g, "").slice(0, 4)}))}/>
                </div>
                )}
                <div style = {{display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16}}>
                <button className = "btn btn-ghost" onClick = {() => {setEditTarget(null); setEditForm(null);}}>キャンセル</button>
                {/* 重複がある場合は「重複を無視して保存」 通常は「変更を保存」と表示 */}
                <button className = "btn btn-green" onClick = {handleEditSave} disabled = {saving}>{saving ? "保存中…" : forceEdit ? "重複を無視して保存" : "変更を保存"}</button>
                </div>
            </>)}
            </div>
        </div>}

        {/* 詳細モーダル：タップ/左クリックで開く 編集・削除ボタン付き */}
        {selected && (() => {
            const pal = colorFor(selected.name);
            const dur = selected.endMin - selected.startMin;
            // 所要時間を "X時間Y分" 形式に変換する
            const durL = dur >= 60 ? Math.floor(dur / 60) + "時間" + (dur % 60 > 0 ? dur % 60 + "分" : "") : dur + "分";
            return (<div className = "overlay" onClick = {e => {if (e.target === e.currentTarget) setSelected(null);}}>
            <div className = "modal" style = {{maxWidth: 340, padding: 0, overflow: "hidden"}}>
                {/* 予定色のグラデーションバー（モーダル上部） */}
                <div style = {{borderRadius: "20px 20px 0 0", overflow: "hidden"}}>
                <div style = {{height: 6, background: "linear-gradient(90deg," + pal.bg + "," + pal.bg + "80)"}}/>
                </div>
                <div style = {{padding: 22}}>
                <div className = "drag-bar"/>
                {/* 予定名を色付きバッジで表示 */}
                <div style = {{marginBottom: 16}}>
                    <span style = {{display: "inline-flex", alignItems: "center", padding: "7px 14px", borderRadius: 24, background: pal.bg, color: pal.text, fontSize: 14, boxShadow: "0 3px 12px " + pal.bg + "45", fontWeight: 800}}>{selected.name}</span>
                </div>
                {/* 日付・時間帯・所要時間の情報行 */}
                <div style = {{display: "flex", flexDirection: "column", gap: 10, marginBottom: 20}}>
                    {[{label: "日付", value: selected.dateKey.replace(/-/g, "/") + "（" + DAYS_JA[selected.dayIndex] + "曜日）"}, {label: "時間帯", value: fmtTime(selected.startMin) + " 〜 " + fmtTime(selected.endMin)}, {label: "所要時間", value: durL}].map(row => (
                    <div key = {row.label} className = "irow">
                        <div><div style = {{fontSize: 10, color: "#9ca3af", fontWeight: 800, letterSpacing: "0.5px", textTransform: "uppercase"}}>{row.label}</div>
                        <div style = {{fontSize: 13, fontWeight: 700, color: "#2d2d3a", marginTop: 1}}>{row.value}</div></div>
                    </div>
                    ))}
                </div>
                {/* 閉じる・編集・削除ボタン */}
                <div style = {{display: "flex", gap: 8, marginTop: 4}}>
                    <button className = "btn btn-ghost" style = {{flex: 1}} onClick = {() => setSelected(null)}>閉じる</button>
                    <button className = "btn btn-ghost" style = {{flex: 1, color: "#059669", borderColor: "rgba(16,185,129,0.3)"}} onClick = {() => {const s = selected; setSelected(null); openEdit(s);}}>編集</button>
                    <button className = "btn btn-red" style = {{flex: 1}} onClick = {() => askDelete(selected)}>削除</button>
                </div>
                </div>
            </div>
            </div>);
        })()}

        {/* 予定追加モーダル：複数行を一括で追加できる */}
        {showForm && <div className = "overlay" onClick = {e => {if (e.target === e.currentTarget) {setShowForm(false); setRows([]); setGlobalWarn(""); setBulkPin("");}}}>
            <div className = "modal" style = {{maxWidth: 520}}>
            <div className = "drag-bar"/>
            <div style = {{display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8}}>
                <div>
                <h2 style = {{fontSize: 16, fontWeight: 800, color: "#2d2d3a"}}>予定を追加</h2>
                <p style = {{fontSize: 11, color: "#9ca3af", marginTop: 2}}>{isAdmin ? "管理者：名前・日時・PINを設定" : "名前・日時・削除用PINを入力"}</p>
                </div>
                {/* 行追加ボタン：押すたびにRowEditorが1行増える */}
                <button className = {"btn btn-sm " + (isAdmin ? "btn-ghost-amber" : "btn-ghost")} onClick = {addRow}>+ 行を追加</button>
            </div>
            {/* PIN 一括設定欄：2行以上あるときのみ表示 4桁入力で全行に即反映 */}
            {rows.length > 1 && (
                <div style = {{marginBottom: 12, padding: "10px 13px", borderRadius: 10, background: isAdmin ? "rgba(245,158,11,0.05)" : "rgba(108,99,255,0.04)", border: isAdmin ? "1.5px solid rgba(245,158,11,0.20)" : "1.5px solid rgba(108,99,255,0.14)", display: "flex", alignItems: "center", gap: 10}}>
                <span style = {{fontSize: 12, fontWeight: 700, color: isAdmin ? "#b45309" : "#6c63ff", whiteSpace: "nowrap"}}>PIN 一括設定</span>
                {/* inputMode="numeric" でスマホに数字キーパッドを表示 */}
                <input className = {isAdmin ? "inp-a" : "inp"} type = "password" inputMode = "numeric" maxLength = {4}
                    placeholder = "4桁のPINで全行に適用"
                    value = {bulkPin}
                    style = {{flex: 1}}
                    onChange = {e => applyBulkPin(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}/>
                </div>
            )}

            {globalWarn && <div className = "wbox" style = {{marginBottom: 10, fontSize: 12}}>{globalWarn}</div>}

            {/* 複数行の入力フォーム */}
            <div style = {{maxHeight: "52vh", overflowY: "auto", paddingRight: 2}}>
                {rows.map((row, idx) => (
                <RowEditor key = {row._id} row = {row} idx = {idx} rowCount = {rows.length} isAdmin = {isAdmin} cls = {isAdmin ? "inp-a" : "inp"} weekDates = {weekDates} hourRange = {hourRange} minuteSteps = {minuteSteps} updateRow = {updateRow} removeRow = {removeRow}/>
                ))}
            </div>

            <div style = {{display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14, flexWrap: "wrap"}}>
                <button className = "btn btn-ghost" onClick = {() => {setShowForm(false); setRows([]); setGlobalWarn(""); setBulkPin("");}}>キャンセル</button>
                {/* 管理者かつ強制追加行がある場合は「重複を無視して追加」ボタンを表示 */}
                {isAdmin && hasForceRows ? (
                <button className = "btn btn-amber" onClick = {handleForceAdd} disabled = {saving}>{saving ? "保存中…" : "重複を無視して追加"}</button>
                ) : (
                <button className = {"btn " + (isAdmin ? "btn-amber" : "btn-purple")} onClick = {handleAdd} disabled = {saving}>{saving ? "保存中…" : "追加する"}</button>
                )}
            </div>
            </div>
        </div>}
        </div>
    );
}


// React ルートを作成してアプリをレンダリング
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);