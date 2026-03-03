import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, get, set } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
const { useState, useEffect, useRef, useCallback } = React;


// ── Firebase 設定 ──────────────────────────────────────────────
const firebaseConfig = {
    apiKey:            "AIzaSyB-nACMRS4MaPbkeYuqqhrbsoIjBJSsM5g",
    authDomain:        "pken-schedule.firebaseapp.com",
    databaseURL:       "https://pken-schedule-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId:         "pken-schedule",
    storageBucket:     "pken-schedule.firebasestorage.app",
    messagingSenderId: "896999009755",
    appId:             "1:896999009755:web:ba18d17906013f2b0d8bfe"
};
const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// Firebase へのキーパス
const DB_SCH_PATH  = "schedules";
const DB_PASS_PATH = "adminPassword";

const DAYS_JA = ["火","水","木","金","土","日","月"];
const DEFAULT_PASS = "pken.admin.1234";

const PALETTE = [
    {bg:"#FF6B9D",text:"#fff"},{bg:"#26C6DA",text:"#fff"},{bg:"#42A5F5",text:"#fff"},
    {bg:"#66BB6A",text:"#fff"},{bg:"#FFA726",text:"#fff"},{bg:"#AB47BC",text:"#fff"},
    {bg:"#5C6BC0",text:"#fff"},{bg:"#E67E22",text:"#fff"},{bg:"#EC407A",text:"#fff"},
    {bg:"#26A69A",text:"#fff"},{bg:"#8D6E63",text:"#fff"},{bg:"#546E7A",text:"#fff"},
];

function colorFor(name) {
    const key = name.trim().toLowerCase();
    let h = 0;
    for (let c of key) h = (h*31 + c.charCodeAt(0)) % PALETTE.length;
    return PALETTE[h];
}
function dateKey(dt) {
    return dt.getFullYear()+"-"+String(dt.getMonth()+1).padStart(2,"0")+"-"+String(dt.getDate()).padStart(2,"0");
}
function fmtTime(min) { return Math.floor(min/60)+":"+String(min%60).padStart(2,"0"); }
function formatDate(dt) { return (dt.getMonth()+1)+"/"+dt.getDate(); }

function buildWeekDates(offsetWeeks) {
    const base = new Date();
    base.setDate(base.getDate() + (offsetWeeks||0)*7);
    const day = base.getDay();
    const diff = day>=2 ? day-2 : day+5;
    const tue = new Date(base);
    tue.setDate(base.getDate()-diff);
    return Array.from({length:7},(_,i)=>{ const dt=new Date(tue); dt.setDate(tue.getDate()+i); return dt; });
}

function defaultStartHour() {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes();
    const slots = [10,12,14,16,18];
    for (const s of slots) {
        if (h < s) return s;
        if (h === s && m === 0) return s;
        if (h >= s && h < s+2) return s+2 <= 20 ? s+2 : 10;
    }
    return 10;
}

function defaultDayIndex(weekDates) {
    const todayKey = dateKey(new Date());
    const idx = weekDates.findIndex(d => dateKey(d) === todayKey);
    return idx >= 0 ? idx : 0;
}

function newRow(weekDates, isAdmin) {
    const sh = defaultStartHour();
    const di = defaultDayIndex(weekDates);
    return { _id: Math.random(), name:"", dayIndex:di, startH:sh, startM:0, endH:Math.min(sh+2,20), endM:0, pin:"" };
}

