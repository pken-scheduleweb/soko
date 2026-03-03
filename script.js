// ── Firebase SDK からアプリ初期化・DB操作に必要な関数をインポート ──
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, get, set } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// React のフックをグローバルの React オブジェクトから分割取得（UMD版のため window.React から取得）
const { useState, useEffect, useRef, useCallback } = React;


// ── Firebase 設定 ──────────────────────────────────────────────
// このアプリが接続する Firebase プロジェクトの認証情報
const firebaseConfig = {
    apiKey:            "AIzaSyB-nACMRS4MaPbkeYuqqhrbsoIjBJSsM5g",
    authDomain:        "pken-schedule.firebaseapp.com",
    databaseURL:       "https://pken-schedule-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId:         "pken-schedule",
    storageBucket:     "pken-schedule.firebasestorage.app",
    messagingSenderId: "896999009755",
    appId:             "1:896999009755:web:ba18d17906013f2b0d8bfe"
};
// Firebase アプリを初期化し、Realtime Database への参照を取得
const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// ── Firebase Realtime Database 上のデータパス定数 ──
const DB_SCH_PATH  = "schedules";     // スケジュール一覧を保存するパス
const DB_PASS_PATH = "adminPassword"; // 管理者パスワードを保存するパス

// 週の表示順（火曜始まりで7曜日分）
const DAYS_JA = ["火","水","木","金","土","日","月"];

// 管理者パスワードのデフォルト値（Firebase に未登録の場合に使用）
const DEFAULT_PASS = "pken.admin.1234";

// ── 予定ブロックの色パレット（背景色・文字色のセット 18色）──
const PALETTE = [
    {bg:"#FF6B9D",text:"#fff"},{bg:"#26C6DA",text:"#fff"},{bg:"#42A5F5",text:"#fff"},
    {bg:"#66BB6A",text:"#fff"},{bg:"#FFA726",text:"#fff"},{bg:"#AB47BC",text:"#fff"},
    {bg:"#5C6BC0",text:"#fff"},{bg:"#E67E22",text:"#fff"},{bg:"#EC407A",text:"#fff"},
    {bg:"#26A69A",text:"#fff"},{bg:"#8D6E63",text:"#fff"},{bg:"#546E7A",text:"#fff"},
    {bg:"#EF5350",text:"#fff"},{bg:"#7E57C2",text:"#fff"},{bg:"#29B6F6",text:"#fff"},
    {bg:"#9CCC65",text:"#fff"},{bg:"#FF7043",text:"#fff"},{bg:"#00ACC1",text:"#fff"},
];

// 名前（小文字）→ パレットのインデックス を記憶するグローバルマップ
// 同じ名前は必ず同じ色、異なる名前は異なる色になるよう管理する
const nameColorMap = new Map();

/**
 * 指定した名前に対応するパレット色を返す関数
 * - 同一名前は常に同じ色を返す
 * - 異なる名前が同じ色にならないよう衝突回避している
 */
function colorFor(name) {
    // 名前を小文字・トリムして統一キーを作る
    const key = name.trim().toLowerCase();
    // 空文字の場合はデフォルト色（パレット先頭）を返す
    if (!key) return PALETTE[0];
    // すでにマップに登録済みであれば対応する色を返す
    if (nameColorMap.has(key)) return PALETTE[nameColorMap.get(key)];

    // 既に使われているインデックスの一覧を収集
    const usedIndices = new Set([...nameColorMap.values()]);

    // 名前文字列のハッシュ値を計算して初期候補インデックスを決定
    let h = 0;
    for (let c of key) h = (h * 31 + c.charCodeAt(0)) % PALETTE.length;

    // 候補インデックスが他の名前と衝突している場合、次の未使用インデックスを探す
    if (usedIndices.has(h)) {
        for (let i = 0; i < PALETTE.length; i++) {
            const idx = (h + i + 1) % PALETTE.length;
            if (!usedIndices.has(idx)) { h = idx; break; }
        }
    }

    // 決定したインデックスをマップに保存して色を返す
    nameColorMap.set(key, h);
    return PALETTE[h];
}

/**
 * Date オブジェクトを "YYYY-MM-DD" 形式の文字列に変換する
 * Firebase のキーや日付比較に使用する
 */
function dateKey(dt) {
    return dt.getFullYear()+"-"+String(dt.getMonth()+1).padStart(2,"0")+"-"+String(dt.getDate()).padStart(2,"0");
}

/**
 * 分（数値）を "H:MM" 形式の時刻文字列に変換する
 * 例: 630 → "10:30"
 */
function fmtTime(min) { return Math.floor(min/60)+":"+String(min%60).padStart(2,"0"); }

/**
 * Date オブジェクトを "M/D" 形式の日付文字列に変換する
 * カレンダーのヘッダー表示に使用する
 */
function formatDate(dt) { return (dt.getMonth()+1)+"/"+dt.getDate(); }

/**
 * 指定した週オフセットから、その週の火〜月の7日間の Date 配列を生成して返す
 * offsetWeeks: 0=今週, 1=来週, -1=先週
 */
function buildWeekDates(offsetWeeks) {
    const base = new Date();
    // オフセット分だけ日付を移動する
    base.setDate(base.getDate() + (offsetWeeks||0)*7);
    const day = base.getDay(); // 0=日, 1=月, ... 6=土
    // 火曜日（day=2）を基準に、その週の火曜日の日付を計算する
    const diff = day>=2 ? day-2 : day+5;
    const tue = new Date(base);
    tue.setDate(base.getDate()-diff);
    // 火曜から7日分の Date を配列で返す
    return Array.from({length:7},(_,i)=>{ const dt=new Date(tue); dt.setDate(tue.getDate()+i); return dt; });
}

/**
 * 現在時刻から「次の適切な開始時間（時）」を返す
 * 10〜18時の2時間刻みスロットの中で、現在時刻の直後のスロットを選ぶ
 */
function defaultStartHour() {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes();
    const slots = [10,12,14,16,18];
    for (const s of slots) {
        if (h < s) return s;                                     // 現在時刻よりあとのスロット
        if (h === s && m === 0) return s;                        // ちょうどスロット開始時刻
        if (h >= s && h < s+2) return s+2 <= 20 ? s+2 : 10;    // スロット内にいる→次のスロットへ
    }
    return 10; // 20時以降は翌日扱いで10時に戻す
}

/**
 * 週の日付一覧から「今日」に対応するインデックスを返す
 * 今日が表示週に含まれない場合は 0（火曜日）を返す
 */
function defaultDayIndex(weekDates) {
    const todayKey = dateKey(new Date());
    const idx = weekDates.findIndex(d => dateKey(d) === todayKey);
    return idx >= 0 ? idx : 0;
}

/**
 * 予定追加フォームの新しい行データを生成して返す
 * デフォルトで今日・現在時刻の直後のスロットを初期値に設定する
 */
function newRow(weekDates, isAdmin) {
    const sh = defaultStartHour();
    const di = defaultDayIndex(weekDates);
    // 終了時間は開始+2時間（最大20時）
    return { _id: Math.random(), name:"", dayIndex:di, startH:sh, startM:0, endH:Math.min(sh+2,20), endM:0, pin:"" };
}