// RowEditor must be defined at module level (not inside App) to avoid remount on every render
function RowEditor({row, idx, rowCount, isAdmin, cls, weekDates, hourRange, minuteSteps, updateRow, removeRow}) {
    const pal = row.name.trim() ? colorFor(row.name.trim()) : null;
    return (
        <div className={(isAdmin?"row-card-a":"row-card")+(row.warn?" warn-row":"")} style={{marginBottom:12}}>
        {rowCount>1 && (
            <button onClick={()=>removeRow(row._id)} style={{position:"absolute",top:10,right:10,background:"none",border:"none",cursor:"pointer",fontSize:17,color:"#9ca3af",fontWeight:800,lineHeight:1}}>×</button>
        )}
        <div style={{fontWeight:800,fontSize:12,color:isAdmin?"#b45309":"#7c73ff",marginBottom:10}}>予定 {idx+1}</div>

        <div style={{display:"grid",gridTemplateColumns:isAdmin?"1fr":"1fr 120px",gap:10,marginBottom:10}}>
            <div>
            <label className="lbl">名前</label>
            <input className={cls} placeholder="名前" value={row.name} onChange={e=>updateRow(row._id,"name",e.target.value)}/>
            </div>
            {!isAdmin && (
            <div>
                <label className="lbl">PIN（4桁）</label>
                <input className={cls} type="password" inputMode="numeric" maxLength={4}
                defaultValue={row.pin||""}
                onChange={e=>updateRow(row._id,"pin",e.target.value.replace(/[^0-9]/g,"").slice(0,4))}/>
            </div>
            )}
        </div>

        <div style={{marginBottom:10}}>
            <label className="lbl">曜日・日付</label>
            <select className={cls} value={row.dayIndex} onChange={e=>updateRow(row._id,"dayIndex",+e.target.value)}>
            {weekDates.map((dt,i)=><option key={i} value={i}>{DAYS_JA[i]}曜日（{dt.getMonth()+1}/{dt.getDate()}）</option>)}
            </select>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 20px 1fr",gap:6,alignItems:"flex-end"}}>
            <div>
            <label className="lbl">開始</label>
            <div style={{display:"flex",gap:4}}>
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
                <select className={cls} value={row.endH} onChange={e=>updateRow(row._id,"endH",+e.target.value)}>
                {hourRange.map(h=><option key={h} value={h}>{h}時</option>)}
                </select>
                <select className={cls} value={row.endM} onChange={e=>updateRow(row._id,"endM",+e.target.value)}>
                {minuteSteps.map(m=><option key={m} value={m}>{String(m).padStart(2,"0")}分</option>)}
                </select>
            </div>
            </div>
        </div>

        {row.warn && (
            <div className={isAdmin?"wbox-a":"wbox"} style={{marginTop:10,fontSize:12}}>
            {row.warn}
            {isAdmin&&row.forceOk&&<div style={{marginTop:3,fontSize:11,fontWeight:700}}>このまま「追加する」を押すと強制追加します。</div>}
            </div>
        )}

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

function App() {
    const today = new Date();
    const [schedules,setSchedules]=useState([]);
    const [loading,setLoading]=useState(true);
    const [saving,setSaving]=useState(false);

    const [adminPass,setAdminPass]=useState(DEFAULT_PASS);
    const [isAdmin,setIsAdmin]=useState(false);
    const [showLogin,setShowLogin]=useState(false);
    const [loginInput,setLoginInput]=useState("");
    const [loginErr,setLoginErr]=useState("");
    const [weekOffset,setWeekOffset]=useState(0);

    const [showPassChange,setShowPassChange]=useState(false);
    const [passOld,setPassOld]=useState("");
    const [passNew,setPassNew]=useState("");
    const [passNew2,setPassNew2]=useState("");
    const [passErr,setPassErr]=useState("");
    const [passOk,setPassOk]=useState(false);

    // Add modal — multiple rows
    const [showForm,setShowForm]=useState(false);
    const [rows,setRows]=useState([]); // each row: { _id, name, dayIndex, startH, startM, endH, endM, pin, warn, forceOk }
    const [globalWarn,setGlobalWarn]=useState("");

    // Detail modal
    const [selected,setSelected]=useState(null);

    // Context menu
    const [ctxMenu,setCtxMenu]=useState(null);
    const ctxRef=useRef(null);

    // Edit modal
    const [editTarget,setEditTarget]=useState(null);
    const [editForm,setEditForm]=useState(null);
    const [editWarn,setEditWarn]=useState("");
    const [forceEdit,setForceEdit]=useState(false);
    const [editPinInput,setEditPinInput]=useState("");
    const [editPinErr,setEditPinErr]=useState("");
    const [editPinOk,setEditPinOk]=useState(false);

    // Delete PIN modal
    const [deleteTarget,setDeleteTarget]=useState(null);
    const [deletePinInput,setDeletePinInput]=useState("");
    const [deletePinErr,setDeletePinErr]=useState("");

    const weekDates=buildWeekDates(isAdmin?weekOffset:0);

    async function load() {
        try {
        const schSnap  = await get(ref(db, DB_SCH_PATH));
        const passSnap = await get(ref(db, DB_PASS_PATH));
        setSchedules(schSnap.exists()  ? schSnap.val()  : []);
        if (passSnap.exists() && passSnap.val()) setAdminPass(passSnap.val());
        } catch (e) {
        console.error("Firebase read error:", e);
        setSchedules([]);
        }
        setLoading(false);
    }
    async function saveSch(list) {
        await set(ref(db, DB_SCH_PATH), list);
    }
    async function saveAdminPass(p) {
        await set(ref(db, DB_PASS_PATH), p);
    }
    useEffect(()=>{load();},[]);

    useEffect(()=>{
        function h(e){if(ctxRef.current&&!ctxRef.current.contains(e.target))setCtxMenu(null);}
        if(ctxMenu)setTimeout(()=>document.addEventListener("mousedown",h),0);
        return()=>document.removeEventListener("mousedown",h);
    },[ctxMenu]);

    function handleLogin(){
        if(loginInput===adminPass){setIsAdmin(true);setShowLogin(false);setLoginInput("");setLoginErr("");}
        else setLoginErr("パスワードが違います");
    }
    function handleLogout(){setIsAdmin(false);setWeekOffset(0);}

    async function handlePassChange(){
        setPassErr("");setPassOk(false);
        if(passOld!==adminPass){setPassErr("現在のパスワードが違います");return;}
        if(passNew.length<6){setPassErr("新しいパスワードは6文字以上にしてください");return;}
        if(passNew!==passNew2){setPassErr("新しいパスワードが一致しません");return;}
        setAdminPass(passNew);await saveAdminPass(passNew);
        setPassOk(true);setPassOld("");setPassNew("");setPassNew2("");
    }

    const hourRange=isAdmin?Array.from({length:24},(_,i)=>i):Array.from({length:11},(_,i)=>i+10);
    const minuteSteps=isAdmin?Array.from({length:12},(_,i)=>i*5):[0,15,30,45];

    // Check overlap against existing schedules + other rows being added
    function checkOverlapExisting(item, excludeId=null){
        return schedules.filter(s=>s.id!==excludeId&&s.dateKey===item.dateKey&&s.startMin<item.endMin&&s.endMin>item.startMin);
    }
    function checkOverlapRows(item, rowId, pendingRows){
        // check against other rows in the same batch
        return pendingRows.filter(r=>r._id!==rowId&&r.dateKey===item.dateKey&&r.startMin<item.endMin&&r.endMin>item.startMin&&r.startMin!==undefined);
    }

    // Open add form
    function openAdd(){
        setShowForm(true);setGlobalWarn("");
        setRows([newRow(weekDates,isAdmin)]);
    }
    function addRow(){setRows(r=>[...r,newRow(weekDates,isAdmin)]);}
    function removeRow(id){setRows(r=>r.filter(x=>x._id!==id));}
    function updateRow(id,key,val){
        setRows(r=>r.map(x=>x._id===id?{...x,[key]:val,warn:"",forceOk:false}:x));
    }

    async function handleAdd(){
        setGlobalWarn("");
        // Validate each row
        let anyErr=false;
        const validated = rows.map(row=>{
        if(!row.name.trim()) return{...row,warn:"名前を入力してください"};
        const s=row.startH*60+row.startM, e=row.endH*60+row.endM;
        if(e<=s) return{...row,warn:"終了時間は開始時間より後にしてください"};
        if(!isAdmin&&!/^\d{4}$/.test(row.pin||"")) return{...row,warn:"4桁のPINを入力してください"};
        return row;
        });
        const hasFieldErr = validated.some(r=>r.warn&&r.warn!=="");
        if(hasFieldErr){setRows(validated);return;}

        // Build candidate items
        const candidates = rows.map(row=>{
        const s=row.startH*60+row.startM, e=row.endH*60+row.endM;
        return{_id:row._id,name:row.name.trim(),dateKey:dateKey(weekDates[row.dayIndex]),dayIndex:row.dayIndex,startMin:s,endMin:e,pin:isAdmin?null:row.pin};
        });

        // Check overlaps for each
        const withWarn = rows.map((row,i)=>{
        const c=candidates[i];
        const ovEx=checkOverlapExisting(c);
        const ovRow=candidates.filter((cc,j)=>j!==i&&cc.dateKey===c.dateKey&&cc.startMin<c.endMin&&cc.endMin>c.startMin);
        const allOv=[...ovEx,...ovRow];
        if(allOv.length>0&&!row.forceOk){
            const msg="重複あり："+allOv.map(x=>"「"+(x.name||"(他の行)")+"」("+fmtTime(x.startMin)+"〜"+fmtTime(x.endMin)+")").join("、");
            return{...row,warn:msg,forceOk:isAdmin};
        }
        return row;
        });

        const hasOverlapErr=withWarn.some(r=>r.warn&&!r.forceOk);
        if(hasOverlapErr){
        setRows(withWarn);
        if(!isAdmin) return; // normal users: block
        // admin: all forceOk already set, show warning but allow proceed on next click
        const allForce=withWarn.every(r=>!r.warn||(r.warn&&r.forceOk));
        if(!allForce) return;
        }

        // All ok — save
        setSaving(true);
        const newItems=candidates.map((c,i)=>({id:Date.now()+i,name:c.name,dateKey:c.dateKey,dayIndex:c.dayIndex,startMin:c.startMin,endMin:c.endMin,pin:c.pin}));
        const upd=[...schedules,...newItems];setSchedules(upd);await saveSch(upd);
        setSaving(false);setShowForm(false);setRows([]);setGlobalWarn("");
    }

    // Admin: second click force-adds everything
    async function handleForceAdd(){
        setSaving(true);
        const newItems=rows.map((row,i)=>{
        const s=row.startH*60+row.startM, e=row.endH*60+row.endM;
        return{id:Date.now()+i,name:row.name.trim(),dateKey:dateKey(weekDates[row.dayIndex]),dayIndex:row.dayIndex,startMin:s,endMin:e,pin:null};
        });
        const upd=[...schedules,...newItems];setSchedules(upd);await saveSch(upd);
        setSaving(false);setShowForm(false);setRows([]);
    }

    function askDelete(s){
        setCtxMenu(null);setSelected(null);
        if(isAdmin||s.pin===null){doDelete(s.id);return;}
        setDeleteTarget(s);setDeletePinInput("");setDeletePinErr("");
    }
    async function doDelete(id){
        const upd=schedules.filter(s=>s.id!==id);setSchedules(upd);await saveSch(upd);
        setDeleteTarget(null);setSelected(null);setCtxMenu(null);
    }
    function handleDeleteWithPin(){
        if(deletePinInput!==deleteTarget.pin){setDeletePinErr("PINが違います");return;}
        doDelete(deleteTarget.id);
    }

    function openEdit(s){
        setCtxMenu(null);
        setEditTarget(s);setEditWarn("");setForceEdit(false);
        setEditPinInput("");setEditPinErr("");
        setEditForm({dayIndex:s.dayIndex,startH:Math.floor(s.startMin/60),startM:s.startMin%60,endH:Math.floor(s.endMin/60),endM:s.endMin%60});
        setEditPinOk(isAdmin||s.pin===null);
    }
    function handleEditPinSubmit(){
        if(editPinInput!==editTarget.pin){setEditPinErr("PINが違います");return;}
        setEditPinOk(true);setEditPinErr("");
    }
    async function handleEditSave(){
        const s=editForm.startH*60+editForm.startM, e=editForm.endH*60+editForm.endM;
        if(e<=s){setEditWarn("終了時間は開始時間より後にしてください");return;}
        const upd={...editTarget,dayIndex:editForm.dayIndex,dateKey:dateKey(weekDates[editForm.dayIndex]),startMin:s,endMin:e};
        const ov=schedules.filter(x=>x.id!==editTarget.id&&x.dateKey===upd.dateKey&&x.startMin<upd.endMin&&x.endMin>upd.startMin);
        if(ov.length&&!forceEdit){
        setEditWarn("重複あり："+ov.map(x=>"「"+x.name+"」("+fmtTime(x.startMin)+"〜"+fmtTime(x.endMin)+")").join("、"));
        if(isAdmin)setForceEdit(true); return;
        }
        setSaving(true);
        const list=schedules.map(x=>x.id===editTarget.id?upd:x);setSchedules(list);await saveSch(list);
        setSaving(false);setEditTarget(null);setEditForm(null);setForceEdit(false);
    }

    // Calendar
    const viewSch=isAdmin?schedules.filter(s=>weekDates.some(d=>dateKey(d)===s.dateKey)):[];
    const vsH=isAdmin?Math.min(10,...(viewSch.length?viewSch.map(s=>Math.floor(s.startMin/60)):[10])):10;
    const veH=isAdmin?Math.max(20,...(viewSch.length?viewSch.map(s=>Math.ceil(s.endMin/60)):[20])):20;
    const VS=vsH*60,VE=veH*60,VT=VE-VS;
    const pct=min=>((min-VS)/VT)*100;
    const calH = "100%";  // height driven by .cal-body CSS container
    const allH=Array.from({length:veH-vsH+1},(_,i)=>i+vsH);
    const mjH=allH.filter(h=>h%2===0);


    const hasForceRows = rows.some(r=>r.warn&&r.forceOk);

    return(
        <div style={{minHeight:"100vh",background:isAdmin?"linear-gradient(160deg,#fffbeb 0%,#fef3c7 40%,#fff7ed 100%)":"linear-gradient(160deg,#f8f9ff 0%,#eef2ff 50%,#fdf0ff 100%)",fontFamily:"'M PLUS Rounded 1c','Noto Sans JP',sans-serif",transition:"background 0.4s"}}>
        <div style={{position:"fixed",inset:0,overflow:"hidden",zIndex:0,pointerEvents:"none"}}>
            {isAdmin?<>
            <div style={{position:"absolute",width:400,height:400,borderRadius:"50%",background:"rgba(245,158,11,0.07)",filter:"blur(50px)",top:-100,right:-80}}/>
            <div style={{position:"absolute",width:300,height:300,borderRadius:"50%",background:"rgba(251,191,36,0.05)",filter:"blur(50px)",bottom:60,left:-60}}/>
            </>:<>
            <div style={{position:"absolute",width:400,height:400,borderRadius:"50%",background:"rgba(108,99,255,0.07)",filter:"blur(50px)",top:-100,right:-80}}/>
            <div style={{position:"absolute",width:300,height:300,borderRadius:"50%",background:"rgba(255,101,132,0.06)",filter:"blur(50px)",bottom:60,left:-60}}/>
            </>}
        </div>

        <div style={{maxWidth:1160,margin:"0 auto",padding:"20px 14px",position:"relative",zIndex:1}}>

            {/* Header */}
            <div style={{marginBottom:18}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,flexWrap:"wrap"}}>
                <div style={{width:42,height:42,borderRadius:12,flexShrink:0,background:isAdmin?"linear-gradient(135deg,#f59e0b,#d97706)":"linear-gradient(135deg,#6c63ff,#a855f7)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,boxShadow:isAdmin?"0 3px 14px rgba(245,158,11,0.30)":"0 3px 14px rgba(108,99,255,0.30)"}}>{isAdmin?"⚙":"▦"}</div>
                <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                    <h1 style={{fontSize:20,fontWeight:800,color:"#2d2d3a",letterSpacing:"-0.4px"}}>倉庫スケジュール</h1>
                    {isAdmin&&<span className="adm-b">管理者モード</span>}
                </div>
                <p style={{fontSize:11,color:"#9ca3af",marginTop:1,fontWeight:500}}>
                    {isAdmin?weekDates[0].getFullYear()+"/"+formatDate(weekDates[0])+"（火）〜 "+weekDates[6].getFullYear()+"/"+formatDate(weekDates[6])+"（月）":formatDate(weekDates[0])+"（火）〜 "+formatDate(weekDates[6])+"（月）"}
                </p>
                </div>
            </div>

            {/* Controls row */}
            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                {isAdmin&&<>
                <button className="wkbtn" onClick={()=>setWeekOffset(w=>w-1)}>◀ 前週</button>
                <button className="wkbtn" style={{background:weekOffset===0?"rgba(245,158,11,0.18)":"rgba(245,158,11,0.09)"}} onClick={()=>setWeekOffset(0)}>今週</button>
                <button className="wkbtn" onClick={()=>setWeekOffset(w=>w+1)}>次週 ▶</button>
                <div style={{width:1,height:24,background:"rgba(245,158,11,0.25)",margin:"0 2px"}}/>
                </>}
                <button className={"btn btn-sm "+(isAdmin?"btn-ghost-amber":"btn-ghost")} onClick={load}>更新</button>
                <button className={"btn btn-sm "+(isAdmin?"btn-amber":"btn-purple")} onClick={openAdd}>+ 予定を追加</button>
                {isAdmin?<>
                <button className="btn btn-sm btn-ghost-amber" onClick={()=>{setShowPassChange(true);setPassErr("");setPassOk(false);setPassOld("");setPassNew("");setPassNew2("");}}>PW変更</button>
                <button className="btn btn-sm btn-ghost-amber" onClick={handleLogout}>ログアウト</button>
                </>:<button className="btn btn-sm btn-ghost" onClick={()=>{setShowLogin(true);setLoginErr("");setLoginInput("");}}>管理</button>}
            </div>
            </div>

            {/* Calendar */}
            <div className={isAdmin?"admin-glass":"glass"} style={{borderRadius:18}}>
            <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
                <div style={{minWidth:520}}>  {/* スマホで横スクロール: 最低幅を確保 */}
                {/* Day headers */}
                <div style={{display:"flex",background:isAdmin?"linear-gradient(135deg,rgba(245,158,11,0.07),rgba(217,119,6,0.03))":"linear-gradient(135deg,rgba(108,99,255,0.05),rgba(168,85,247,0.03))",borderBottom:isAdmin?"1px solid rgba(245,158,11,0.15)":"1px solid rgba(108,99,255,0.09)"}}>
                    <div style={{width:48,flexShrink:0}}/>
                    {weekDates.map((dt,i)=>{
                    const isT=dateKey(dt)===dateKey(today),isSat=i===4,isSun=i===5;
                    return(<div key={i} style={{flex:1,textAlign:"center",padding:"11px 3px",borderLeft:isAdmin?"1px solid rgba(245,158,11,0.10)":"1px solid rgba(108,99,255,0.07)",background:isT?(isAdmin?"rgba(245,158,11,0.07)":"rgba(108,99,255,0.06)"):"transparent"}}>
                        <div style={{fontSize:16,fontWeight:800,color:isT?(isAdmin?"#d97706":"#6c63ff"):isSat?"#3b82f6":isSun?"#ef4444":"#2d2d3a"}}>{DAYS_JA[i]}</div>
                        <div style={{fontSize:10,color:"#b0b0c4",fontWeight:600,marginTop:1}}>{formatDate(dt)}</div>
                        {isT&&<div style={{marginTop:3}}><span className="today-b">TODAY</span></div>}
                    </div>);
                    })}
                </div>
                {/* Timeline */}
                {loading?<div style={{textAlign:"center",padding:"48px 0",color:"#b0b0c4",fontWeight:600}}>読み込み中...</div>:(
                    <div className="cal-body" style={{display:"flex"}}>
                    <div style={{width:48,flexShrink:0,position:"relative",height:calH}}>
                        {allH.map(h=><div key={h} style={{position:"absolute",top:pct(h*60)+"%",right:7,transform:"translateY(-50%)",fontSize:mjH.includes(h)?10:9,fontWeight:mjH.includes(h)?800:500,color:mjH.includes(h)?(isAdmin?"#d97706":"#7c73ff"):"#d1d5db"}}>{h}:00</div>)}
                    </div>
                    {weekDates.map((dt,dayIdx)=>{
                        const dk=dateKey(dt);
                        const daySch=schedules.filter(s=>s.dateKey===dk);
                        const isT=dk===dateKey(today);
                        return(<div key={dayIdx} className="day-col" style={{height:calH,background:isT?(isAdmin?"rgba(245,158,11,0.022)":"rgba(108,99,255,0.020)"):"transparent",borderLeft:isAdmin?"1px solid rgba(245,158,11,0.08)":"1px solid rgba(108,99,255,0.07)"}}>
                        {allH.map(h=><div key={h} className={mjH.includes(h)?"gl-mj":"gl-mn"} style={{top:pct(h*60)+"%",background:mjH.includes(h)?(isAdmin?"rgba(245,158,11,0.13)":"rgba(108,99,255,0.10)"):(isAdmin?"rgba(245,158,11,0.06)":"rgba(108,99,255,0.05)")}}/>)}
                        {daySch.map(s=>{
                            const pal=colorFor(s.name);
                            const top=pct(s.startMin),ht=pct(s.endMin)-top;
                            return(<div key={s.id} className="blk ba" style={{top:top+"%",height:Math.max(ht,3.5)+"%",background:"linear-gradient(160deg,"+pal.bg+"f0,"+pal.bg+"c8)",boxShadow:"0 2px 10px "+pal.bg+"45"}}
                            onClick={()=>{setSelected(s);setCtxMenu(null);}}
                            onContextMenu={e=>{e.preventDefault();e.stopPropagation();setSelected(null);setCtxMenu({x:e.clientX,y:e.clientY,s});}}>
                            <div style={{fontWeight:800,fontSize:14,color:pal.text,lineHeight:1.3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.name}</div>
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
            <p style={{textAlign:"center",fontSize:11,color:"#c4c4d4",marginTop:10,fontWeight:500}}>左クリックで詳細 / 右クリックで編集・削除</p>
        </div>

        {/* Admin Login */}
        {showLogin&&<div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setShowLogin(false);}}>
            <div className="modal" style={{maxWidth:320}}>
            <div className="drag-bar"/>
            <h2 style={{fontSize:16,fontWeight:800,color:"#2d2d3a",marginBottom:14}}>管理者ログイン</h2>
            {loginErr&&<div className="wbox" style={{marginBottom:10,fontSize:12}}>{loginErr}</div>}
            <div style={{marginBottom:14}}>
                <label className="lbl">パスワード</label>
                <input className="inp-a" type="password" value={loginInput} onChange={e=>{setLoginInput(e.target.value);setLoginErr("");}} onKeyDown={e=>e.key==="Enter"&&handleLogin()} autoFocus/>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button className="btn btn-ghost" onClick={()=>setShowLogin(false)}>キャンセル</button>
                <button className="btn btn-amber" onClick={handleLogin}>ログイン</button>
            </div>
            </div>
        </div>}

        {/* Password Change */}
        {showPassChange&&<div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setShowPassChange(false);}}>
            <div className="modal" style={{maxWidth:360}}>
            <div className="drag-bar"/>
            <h2 style={{fontSize:16,fontWeight:800,color:"#2d2d3a",marginBottom:4}}>パスワードを変更</h2>
            <p style={{fontSize:11,color:"#9ca3af",marginBottom:14}}>管理者ログインに使用するパスワードを変更します。</p>
            {passErr&&<div className="wbox-a" style={{marginBottom:10,fontSize:12}}>{passErr}</div>}
            {passOk&&<div className="sbox" style={{marginBottom:10,fontSize:12}}>パスワードを変更しました。</div>}
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div><label className="lbl">現在のパスワード</label><input className="inp-a" type="password" value={passOld} onChange={e=>{setPassOld(e.target.value);setPassErr("");setPassOk(false);}} autoFocus/></div>
                <div style={{borderTop:"1px solid rgba(245,158,11,0.15)",paddingTop:10}}>
                <div style={{marginBottom:10}}><label className="lbl">新しいパスワード（6文字以上）</label><input className="inp-a" type="password" value={passNew} onChange={e=>{setPassNew(e.target.value);setPassErr("");setPassOk(false);}}/></div>
                <div><label className="lbl">確認</label><input className="inp-a" type="password" value={passNew2} onChange={e=>{setPassNew2(e.target.value);setPassErr("");setPassOk(false);}} onKeyDown={e=>e.key==="Enter"&&handlePassChange()}/></div>
                </div>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:18}}>
                <button className="btn btn-ghost" onClick={()=>setShowPassChange(false)}>閉じる</button>
                <button className="btn btn-amber" onClick={handlePassChange}>変更を保存</button>
            </div>
            </div>
        </div>}

        {/* Context Menu */}
        {ctxMenu&&(()=>{
            const pal=colorFor(ctxMenu.s.name);
            const x=Math.min(ctxMenu.x,window.innerWidth-185),y=Math.min(ctxMenu.y,window.innerHeight-140);
            return(<div ref={ctxRef} className="ctx" style={{left:x,top:y}}>
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

        {/* Delete PIN */}
        {deleteTarget&&<div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setDeleteTarget(null);}}>
            <div className="modal" style={{maxWidth:300}}>
            <div className="drag-bar"/>
            <h2 style={{fontSize:16,fontWeight:800,color:"#2d2d3a",marginBottom:6}}>予定の削除</h2>
            <p style={{fontSize:12,color:"#6b7280",marginBottom:14}}>
                <span style={{display:"inline-flex",padding:"2px 9px",borderRadius:18,fontSize:12,background:colorFor(deleteTarget.name).bg,color:colorFor(deleteTarget.name).text,fontWeight:700,marginRight:5}}>{deleteTarget.name}</span>
                を削除するにはPINを入力してください。
            </p>
            {deletePinErr&&<p style={{color:"#dc2626",fontSize:13,fontWeight:600,marginBottom:8}}>{deletePinErr}</p>}
            <input className="inp" type="password" inputMode="numeric" maxLength={4} placeholder="4桁のPIN" autoFocus value={deletePinInput} onChange={e=>{setDeletePinInput(e.target.value.replace(/[^0-9]/g,"").slice(0,4));setDeletePinErr("");}} onKeyDown={e=>e.key==="Enter"&&handleDeleteWithPin()}/>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:16}}>
                <button className="btn btn-ghost" onClick={()=>setDeleteTarget(null)}>キャンセル</button>
                <button className="btn btn-red" onClick={handleDeleteWithPin}>削除する</button>
            </div>
            </div>
        </div>}

        {/* Edit Modal */}
        {editTarget&&editForm&&<div className="overlay" onClick={e=>{if(e.target===e.currentTarget){setEditTarget(null);setEditForm(null);}}}>
            <div className="modal">
            <div className="drag-bar"/>
            <h2 style={{fontSize:16,fontWeight:800,color:"#2d2d3a",marginBottom:4}}>予定を編集</h2>
            <div style={{marginBottom:14,display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                <span style={{display:"inline-flex",padding:"3px 10px",borderRadius:18,fontSize:12,background:colorFor(editTarget.name).bg,color:colorFor(editTarget.name).text,fontWeight:700}}>{editTarget.name}</span>
                <span style={{fontSize:11,color:"#9ca3af"}}>{DAYS_JA[editTarget.dayIndex]}曜　{fmtTime(editTarget.startMin)}〜{fmtTime(editTarget.endMin)}</span>
            </div>
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
            </>):(<>
                {editWarn&&<div className={isAdmin?"wbox-a":"wbox"} style={{marginBottom:10,fontSize:12}}>
                {editWarn}
                {isAdmin&&forceEdit&&<div style={{marginTop:3,fontSize:11,fontWeight:700}}>もう一度押すと強制保存します。</div>}
                </div>}
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div>
                    <label className="lbl">曜日・日付</label>
                    <select className={isAdmin?"inp-a":"inp"} value={editForm.dayIndex} onChange={e=>setEditForm(f=>({...f,dayIndex:+e.target.value}))}>
                    {weekDates.map((dt,i)=><option key={i} value={i}>{DAYS_JA[i]}曜日（{dt.getMonth()+1}/{dt.getDate()}）</option>)}
                    </select>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 20px 1fr",gap:6,alignItems:"flex-end"}}>
                    <div>
                    <label className="lbl">開始</label>
                    <div style={{display:"flex",gap:4}}>
                        <select className={isAdmin?"inp-a":"inp"} value={editForm.startH} onChange={e=>{setEditForm(f=>({...f,startH:+e.target.value}));setEditWarn("");setForceEdit(false);}}>
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
                        <select className={isAdmin?"inp-a":"inp"} value={editForm.endH} onChange={e=>{setEditForm(f=>({...f,endH:+e.target.value}));setEditWarn("");setForceEdit(false);}}>
                        {hourRange.map(h=><option key={h} value={h}>{h}時</option>)}
                        </select>
                        <select className={isAdmin?"inp-a":"inp"} value={editForm.endM} onChange={e=>{setEditForm(f=>({...f,endM:+e.target.value}));setEditWarn("");setForceEdit(false);}}>
                        {minuteSteps.map(m=><option key={m} value={m}>{String(m).padStart(2,"0")}分</option>)}
                        </select>
                    </div>
                    </div>
                </div>
                </div>
                <div style={{marginTop:10,padding:"8px 11px",borderRadius:9,background:"linear-gradient(135deg,rgba(16,185,129,0.06),rgba(5,150,105,0.03))",border:"1px dashed rgba(16,185,129,0.26)",fontSize:12,color:"#065f46",fontWeight:600}}>
                変更後：{DAYS_JA[editForm.dayIndex]}曜　{editForm.startH}:{String(editForm.startM).padStart(2,"0")}〜{editForm.endH}:{String(editForm.endM).padStart(2,"0")}
                </div>
                <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:16}}>
                <button className="btn btn-ghost" onClick={()=>{setEditTarget(null);setEditForm(null);}}>キャンセル</button>
                <button className="btn btn-green" onClick={handleEditSave} disabled={saving}>{saving?"保存中…":forceEdit?"重複を無視して保存":"変更を保存"}</button>
                </div>
            </>)}
            </div>
        </div>}

        {/* Detail Modal — 編集・削除ボタンあり（スマホでの操作用） */}
        {selected&&(()=>{
            const pal=colorFor(selected.name);
            const dur=selected.endMin-selected.startMin;
            const durL=dur>=60?Math.floor(dur/60)+"時間"+(dur%60>0?dur%60+"分":""):dur+"分";
            return(<div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setSelected(null);}}>
            <div className="modal" style={{maxWidth:340,padding:0,overflow:"hidden"}}>
                <div style={{borderRadius:"20px 20px 0 0",overflow:"hidden"}}>
                <div style={{height:6,background:"linear-gradient(90deg,"+pal.bg+","+pal.bg+"80)"}}/>
                </div>
                <div style={{padding:22}}>
                <div className="drag-bar"/>
                <div style={{marginBottom:16}}>
                    <span style={{display:"inline-flex",alignItems:"center",padding:"7px 14px",borderRadius:24,background:pal.bg,color:pal.text,fontSize:14,boxShadow:"0 3px 12px "+pal.bg+"45",fontWeight:800}}>{selected.name}</span>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:20}}>
                    {[{label:"日付",value:selected.dateKey.replace(/-/g,"/")+"（"+DAYS_JA[selected.dayIndex]+"曜日）"},{label:"時間帯",value:fmtTime(selected.startMin)+" 〜 "+fmtTime(selected.endMin)},{label:"所要時間",value:durL}].map(row=>(
                    <div key={row.label} className="irow">
                        <div><div style={{fontSize:10,color:"#9ca3af",fontWeight:800,letterSpacing:"0.5px",textTransform:"uppercase"}}>{row.label}</div>
                        <div style={{fontSize:13,fontWeight:700,color:"#2d2d3a",marginTop:1}}>{row.value}</div></div>
                    </div>
                    ))}
                </div>
                <div style={{display:"flex",gap:8,marginTop:4}}>
                    <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setSelected(null)}>閉じる</button>
                    <button className="btn btn-ghost" style={{flex:1,color:"#059669",borderColor:"rgba(16,185,129,0.3)"}} onClick={()=>{const s=selected;setSelected(null);openEdit(s);}}>編集</button>
                    <button className="btn btn-red"   style={{flex:1}} onClick={()=>askDelete(selected)}>削除</button>
                </div>
                </div>
            </div>
            </div>);
        })()}

        {/* Add Modal — multiple rows */}
        {showForm&&<div className="overlay" onClick={e=>{if(e.target===e.currentTarget){setShowForm(false);setRows([]);setGlobalWarn("");}}}>
            <div className="modal" style={{maxWidth:520}}>
            <div className="drag-bar"/>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
                <div>
                <h2 style={{fontSize:16,fontWeight:800,color:"#2d2d3a"}}>予定を追加</h2>
                <p style={{fontSize:11,color:"#9ca3af",marginTop:2}}>{isAdmin?"管理者：5分単位・全時間帯":"名前・日時・削除用PINを入力"}</p>
                </div>
                <button className={"btn btn-sm "+(isAdmin?"btn-ghost-amber":"btn-ghost")} onClick={addRow}>+ 行を追加</button>
            </div>
            {globalWarn&&<div className="wbox" style={{marginBottom:10,fontSize:12}}>{globalWarn}</div>}

            <div style={{maxHeight:"52vh",overflowY:"auto",paddingRight:2}}>
                {rows.map((row,idx)=>(
                <RowEditor key={row._id} row={row} idx={idx} rowCount={rows.length} isAdmin={isAdmin} cls={isAdmin?"inp-a":"inp"} weekDates={weekDates} hourRange={hourRange} minuteSteps={minuteSteps} updateRow={updateRow} removeRow={removeRow}/>
                ))}
            </div>

            <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:14,flexWrap:"wrap"}}>
                <button className="btn btn-ghost" onClick={()=>{setShowForm(false);setRows([]);setGlobalWarn("");}}>キャンセル</button>
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


const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