// ──────────────────────────────────────────────────────────────
// RowEditor コンポーネント
// 予定追加モーダル内で1件分の入力フォームを表示する
// App の内部ではなくモジュールトップレベルで定義することで、
// App が再レンダリングされても RowEditor がアンマウント・再マウントされるのを防いでいる
// ──────────────────────────────────────────────────────────────
function RowEditor({row, idx, rowCount, isAdmin, cls, weekDates, hourRange, minuteSteps, updateRow, removeRow}) {
    // 名前が入力済みであれば対応する色を取得してプレビュー表示に使う
    const pal = row.name.trim() ? colorFor(row.name.trim()) : null;
    return (
        // 管理者モードと通常モードでカードのスタイルを切り替え、エラー時は warn-row クラスを追加
        <div className={(isAdmin?"row-card-a":"row-card")+(row.warn?" warn-row":"")} style={{marginBottom:12}}>

        {/* 複数行ある場合のみ「×」削除ボタンを表示 */}
        {rowCount>1 && (
            <button onClick={()=>removeRow(row._id)} style={{position:"absolute",top:10,right:10,background:"none",border:"none",cursor:"pointer",fontSize:17,color:"#9ca3af",fontWeight:800,lineHeight:1}}>×</button>
        )}

        {/* 行番号ラベル（例：「予定 1」） */}
        <div style={{fontWeight:800,fontSize:12,color:isAdmin?"#b45309":"#7c73ff",marginBottom:10}}>予定 {idx+1}</div>

        {/* 名前・PIN の入力欄（横並び） */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 120px",gap:10,marginBottom:10}}>
            <div>
            <label className="lbl">名前</label>
            <input className={cls} placeholder="名前" value={row.name} onChange={e=>updateRow(row._id,"name",e.target.value)}/>
            </div>
            <div>
                <label className="lbl">PIN（4桁）</label>
                {/* 数字のみ4桁に制限、パスワード表示 */}
                <input className={cls} type="password" inputMode="numeric" maxLength={4}
                value={row.pin||""}
                onChange={e=>updateRow(row._id,"pin",e.target.value.replace(/[^0-9]/g,"").slice(0,4))}/>
            </div>
        </div>

        {/* 曜日・日付の選択欄 */}
        <div style={{marginBottom:10}}>
            <label className="lbl">曜日・日付</label>
            <select className={cls} value={row.dayIndex} onChange={e=>updateRow(row._id,"dayIndex",+e.target.value)}>
            {weekDates.map((dt,i)=><option key={i} value={i}>{DAYS_JA[i]}曜日（{dt.getMonth()+1}/{dt.getDate()}）</option>)}
            </select>
        </div>

        {/* 開始時間・終了時間の選択欄（「→」矢印を挟んで横並び） */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 20px 1fr",gap:6,alignItems:"flex-end"}}>
            <div>
            <label className="lbl">開始</label>
            <div style={{display:"flex",gap:4}}>
                {/* 開始「時」を変更すると終了時間も2時間後に自動更新される（updateRow 内で処理） */}
                <select className={cls} value={row.startH} onChange={e=>updateRow(row._id,"startH",+e.target.value)}>
                {hourRange.map(h=><option key={h} value={h}>{h}時</option>)}
                </select>
                <select className={cls} value={row.startM} onChange={e=>updateRow(row._id,"startM",+e.target.value)}>
                {minuteSteps.map(m=><option key={m} value={m}>{String(m).padStart(2,"0")}分</option>)}
                </select>
            </div>
            </div>
            <div style={{textAlign:"center",paddingBottom:8,color:"#c4c4d4",fontWeight:700,fontSize:14}}>→</div>
            <div>
            <label className="lbl">終了</label>
            <div style={{display:"flex",gap:4}}>
                {/* 終了「時」を変更すると開始時間も2時間前に自動更新される（updateRow 内で処理） */}
                <select className={cls} value={row.endH} onChange={e=>updateRow(row._id,"endH",+e.target.value)}>
                {hourRange.map(h=><option key={h} value={h}>{h}時</option>)}
                </select>
                <select className={cls} value={row.endM} onChange={e=>updateRow(row._id,"endM",+e.target.value)}>
                {minuteSteps.map(m=><option key={m} value={m}>{String(m).padStart(2,"0")}分</option>)}
                </select>
            </div>
            </div>
        </div>

        {/* バリデーションエラーや重複警告がある場合に警告ボックスを表示 */}
        {row.warn && (
            <div className={isAdmin?"wbox-a":"wbox"} style={{marginTop:10,fontSize:12}}>
            {row.warn}
            {/* 管理者かつ強制追加可能な場合は追加のガイドメッセージを表示 */}
            {isAdmin&&row.forceOk&&<div style={{marginTop:3,fontSize:11,fontWeight:700}}>このまま「追加する」を押すと強制追加します。</div>}
            </div>
        )}

        {/* 名前が入力されていればカラーバッジで入力内容のプレビューを表示 */}
        {pal && (
            <div style={{marginTop:10}}>
            <span style={{display:"inline-flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:24,background:pal.bg,color:pal.text,fontSize:12,fontWeight:700,boxShadow:"0 2px 8px "+pal.bg+"40"}}>
                {row.name}　{DAYS_JA[row.dayIndex]}　{row.startH}:{String(row.startM).padStart(2,"0")}〜{row.endH}:{String(row.endM).padStart(2,"0")}
            </span>
            </div>
        )}
        </div>
    );
}

// ──────────────────────────────────────────────────────────────
// App コンポーネント（アプリ全体のメインコンポーネント）
// ──────────────────────────────────────────────────────────────
function App() {
    // 今日の日付（カレンダーの TODAY 判定に使用）
    const today = new Date();

    // ── スケジュールデータ・通信状態 ──
    const [schedules,setSchedules]=useState([]);   // Firebase から読み込んだ全スケジュール
    const [loading,setLoading]=useState(true);     // 初回ロード中フラグ
    const [saving,setSaving]=useState(false);      // Firebase への保存中フラグ

    // ── 管理者ログイン関連 ──
    const [adminPass,setAdminPass]=useState(DEFAULT_PASS); // 現在の管理者パスワード
    const [isAdmin,setIsAdmin]=useState(false);            // 管理者ログイン中かどうか
    const [showLogin,setShowLogin]=useState(false);        // ログインモーダルの表示状態
    const [loginInput,setLoginInput]=useState("");         // ログインフォームの入力値
    const [loginErr,setLoginErr]=useState("");             // ログインエラーメッセージ
    const [weekOffset,setWeekOffset]=useState(0);          // 管理者が選択している週（0=今週）

    // ── パスワード変更フォーム関連 ──
    const [showPassChange,setShowPassChange]=useState(false); // パスワード変更モーダルの表示状態
    const [passOld,setPassOld]=useState("");      // 現在のパスワード入力値
    const [passNew,setPassNew]=useState("");      // 新しいパスワード入力値
    const [passNew2,setPassNew2]=useState("");    // 新しいパスワード確認入力値
    const [passErr,setPassErr]=useState("");      // パスワード変更エラーメッセージ
    const [passOk,setPassOk]=useState(false);    // パスワード変更成功フラグ

    // ── 予定追加モーダル関連 ──
    // rows: 各行 { _id, name, dayIndex, startH, startM, endH, endM, pin, warn, forceOk }
    const [showForm,setShowForm]=useState(false);    // 追加モーダルの表示状態
    const [rows,setRows]=useState([]);               // 追加フォームの行一覧
    const [globalWarn,setGlobalWarn]=useState("");   // フォーム全体の警告メッセージ

    // ── 詳細モーダル関連 ──
    const [selected,setSelected]=useState(null);   // クリックで選択された予定オブジェクト

    // ── 右クリック コンテキストメニュー関連 ──
    const [ctxMenu,setCtxMenu]=useState(null);  // { x, y, s } メニューの表示位置と対象予定
    const ctxRef=useRef(null);                  // メニュー DOM 要素への参照（外側クリック検知用）

    // ── 編集モーダル関連 ──
    const [editTarget,setEditTarget]=useState(null);   // 編集対象の予定オブジェクト
    const [editForm,setEditForm]=useState(null);       // 編集フォームの入力値 { dayIndex, startH, startM, endH, endM, pin }
    const [editWarn,setEditWarn]=useState("");          // 編集時の警告メッセージ
    const [forceEdit,setForceEdit]=useState(false);    // 重複を無視して強制保存するフラグ
    const [editPinInput,setEditPinInput]=useState(""); // 編集PIN確認の入力値
    const [editPinErr,setEditPinErr]=useState("");     // 編集PIN確認のエラーメッセージ
    const [editPinOk,setEditPinOk]=useState(false);   // PIN確認済みフラグ

    // ── 削除PINモーダル関連 ──
    const [deleteTarget,setDeleteTarget]=useState(null);   // 削除対象の予定オブジェクト
    const [deletePinInput,setDeletePinInput]=useState(""); // 削除PIN入力値
    const [deletePinErr,setDeletePinErr]=useState("");     // 削除PINエラーメッセージ

    // 管理者モードでは weekOffset を反映した週、通常モードは常に今週を表示
    const weekDates=buildWeekDates(isAdmin?weekOffset:0);

    // Firebase からスケジュールと管理者パスワードを読み込む
    // 読み込んだスケジュールの名前を色マップに登録して色の一貫性を保つ
    async function load() {
        try {
        const schSnap  = await get(ref(db, DB_SCH_PATH));
        const passSnap = await get(ref(db, DB_PASS_PATH));
        const loadedSch = schSnap.exists() ? schSnap.val() : [];

        // 既存スケジュールの名前を順番に色マップへ登録（同じ名前→同じ色、異なる名前→異なる色）
        nameColorMap.clear();
        const seen = [];
        for (const s of loadedSch) {
            const k = (s.name||"").trim().toLowerCase();
            if (k && !nameColorMap.has(k)) { colorFor(k); seen.push(k); }
        }

        setSchedules(loadedSch);
        // Firebase にパスワードが保存されていれば上書き、なければデフォルトパスワードを維持
        if (passSnap.exists() && passSnap.val()) setAdminPass(passSnap.val());
        } catch (e) {
        console.error("Firebase read error:", e);
        setSchedules([]);
        }
        setLoading(false);
    }

    // スケジュール一覧を Firebase に保存する
    async function saveSch(list) {
        await set(ref(db, DB_SCH_PATH), list);
    }

    // 管理者パスワードを Firebase に保存する
    async function saveAdminPass(p) {
        await set(ref(db, DB_PASS_PATH), p);
    }

    // コンポーネント初回マウント時にデータを読み込む
    useEffect(()=>{load();},[]);

    // コンテキストメニュー外をクリックしたらメニューを閉じる
    // ctxMenu が開いているときだけリスナーを登録し、閉じたら解除する
    useEffect(()=>{
        function h(e){if(ctxRef.current&&!ctxRef.current.contains(e.target))setCtxMenu(null);}
        if(ctxMenu)setTimeout(()=>document.addEventListener("mousedown",h),0);
        return()=>document.removeEventListener("mousedown",h);
    },[ctxMenu]);

    // 管理者ログイン処理
    // 入力パスワードが一致すれば管理者モードに切り替える
    function handleLogin(){
        if(loginInput===adminPass){setIsAdmin(true);setShowLogin(false);setLoginInput("");setLoginErr("");}
        else setLoginErr("パスワードが違います");
    }

    // 管理者ログアウト処理（週オフセットもリセット）
    function handleLogout(){setIsAdmin(false);setWeekOffset(0);}

    // 管理者パスワード変更処理
    // 現在のパスワード確認 → 新パスワードのバリデーション → Firebase に保存
    async function handlePassChange(){
        setPassErr("");setPassOk(false);
        if(passOld!==adminPass){setPassErr("現在のパスワードが違います");return;}
        if(passNew.length<6){setPassErr("新しいパスワードは6文字以上にしてください");return;}
        if(passNew!==passNew2){setPassErr("新しいパスワードが一致しません");return;}
        setAdminPass(passNew);await saveAdminPass(passNew);
        setPassOk(true);setPassOld("");setPassNew("");setPassNew2("");
    }

    // 時間の選択肢（10〜20時）※管理者・一般ユーザー共通
    const hourRange=Array.from({length:11},(_,i)=>i+10);
    // 分の選択肢：管理者は5分刻み（00〜55）、一般ユーザーは15分刻み（00/15/30/45）
    const minuteSteps=isAdmin?Array.from({length:12},(_,i)=>i*5):[0,15,30,45];

    // 重複チェック関数

    // 既存のスケジュールとの時間重複を確認する
    // excludeId を指定すると編集中の予定自身を除外できる
    function checkOverlapExisting(item, excludeId=null){
        return schedules.filter(s=>s.id!==excludeId&&s.dateKey===item.dateKey&&s.startMin<item.endMin&&s.endMin>item.startMin);
    }

    // 同じ追加バッチ内の他の行との時間重複を確認する
    function checkOverlapRows(item, rowId, pendingRows){
        return pendingRows.filter(r=>r._id!==rowId&&r.dateKey===item.dateKey&&r.startMin<item.endMin&&r.endMin>item.startMin&&r.startMin!==undefined);
    }

    // 予定追加フォームの操作

    // 追加モーダルを開いてフォームを初期化する
    function openAdd(){
        setShowForm(true);setGlobalWarn("");
        setRows([newRow(weekDates,isAdmin)]);
    }

    // 追加フォームに新しい行を1件追加する
    function addRow(){setRows(r=>[...r,newRow(weekDates,isAdmin)]);}

    // 指定IDの行を追加フォームから削除する
    function removeRow(id){setRows(r=>r.filter(x=>x._id!==id));}

    // 指定IDの行の指定フィールドを更新する
    // startH を変更すると endH を +2時間に、endH を変更すると startH を -2時間に自動連動させる
    function updateRow(id,key,val){
        setRows(r=>r.map(x=>{
            if(x._id!==id) return x;
            const updated={...x,[key]:val,warn:"",forceOk:false};
            if(key==="startH"){
                // 開始時刻を変えたら終了時刻を2時間後に設定（20時を超えない）
                const newEnd=Math.min(+val+2,20);
                updated.endH=newEnd;
            } else if(key==="endH"){
                // 終了時刻を変えたら開始時刻を2時間前に設定（10時を下回らない）
                const newStart=Math.max(+val-2,10);
                updated.startH=newStart;
            }
            return updated;
        }));
    }

    // 予定追加の保存処理（通常追加）
    // バリデーション → 重複チェック → Firebase 保存の順に実行
    async function handleAdd(){
        setGlobalWarn("");

        // ① 各行のバリデーション（名前・時間・PIN の入力チェック）
        let anyErr=false;
        const validated = rows.map(row=>{
        if(!row.name.trim()) return{...row,warn:"名前を入力してください"};
        const s=row.startH*60+row.startM, e=row.endH*60+row.endM;
        if(e<=s) return{...row,warn:"終了時間は開始時間より後にしてください"};
        if(!/^\d{4}$/.test(row.pin||"")) return{...row,warn:"4桁のPINを入力してください"};
        return row;
        });
        const hasFieldErr = validated.some(r=>r.warn&&r.warn!=="");
        // エラーがあれば行に警告をセットして保存を中止
        if(hasFieldErr){setRows(validated);return;}

        // ② 各行を保存候補データに変換（分単位の時刻・日付キーを計算）
        const candidates = rows.map(row=>{
        const s=row.startH*60+row.startM, e=row.endH*60+row.endM;
        return{_id:row._id,name:row.name.trim(),dateKey:dateKey(weekDates[row.dayIndex]),dayIndex:row.dayIndex,startMin:s,endMin:e,pin:row.pin};
        });

        // ③ 各行について既存スケジュールおよび同バッチ内の行との時間重複を確認
        const withWarn = rows.map((row,i)=>{
        const c=candidates[i];
        const ovEx=checkOverlapExisting(c);
        const ovRow=candidates.filter((cc,j)=>j!==i&&cc.dateKey===c.dateKey&&cc.startMin<c.endMin&&cc.endMin>c.startMin);
        const allOv=[...ovEx,...ovRow];
        if(allOv.length>0&&!row.forceOk){
            const msg="重複あり："+allOv.map(x=>"「"+(x.name||"(他の行)")+"」("+fmtTime(x.startMin)+"〜"+fmtTime(x.endMin)+")").join("、");
            // 管理者の場合は forceOk フラグを立てて次回押下で強制追加できるようにする
            return{...row,warn:msg,forceOk:isAdmin};
        }
        return row;
        });

        const hasOverlapErr=withWarn.some(r=>r.warn&&!r.forceOk);
        if(hasOverlapErr){
        setRows(withWarn);
        if(!isAdmin) return; // 一般ユーザーは重複がある場合は保存を中止
        // 管理者の場合：全行が forceOk になっていれば次のステップへ進む
        const allForce=withWarn.every(r=>!r.warn||(r.warn&&r.forceOk));
        if(!allForce) return;
        }

        // ④ バリデーション・重複チェックを通過したので Firebase に保存する
        setSaving(true);
        const newItems=candidates.map((c,i)=>({id:Date.now()+i,name:c.name,dateKey:c.dateKey,dayIndex:c.dayIndex,startMin:c.startMin,endMin:c.endMin,pin:c.pin}));
        const upd=[...schedules,...newItems];setSchedules(upd);await saveSch(upd);
        setSaving(false);setShowForm(false);setRows([]);setGlobalWarn("");
    }

    // 管理者が重複警告を無視して強制追加する処理
    // バリデーションや重複チェックをスキップして直接保存する

    async function handleForceAdd(){
        setSaving(true);
        const newItems=rows.map((row,i)=>{
        const s=row.startH*60+row.startM, e=row.endH*60+row.endM;
        return{id:Date.now()+i,name:row.name.trim(),dateKey:dateKey(weekDates[row.dayIndex]),dayIndex:row.dayIndex,startMin:s,endMin:e,pin:row.pin};
        });
        const upd=[...schedules,...newItems];setSchedules(upd);await saveSch(upd);
        setSaving(false);setShowForm(false);setRows([]);
    }

    // 予定削除の振り分け処理
    // 管理者または PIN なし予定 → 即削除
    // 一般ユーザー＋PIN あり → PIN 確認モーダルを表示
    function askDelete(s){
        setCtxMenu(null);setSelected(null);
        if(isAdmin||s.pin===null){doDelete(s.id);return;}
        setDeleteTarget(s);setDeletePinInput("");setDeletePinErr("");
    }

    // 指定IDの予定を Firebase から削除して画面を更新する
    async function doDelete(id){
        const upd=schedules.filter(s=>s.id!==id);setSchedules(upd);await saveSch(upd);
        setDeleteTarget(null);setSelected(null);setCtxMenu(null);
    }

    // PIN 入力モーダルでPINを確認し、一致すれば削除を実行する
    function handleDeleteWithPin(){
        if(deletePinInput!==deleteTarget.pin){setDeletePinErr("PINが違います");return;}
        doDelete(deleteTarget.id);
    }

    // 編集モーダルを開く処理
    // 管理者または PIN なし予定は PIN 確認をスキップして直接編集フォームを表示
    function openEdit(s){
        setCtxMenu(null);
        setEditTarget(s);setEditWarn("");setForceEdit(false);
        setEditPinInput("");setEditPinErr("");
        // フォームの初期値に現在の予定データをセット（分単位→時・分に変換）
        setEditForm({dayIndex:s.dayIndex,startH:Math.floor(s.startMin/60),startM:s.startMin%60,endH:Math.floor(s.endMin/60),endM:s.endMin%60,pin:s.pin||""});
        // 管理者または PIN が null の場合は PIN 確認済みとしてフォームをすぐ表示
        setEditPinOk(isAdmin||s.pin===null);
    }

    // 編集モーダルの PIN 確認処理
    function handleEditPinSubmit(){
        if(editPinInput!==editTarget.pin){setEditPinErr("PINが違います");return;}
        setEditPinOk(true);setEditPinErr("");
    }

    // 編集内容を Firebase に保存する処理
    // バリデーション → 重複チェック → 保存の順に実行
    async function handleEditSave(){
        const s=editForm.startH*60+editForm.startM, e=editForm.endH*60+editForm.endM;
        // 終了時間が開始時間以前でないかチェック
        if(e<=s){setEditWarn("終了時間は開始時間より後にしてください");return;}
        // 管理者の場合は PIN が4桁数字かチェック
        if(isAdmin&&!/^\d{4}$/.test(editForm.pin||"")){setEditWarn("PINは4桁の数字で入力してください");return;}

        // 保存するPINを決定：管理者は入力値、一般ユーザーは有効な4桁なら更新・そうでなければ既存PINを維持
        const newPin=isAdmin?editForm.pin:(editForm.pin&&/^\d{4}$/.test(editForm.pin)?editForm.pin:editTarget.pin);
        const upd={...editTarget,dayIndex:editForm.dayIndex,dateKey:dateKey(weekDates[editForm.dayIndex]),startMin:s,endMin:e,pin:newPin};

        // 他の予定との時間重複を確認（編集対象自身は除外）
        const ov=schedules.filter(x=>x.id!==editTarget.id&&x.dateKey===upd.dateKey&&x.startMin<upd.endMin&&x.endMin>upd.startMin);
        if(ov.length&&!forceEdit){
        setEditWarn("重複あり："+ov.map(x=>"「"+x.name+"」("+fmtTime(x.startMin)+"〜"+fmtTime(x.endMin)+")").join("、"));
        // 管理者の場合は forceEdit フラグを立て、次回押下で強制保存できるようにする
        if(isAdmin)setForceEdit(true); return;
        }

        // バリデーション通過 → Firebase に保存
        setSaving(true);
        const list=schedules.map(x=>x.id===editTarget.id?upd:x);setSchedules(list);await saveSch(list);
        setSaving(false);setEditTarget(null);setEditForm(null);setForceEdit(false);
    }

    // ── カレンダー表示範囲の計算 ──
    // 管理者モードでは表示週内のスケジュールを絞り込み、通常は全スケジュールを表示
    const viewSch=isAdmin?schedules.filter(s=>weekDates.some(d=>dateKey(d)===s.dateKey)):[];

    // 表示する時間軸の開始・終了時間（スケジュールの実際の時間帯に合わせて可変）
    const vsH=isAdmin?Math.min(10,...(viewSch.length?viewSch.map(s=>Math.floor(s.startMin/60)):[10])):10;
    const veH=isAdmin?Math.max(20,...(viewSch.length?viewSch.map(s=>Math.ceil(s.endMin/60)):[20])):20;

    // 時間軸全体の分数（VS=開始分, VE=終了分, VT=合計分）
    const VS=vsH*60,VE=veH*60,VT=VE-VS;

    // 分を時間軸上の % 位置に変換する関数（カレンダーブロックの top/height に使用）
    const pct=min=>((min-VS)/VT)*100;

    // カレンダー本体の高さは CSS(.cal-body)で制御
    const calH = "100%";

    // 表示する時間ラベルの一覧（vsH〜veH）
    const allH=Array.from({length:veH-vsH+1},(_,i)=>i+vsH);
    // 偶数時間のみを「主要ライン」として太く表示する
    const mjH=allH.filter(h=>h%2===0);

    // 追加フォームに重複警告＋強制追加可能な行があるかチェック（ボタン切り替えに使用）
    const hasForceRows = rows.some(r=>r.warn&&r.forceOk);

    // JSX レンダリング
    return(
        // 管理者モードは黄色系、通常モードは紫系のグラデーション背景
        <div style={{minHeight:"100vh",background:isAdmin?"linear-gradient(160deg,#fffbeb 0%,#fef3c7 40%,#fff7ed 100%)":"linear-gradient(160deg,#f8f9ff 0%,#eef2ff 50%,#fdf0ff 100%)",fontFamily:"'M PLUS Rounded 1c','Noto Sans JP',sans-serif",transition:"background 0.4s"}}>

        {/* 背景の装飾用ぼかし円（pointer-events:none で操作を妨げない） */}
        <div style={{position:"fixed",inset:0,overflow:"hidden",zIndex:0,pointerEvents:"none"}}>
            {isAdmin?<>
            <div style={{position:"absolute",width:400,height:400,borderRadius:"50%",background:"rgba(245,158,11,0.07)",filter:"blur(50px)",top:-100,right:-80}}/>
            <div style={{position:"absolute",width:300,height:300,borderRadius:"50%",background:"rgba(251,191,36,0.05)",filter:"blur(50px)",bottom:60,left:-60}}/>
            </>:<>
            <div style={{position:"absolute",width:400,height:400,borderRadius:"50%",background:"rgba(108,99,255,0.07)",filter:"blur(50px)",top:-100,right:-80}}/>
            <div style={{position:"absolute",width:300,height:300,borderRadius:"50%",background:"rgba(255,101,132,0.06)",filter:"blur(50px)",bottom:60,left:-60}}/>
            </>}
        </div>

        {/* メインコンテンツ領域（最大幅・中央揃え） */}
        <div style={{maxWidth:1160,margin:"0 auto",padding:"20px 14px",position:"relative",zIndex:1}}>

            {/* ── ヘッダー ── */}
            <div style={{marginBottom:18}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,flexWrap:"wrap"}}>
                {/* アプリアイコン（管理者モードで色が変わる） */}
                <div style={{width:42,height:42,borderRadius:12,flexShrink:0,background:isAdmin?"linear-gradient(135deg,#f59e0b,#d97706)":"linear-gradient(135deg,#6c63ff,#a855f7)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,boxShadow:isAdmin?"0 3px 14px rgba(245,158,11,0.30)":"0 3px 14px rgba(108,99,255,0.30)"}}>{isAdmin?"⚙":"▦"}</div>
                <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                    <h1 style={{fontSize:20,fontWeight:800,color:"#2d2d3a",letterSpacing:"-0.4px"}}>倉庫スケジュール</h1>
                    {/* 管理者モード時だけバッジを表示 */}
                    {isAdmin&&<span className="adm-b">管理者モード</span>}
                </div>
                {/* 表示中の週の日付範囲を表示（管理者は年まで表示） */}
                <p style={{fontSize:11,color:"#9ca3af",marginTop:1,fontWeight:500}}>
                    {isAdmin?weekDates[0].getFullYear()+"/"+formatDate(weekDates[0])+"（火）〜 "+weekDates[6].getFullYear()+"/"+formatDate(weekDates[6])+"（月）":formatDate(weekDates[0])+"（火）〜 "+formatDate(weekDates[6])+"（月）"}
                </p>
                </div>
            </div>

            {/* ── 操作ボタン行 ── */}
            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                {/* 管理者モードのみ週移動ボタンを表示 */}
                {isAdmin&&<>
                <button className="wkbtn" onClick={()=>setWeekOffset(w=>w-1)}>◀ 前週</button>
                {/* 今週ボタン：今週表示中は背景色を強調 */}
                <button className="wkbtn" style={{background:weekOffset===0?"rgba(245,158,11,0.18)":"rgba(245,158,11,0.09)"}} onClick={()=>setWeekOffset(0)}>今週</button>
                <button className="wkbtn" onClick={()=>setWeekOffset(w=>w+1)}>次週 ▶</button>
                <div style={{width:1,height:24,background:"rgba(245,158,11,0.25)",margin:"0 2px"}}/>
                </>}
                {/* 更新ボタン：Firebase から最新データを再読み込み */}
                <button className={"btn btn-sm "+(isAdmin?"btn-ghost-amber":"btn-ghost")} onClick={load}>更新</button>
                {/* 予定追加ボタン：追加モーダルを開く */}
                <button className={"btn btn-sm "+(isAdmin?"btn-amber":"btn-purple")} onClick={openAdd}>+ 予定を追加</button>
                {/* 管理者モード：PW変更・ログアウトボタン / 通常：管理者ログインボタン */}
                {isAdmin?<>
                <button className="btn btn-sm btn-ghost-amber" onClick={()=>{setShowPassChange(true);setPassErr("");setPassOk(false);setPassOld("");setPassNew("");setPassNew2("");}}>PW変更</button>
                <button className="btn btn-sm btn-ghost-amber" onClick={handleLogout}>ログアウト</button>
                </>:<button className="btn btn-sm btn-ghost" onClick={()=>{setShowLogin(true);setLoginErr("");setLoginInput("");}}>管理</button>}
            </div>
            </div>

            {/* ── カレンダー本体 ── */}
            <div className={isAdmin?"admin-glass":"glass"} style={{borderRadius:18}}>
            {/* 横スクロール可能なラッパー（スマホ対応） */}
            <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
                <div style={{minWidth:520}}>  {/* スマホで横スクロール: 最低幅を確保 */}

                {/* 曜日ヘッダー行 */}
                <div style={{display:"flex",background:isAdmin?"linear-gradient(135deg,rgba(245,158,11,0.07),rgba(217,119,6,0.03))":"linear-gradient(135deg,rgba(108,99,255,0.05),rgba(168,85,247,0.03))",borderBottom:isAdmin?"1px solid rgba(245,158,11,0.15)":"1px solid rgba(108,99,255,0.09)"}}>
                    {/* 時刻ラベル列のスペーサー */}
                    <div style={{width:48,flexShrink:0}}/>
                    {weekDates.map((dt,i)=>{
                    const isT=dateKey(dt)===dateKey(today),isSat=i===4,isSun=i===5;
                    return(<div key={i} style={{flex:1,textAlign:"center",padding:"11px 3px",borderLeft:isAdmin?"1px solid rgba(245,158,11,0.10)":"1px solid rgba(108,99,255,0.07)",background:isT?(isAdmin?"rgba(245,158,11,0.07)":"rgba(108,99,255,0.06)"):"transparent"}}>
                        {/* 今日は色強調、土曜は青、日曜は赤 */}
                        <div style={{fontSize:16,fontWeight:800,color:isT?(isAdmin?"#d97706":"#6c63ff"):isSat?"#3b82f6":isSun?"#ef4444":"#2d2d3a"}}>{DAYS_JA[i]}</div>
                        <div style={{fontSize:10,color:"#b0b0c4",fontWeight:600,marginTop:1}}>{formatDate(dt)}</div>
                        {/* 今日の列だけ「TODAY」バッジを表示 */}
                        {isT&&<div style={{marginTop:3}}><span className="today-b">TODAY</span></div>}
                    </div>);
                    })}
                </div>

                {/* タイムライン（スケジュールブロックを絶対配置で重ねる） */}
                {loading?<div style={{textAlign:"center",padding:"48px 0",color:"#b0b0c4",fontWeight:600}}>読み込み中...</div>:(
                    <div className="cal-body" style={{display:"flex"}}>

                    {/* 左端の時刻ラベル列 */}
                    <div style={{width:48,flexShrink:0,position:"relative",height:calH}}>
                        {/* 偶数時間は大きく・太く、奇数時間は小さく・細く表示 */}
                        {allH.map(h=><div key={h} style={{position:"absolute",top:pct(h*60)+"%",right:7,transform:"translateY(-50%)",fontSize:mjH.includes(h)?10:9,fontWeight:mjH.includes(h)?800:500,color:mjH.includes(h)?(isAdmin?"#d97706":"#7c73ff"):"#d1d5db"}}>{h}:00</div>)}
                    </div>

                    {/* 各曜日の列 */}
                    {weekDates.map((dt,dayIdx)=>{
                        const dk=dateKey(dt);
                        // この日のスケジュールだけ絞り込む
                        const daySch=schedules.filter(s=>s.dateKey===dk);
                        const isT=dk===dateKey(today);
                        return(<div key={dayIdx} className="day-col" style={{height:calH,background:isT?(isAdmin?"rgba(245,158,11,0.022)":"rgba(108,99,255,0.020)"):"transparent",borderLeft:isAdmin?"1px solid rgba(245,158,11,0.08)":"1px solid rgba(108,99,255,0.07)"}}>

                        {/* グリッド横線：偶数時間は太線(gl-mj)、奇数時間は細線(gl-mn) */}
                        {allH.map(h=><div key={h} className={mjH.includes(h)?"gl-mj":"gl-mn"} style={{top:pct(h*60)+"%",background:mjH.includes(h)?(isAdmin?"rgba(245,158,11,0.13)":"rgba(108,99,255,0.10)"):(isAdmin?"rgba(245,158,11,0.06)":"rgba(108,99,255,0.05)")}}/>)}

                        {/* スケジュールブロックを絶対配置で配置 */}
                        {daySch.map(s=>{
                            const pal=colorFor(s.name);
                            // top と height を時間軸上の % で計算
                            const top=pct(s.startMin),ht=pct(s.endMin)-top;
                            return(<div key={s.id} className="blk ba" style={{top:top+"%",height:Math.max(ht,3.5)+"%",background:"linear-gradient(160deg,"+pal.bg+"f0,"+pal.bg+"c8)",boxShadow:"0 2px 10px "+pal.bg+"45"}}
                            // 左クリック：詳細モーダルを開く
                            onClick={()=>{setSelected(s);setCtxMenu(null);}}
                            // 右クリック：コンテキストメニューを表示
                            onContextMenu={e=>{e.preventDefault();e.stopPropagation();setSelected(null);setCtxMenu({x:e.clientX,y:e.clientY,s});}}>
                            <div style={{fontWeight:800,fontSize:14,color:pal.text,lineHeight:1.3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.name}</div>
                            {/* ブロックの高さが十分あるときだけ時刻を表示 */}
                            {ht>5&&<div style={{fontSize:11,color:pal.text,opacity:0.85,marginTop:2}}>{fmtTime(s.startMin)}〜{fmtTime(s.endMin)}</div>}
                            </div>);
                        })}
                        </div>);
                    })}
                    </div>
                )}
                </div>
            </div>
            </div>

            {/* 操作方法のヒント：タッチデバイスとPCで文言を切り替え */}
            <p style={{textAlign:"center",fontSize:11,color:"#c4c4d4",marginTop:10,fontWeight:500}}>
                {'ontouchstart' in window
                    ? "タッチで詳細・編集・削除"
                    : "左クリックで詳細 / 右クリックで編集・削除"}
            </p>
        </div>

        {/* ── 管理者ログインモーダル ── */}
        {showLogin&&<div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setShowLogin(false);}}>
            <div className="modal" style={{maxWidth:320}}>
            <div className="drag-bar"/>
            <h2 style={{fontSize:16,fontWeight:800,color:"#2d2d3a",marginBottom:14}}>管理者ログイン</h2>
            {/* ログインエラーメッセージ */}
            {loginErr&&<div className="wbox" style={{marginBottom:10,fontSize:12}}>{loginErr}</div>}
            <div style={{marginBottom:14}}>
                <label className="lbl">パスワード</label>
                {/* Enter キーでもログイン実行 */}
                <input className="inp-a" type="password" value={loginInput} onChange={e=>{setLoginInput(e.target.value);setLoginErr("");}} onKeyDown={e=>e.key==="Enter"&&handleLogin()} autoFocus/>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button className="btn btn-ghost" onClick={()=>setShowLogin(false)}>キャンセル</button>
                <button className="btn btn-amber" onClick={handleLogin}>ログイン</button>
            </div>
            </div>
        </div>}

        {/* ── パスワード変更モーダル ── */}
        {showPassChange&&<div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setShowPassChange(false);}}>
            <div className="modal" style={{maxWidth:360}}>
            <div className="drag-bar"/>
            <h2 style={{fontSize:16,fontWeight:800,color:"#2d2d3a",marginBottom:4}}>パスワードを変更</h2>
            <p style={{fontSize:11,color:"#9ca3af",marginBottom:14}}>管理者ログインに使用するパスワードを変更します。</p>
            {/* エラー・成功メッセージ */}
            {passErr&&<div className="wbox-a" style={{marginBottom:10,fontSize:12}}>{passErr}</div>}
            {passOk&&<div className="sbox" style={{marginBottom:10,fontSize:12}}>パスワードを変更しました。</div>}
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {/* 現在のパスワード入力 */}
                <div><label className="lbl">現在のパスワード</label><input className="inp-a" type="password" value={passOld} onChange={e=>{setPassOld(e.target.value);setPassErr("");setPassOk(false);}} autoFocus/></div>
                <div style={{borderTop:"1px solid rgba(245,158,11,0.15)",paddingTop:10}}>
                {/* 新しいパスワード入力（6文字以上） */}
                <div style={{marginBottom:10}}><label className="lbl">新しいパスワード（6文字以上）</label><input className="inp-a" type="password" value={passNew} onChange={e=>{setPassNew(e.target.value);setPassErr("");setPassOk(false);}}/></div>
                {/* 新しいパスワード確認入力（Enter で保存） */}
                <div><label className="lbl">確認</label><input className="inp-a" type="password" value={passNew2} onChange={e=>{setPassNew2(e.target.value);setPassErr("");setPassOk(false);}} onKeyDown={e=>e.key==="Enter"&&handlePassChange()}/></div>
                </div>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:18}}>
                <button className="btn btn-ghost" onClick={()=>setShowPassChange(false)}>閉じる</button>
                <button className="btn btn-amber" onClick={handlePassChange}>変更を保存</button>
            </div>
            </div>
        </div>}

        {/* ── 右クリック コンテキストメニュー ── */}
        {ctxMenu&&(()=>{
            const pal=colorFor(ctxMenu.s.name);
            // 画面端でメニューがはみ出さないように位置を調整
            const x=Math.min(ctxMenu.x,window.innerWidth-185),y=Math.min(ctxMenu.y,window.innerHeight-140);
            return(<div ref={ctxRef} className="ctx" style={{left:x,top:y}}>
            {/* 対象予定の色付きカラードット＋名前 */}
            <div style={{padding:"7px 12px 8px",display:"flex",alignItems:"center",gap:7}}>
                <span style={{width:8,height:8,borderRadius:2,background:pal.bg,flexShrink:0,display:"inline-block"}}/>
                <span style={{fontWeight:800,fontSize:12,color:"#2d2d3a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:125}}>{ctxMenu.s.name}</span>
            </div>
            <div className="cdiv"/>
            <button className="ci" onClick={()=>openEdit(ctxMenu.s)}>日時を編集</button>
            <button className="ci" onClick={()=>{setCtxMenu(null);setSelected(ctxMenu.s);}}>詳細を表示</button>
            <div className="cdiv"/>
            <button className="ci red" onClick={()=>askDelete(ctxMenu.s)}>削除する</button>
            </div>);
        })()}

        {/* ── 削除 PIN 確認モーダル ── */}
        {deleteTarget&&<div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setDeleteTarget(null);}}>
            <div className="modal" style={{maxWidth:300}}>
            <div className="drag-bar"/>
            <h2 style={{fontSize:16,fontWeight:800,color:"#2d2d3a",marginBottom:6}}>予定の削除</h2>
            <p style={{fontSize:12,color:"#6b7280",marginBottom:14}}>
                {/* 削除対象の名前をカラーバッジで表示 */}
                <span style={{display:"inline-flex",padding:"2px 9px",borderRadius:18,fontSize:12,background:colorFor(deleteTarget.name).bg,color:colorFor(deleteTarget.name).text,fontWeight:700,marginRight:5}}>{deleteTarget.name}</span>
                を削除するにはPINを入力してください。
            </p>
            {deletePinErr&&<p style={{color:"#dc2626",fontSize:13,fontWeight:600,marginBottom:8}}>{deletePinErr}</p>}
            {/* 数字のみ4桁に制限、Enter で削除実行 */}
            <input className="inp" type="password" inputMode="numeric" maxLength={4} placeholder="4桁のPIN" autoFocus value={deletePinInput} onChange={e=>{setDeletePinInput(e.target.value.replace(/[^0-9]/g,"").slice(0,4));setDeletePinErr("");}} onKeyDown={e=>e.key==="Enter"&&handleDeleteWithPin()}/>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:16}}>
                <button className="btn btn-ghost" onClick={()=>setDeleteTarget(null)}>キャンセル</button>
                <button className="btn btn-red" onClick={handleDeleteWithPin}>削除する</button>
            </div>
            </div>
        </div>}

        {/* ── 編集モーダル ── */}
        {editTarget&&editForm&&<div className="overlay" onClick={e=>{if(e.target===e.currentTarget){setEditTarget(null);setEditForm(null);}}}>
            <div className="modal">
            <div className="drag-bar"/>
            <h2 style={{fontSize:16,fontWeight:800,color:"#2d2d3a",marginBottom:4}}>予定を編集</h2>
            {/* 編集対象の名前バッジと現在の日時を表示 */}
            <div style={{marginBottom:14,display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                <span style={{display:"inline-flex",padding:"3px 10px",borderRadius:18,fontSize:12,background:colorFor(editTarget.name).bg,color:colorFor(editTarget.name).text,fontWeight:700}}>{editTarget.name}</span>
                <span style={{fontSize:11,color:"#9ca3af"}}>{DAYS_JA[editTarget.dayIndex]}曜　{fmtTime(editTarget.startMin)}〜{fmtTime(editTarget.endMin)}</span>
            </div>

            {/* PIN 未確認の場合は PIN 入力フォームを表示 */}
            {!editPinOk?(<>
                <p style={{fontSize:13,color:"#6b7280",marginBottom:4}}>編集するにはPINを入力してください。</p>
                <input className="inp" type="password" inputMode="numeric" maxLength={4}
                placeholder="4桁のPIN" autoFocus
                value={editPinInput}
                onChange={e=>{setEditPinInput(e.target.value.replace(/[^0-9]/g,"").slice(0,4));setEditPinErr("");}}
                onKeyDown={e=>e.key==="Enter"&&handleEditPinSubmit()}/>
                {editPinErr&&<p style={{color:"#dc2626",fontSize:12,fontWeight:600,marginTop:4}}>{editPinErr}</p>}
                <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:16}}>
                <button className="btn btn-ghost" onClick={()=>{setEditTarget(null);setEditForm(null);}}>キャンセル</button>
                <button className="btn btn-purple" onClick={handleEditPinSubmit}>確認</button>
                </div>

            {/* PIN 確認済みの場合は編集フォームを表示 */}
            </>):(<>
                {/* 重複警告・強制保存案内 */}
                {editWarn&&<div className={isAdmin?"wbox-a":"wbox"} style={{marginBottom:10,fontSize:12}}>
                {editWarn}
                {isAdmin&&forceEdit&&<div style={{marginTop:3,fontSize:11,fontWeight:700}}>もう一度押すと強制保存します。</div>}
                </div>}
                <div style={{display:"flex",flexDirection:"column",gap:10}}>

                {/* 曜日・日付の変更 */}
                <div>
                    <label className="lbl">曜日・日付</label>
                    <select className={isAdmin?"inp-a":"inp"} value={editForm.dayIndex} onChange={e=>setEditForm(f=>({...f,dayIndex:+e.target.value}))}>
                    {weekDates.map((dt,i)=><option key={i} value={i}>{DAYS_JA[i]}曜日（{dt.getMonth()+1}/{dt.getDate()}）</option>)}
                    </select>
                </div>

                {/* 開始・終了時間の変更（2時間連動） */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 20px 1fr",gap:6,alignItems:"flex-end"}}>
                    <div>
                    <label className="lbl">開始</label>
                    <div style={{display:"flex",gap:4}}>
                        {/* 開始「時」変更時に終了時間を+2時間に自動更新 */}
                        <select className={isAdmin?"inp-a":"inp"} value={editForm.startH} onChange={e=>{const v=+e.target.value;setEditForm(f=>({...f,startH:v,endH:Math.min(v+2,20)}));setEditWarn("");setForceEdit(false);}}>
                        {hourRange.map(h=><option key={h} value={h}>{h}時</option>)}
                        </select>
                        <select className={isAdmin?"inp-a":"inp"} value={editForm.startM} onChange={e=>{setEditForm(f=>({...f,startM:+e.target.value}));setEditWarn("");setForceEdit(false);}}>
                        {minuteSteps.map(m=><option key={m} value={m}>{String(m).padStart(2,"0")}分</option>)}
                        </select>
                    </div>
                    </div>
                    <div style={{textAlign:"center",paddingBottom:8,color:"#c4c4d4",fontWeight:700}}>→</div>
                    <div>
                    <label className="lbl">終了</label>
                    <div style={{display:"flex",gap:4}}>
                        {/* 終了「時」変更時に開始時間を-2時間に自動更新 */}
                        <select className={isAdmin?"inp-a":"inp"} value={editForm.endH} onChange={e=>{const v=+e.target.value;setEditForm(f=>({...f,endH:v,startH:Math.max(v-2,10)}));setEditWarn("");setForceEdit(false);}}>
                        {hourRange.map(h=><option key={h} value={h}>{h}時</option>)}
                        </select>
                        <select className={isAdmin?"inp-a":"inp"} value={editForm.endM} onChange={e=>{setEditForm(f=>({...f,endM:+e.target.value}));setEditWarn("");setForceEdit(false);}}>
                        {minuteSteps.map(m=><option key={m} value={m}>{String(m).padStart(2,"0")}分</option>)}
                        </select>
                    </div>
                    </div>
                </div>
                </div>

                {/* 変更後のプレビュー表示 */}
                <div style={{marginTop:10,padding:"8px 11px",borderRadius:9,background:"linear-gradient(135deg,rgba(16,185,129,0.06),rgba(5,150,105,0.03))",border:"1px dashed rgba(16,185,129,0.26)",fontSize:12,color:"#065f46",fontWeight:600}}>
                変更後：{DAYS_JA[editForm.dayIndex]}曜　{editForm.startH}:{String(editForm.startM).padStart(2,"0")}〜{editForm.endH}:{String(editForm.endM).padStart(2,"0")}
                </div>

                {/* 管理者のみ PIN を変更できる入力欄を表示 */}
                {isAdmin&&(
                <div style={{marginTop:10}}>
                    <label className="lbl">PIN（4桁・変更する場合）</label>
                    <input className="inp-a" type="password" inputMode="numeric" maxLength={4}
                    placeholder="4桁のPIN" value={editForm.pin||""}
                    onChange={e=>setEditForm(f=>({...f,pin:e.target.value.replace(/[^0-9]/g,"").slice(0,4)}))}/>
                </div>
                )}

                <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:16}}>
                <button className="btn btn-ghost" onClick={()=>{setEditTarget(null);setEditForm(null);}}>キャンセル</button>
                {/* 重複がある場合は「重複を無視して保存」に表示切り替え */}
                <button className="btn btn-green" onClick={handleEditSave} disabled={saving}>{saving?"保存中…":forceEdit?"重複を無視して保存":"変更を保存"}</button>
                </div>
            </>)}
            </div>
        </div>}

        {/* ── 詳細モーダル（スマホでの編集・削除操作用） ── */}
        {selected&&(()=>{
            const pal=colorFor(selected.name);
            const dur=selected.endMin-selected.startMin;
            // 所要時間を「X時間Y分」形式の文字列に変換
            const durL=dur>=60?Math.floor(dur/60)+"時間"+(dur%60>0?dur%60+"分":""):dur+"分";
            return(<div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setSelected(null);}}>
            <div className="modal" style={{maxWidth:340,padding:0,overflow:"hidden"}}>
                {/* 予定の色でトップバーを塗る */}
                <div style={{borderRadius:"20px 20px 0 0",overflow:"hidden"}}>
                <div style={{height:6,background:"linear-gradient(90deg,"+pal.bg+","+pal.bg+"80)"}}/>
                </div>
                <div style={{padding:22}}>
                <div className="drag-bar"/>
                {/* 名前バッジ */}
                <div style={{marginBottom:16}}>
                    <span style={{display:"inline-flex",alignItems:"center",padding:"7px 14px",borderRadius:24,background:pal.bg,color:pal.text,fontSize:14,boxShadow:"0 3px 12px "+pal.bg+"45",fontWeight:800}}>{selected.name}</span>
                </div>
                {/* 日付・時間帯・所要時間の情報行 */}
                <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:20}}>
                    {[{label:"日付",value:selected.dateKey.replace(/-/g,"/")+"（"+DAYS_JA[selected.dayIndex]+"曜日）"},{label:"時間帯",value:fmtTime(selected.startMin)+" 〜 "+fmtTime(selected.endMin)},{label:"所要時間",value:durL}].map(row=>(
                    <div key={row.label} className="irow">
                        <div><div style={{fontSize:10,color:"#9ca3af",fontWeight:800,letterSpacing:"0.5px",textTransform:"uppercase"}}>{row.label}</div>
                        <div style={{fontSize:13,fontWeight:700,color:"#2d2d3a",marginTop:1}}>{row.value}</div></div>
                    </div>
                    ))}
                </div>
                {/* 閉じる・編集・削除ボタン */}
                <div style={{display:"flex",gap:8,marginTop:4}}>
                    <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setSelected(null)}>閉じる</button>
                    <button className="btn btn-ghost" style={{flex:1,color:"#059669",borderColor:"rgba(16,185,129,0.3)"}} onClick={()=>{const s=selected;setSelected(null);openEdit(s);}}>編集</button>
                    <button className="btn btn-red"   style={{flex:1}} onClick={()=>askDelete(selected)}>削除</button>
                </div>
                </div>
            </div>
            </div>);
        })()}

        {/* ── 予定追加モーダル（複数行同時追加対応） ── */}
        {showForm&&<div className="overlay" onClick={e=>{if(e.target===e.currentTarget){setShowForm(false);setRows([]);setGlobalWarn("");}}}>
            <div className="modal" style={{maxWidth:520}}>
            <div className="drag-bar"/>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
                <div>
                <h2 style={{fontSize:16,fontWeight:800,color:"#2d2d3a"}}>予定を追加</h2>
                <p style={{fontSize:11,color:"#9ca3af",marginTop:2}}>{isAdmin?"管理者：名前・日時・PINを設定":"名前・日時・削除用PINを入力"}</p>
                </div>
                {/* 行を追加ボタン：フォームに新しい入力行を増やす */}
                <button className={"btn btn-sm "+(isAdmin?"btn-ghost-amber":"btn-ghost")} onClick={addRow}>+ 行を追加</button>
            </div>
            {/* フォーム全体のエラーメッセージ */}
            {globalWarn&&<div className="wbox" style={{marginBottom:10,fontSize:12}}>{globalWarn}</div>}

            {/* 複数の RowEditor を縦スクロール可能な領域に表示 */}
            <div style={{maxHeight:"52vh",overflowY:"auto",paddingRight:2}}>
                {rows.map((row,idx)=>(
                <RowEditor key={row._id} row={row} idx={idx} rowCount={rows.length} isAdmin={isAdmin} cls={isAdmin?"inp-a":"inp"} weekDates={weekDates} hourRange={hourRange} minuteSteps={minuteSteps} updateRow={updateRow} removeRow={removeRow}/>
                ))}
            </div>

            <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:14,flexWrap:"wrap"}}>
                <button className="btn btn-ghost" onClick={()=>{setShowForm(false);setRows([]);setGlobalWarn("");}}>キャンセル</button>
                {/* 管理者かつ強制追加可能行がある場合は「重複を無視して追加」ボタンを表示 */}
                {isAdmin&&hasForceRows?(
                <button className="btn btn-amber" onClick={handleForceAdd} disabled={saving}>{saving?"保存中…":"重複を無視して追加"}</button>
                ):(
                <button className={"btn "+(isAdmin?"btn-amber":"btn-purple")} onClick={handleAdd} disabled={saving}>{saving?"保存中…":"追加する"}</button>
                )}
            </div>
            </div>
        </div>}
        </div>
    );
}


// React アプリを #root 要素にマウントする
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
