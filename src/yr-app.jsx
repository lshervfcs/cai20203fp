import { useState, useEffect, useRef } from "react";

// ─── face-api.js is loaded via CDN in index.html ───────────────────────────
// Add to your index.html <head>:
// <script defer src="https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js"></script>
// Models must be served from /public/models/ — see README below.

const RASA_URL = "http://localhost:5005";
const MODELS_URL = "/models"; // face-api model weights served from /public/models/

const COLORS = {
  bg: "#0d0a1e", surface: "#1a1535", card: "#211c3a", cardHover: "#2a2448",
  accent: "#7c3aed", accentLight: "#9d5af5", accentGlow: "#6d28d9",
  border: "#2e2850", text: "#f0eeff", muted: "#8b7fb8", danger: "#dc2626",
};

const QUOTES = [
  { text: "Mental health is not a destination, but a process.", author: "Noam Shpancer" },
  { text: "You don't have to be positive all the time.", author: "Lori Deschene" },
  { text: "Self-care is not selfish.", author: "Unknown" },
];

const MOODS = ["😊","😌","😔","🤔","😄","😎","😶"];
const DAYS  = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

const QUICK_REPLIES = [
  "I'm feeling anxious","Help me breathe","I need to vent","Give me motivation",
];

const GAMES = [
  { id:"breathe", name:"Breathe Bubble", desc:"Follow the bubble to breathe deeply and calm your mind", tag:"Calms in 60s",      icon:"🫧", color:"#7c3aed" },
  { id:"mood",    name:"Mood Match",     desc:"Memory card game to help you focus and relax",           tag:"Improves focus",    icon:"🃏", color:"#db2777" },
  { id:"worry",   name:"Worry Jar",      desc:"Write down your worries and watch them disappear",       tag:"Releases tension",  icon:"🫙", color:"#0891b2" },
];

// ─── Utility: load face-api models once ─────────────────────────────────────
let modelsLoaded = false;
async function loadModels() {
  if (modelsLoaded) return;
  const fapi = window.faceapi;
  if (!fapi) throw new Error("face-api.js not loaded");
  await Promise.all([
    fapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL),
    fapi.nets.faceLandmark68TinyNet.loadFromUri(MODELS_URL),
    fapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL),
  ]);
  modelsLoaded = true;
}

// ─── IndexedDB helpers for storing face descriptor ──────────────────────────
const DB_NAME = "yr-face-db", DB_VER = 1, STORE = "descriptors";

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e);
  });
}

async function saveDescriptor(descriptor) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ id: "owner", data: Array.from(descriptor) });
    tx.oncomplete = res; tx.onerror = rej;
  });
}

async function loadDescriptor() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get("owner");
    req.onsuccess = e => res(e.target.result ? new Float32Array(e.target.result.data) : null);
    req.onerror = rej;
  });
}

// ─── FaceUnlock component ────────────────────────────────────────────────────
function FaceUnlock({ onUnlock }) {
  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);
  const streamRef  = useRef(null);
  const loopRef    = useRef(null);

  // step: loading | register | registering | verify | verifying | success | error
  const [step,    setStep]    = useState("loading");
  const [status,  setStatus]  = useState("Loading face models…");
  const [progress,setProgress]= useState(0);

  // Start webcam
  const startCamera = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, facingMode: "user" },
    });
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await new Promise(r => (videoRef.current.onloadedmetadata = r));
      videoRef.current.play();
    }
  };

  const stopCamera = () => {
    clearInterval(loopRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
  };

  // Get a single face descriptor from the live video
  const getDescriptor = async () => {
    const fapi = window.faceapi;
    const opts = new fapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
    const result = await fapi
      .detectSingleFace(videoRef.current, opts)
      .withFaceLandmarks(true)
      .withFaceDescriptor();
    return result?.descriptor ?? null;
  };

  // ── Register flow ────────────────────────────────────────────────────────
  const startRegister = async () => {
    setStep("registering");
    setStatus("Look straight at the camera…");
    setProgress(0);

    const samples = [];
    let attempts = 0;

    await startCamera();

    loopRef.current = setInterval(async () => {
      attempts++;
      setProgress(Math.min(Math.round((samples.length / 5) * 100), 95));

      const desc = await getDescriptor();
      if (desc) {
        samples.push(desc);
        setStatus(`Capturing face… ${samples.length}/5`);
      } else {
        setStatus("No face detected — keep still");
      }

      if (samples.length >= 5) {
        clearInterval(loopRef.current);
        // Average the 5 descriptors for a robust template
        const avg = new Float32Array(128);
        samples.forEach(d => d.forEach((v, i) => { avg[i] += v / samples.length; }));
        await saveDescriptor(avg);
        setProgress(100);
        setStatus("Face registered! ✅");
        setStep("success");
        stopCamera();
        setTimeout(onUnlock, 900);
      }

      if (attempts > 60) {
        clearInterval(loopRef.current);
        stopCamera();
        setStep("error");
        setStatus("Could not capture enough samples. Please try again.");
      }
    }, 400);
  };

  // ── Verify flow ──────────────────────────────────────────────────────────
  const startVerify = async (saved) => {
    setStep("verifying");
    setStatus("Scanning your face…");
    setProgress(0);

    await startCamera();
    const matcher = new window.faceapi.FaceMatcher(
      [new window.faceapi.LabeledFaceDescriptors("owner", [saved])],
      0.50   // distance threshold — lower = stricter (0–1)
    );

    let attempts = 0;
    loopRef.current = setInterval(async () => {
      attempts++;
      setProgress(Math.min(attempts * 6, 90));

      const desc = await getDescriptor();
      if (!desc) {
        setStatus("No face detected — look at the camera");
        return;
      }

      const match = matcher.findBestMatch(desc);
      if (match.label === "owner") {
        clearInterval(loopRef.current);
        setProgress(100);
        setStatus("Identity confirmed ✅");
        setStep("success");
        stopCamera();
        setTimeout(onUnlock, 900);
      } else {
        setStatus(`Checking… (distance ${match.distance.toFixed(2)})`);
      }

      if (attempts > 40) {
        clearInterval(loopRef.current);
        stopCamera();
        setStep("error");
        setStatus("Face not recognised. Please try again.");
      }
    }, 400);
  };

  // ── Init: load models then check if registered ───────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadModels();
        if (cancelled) return;
        const saved = await loadDescriptor();
        if (cancelled) return;
        if (saved) {
          setStep("verify");
          setStatus("Face ID registered. Tap to unlock.");
        } else {
          setStep("register");
          setStatus("No face registered yet. Set up Face ID to continue.");
        }
      } catch (e) {
        if (!cancelled) { setStep("error"); setStatus("Failed to load face models. Check /public/models/."); }
      }
    })();
    return () => { cancelled = true; stopCamera(); };
  }, []);

  const isScanning = step === "registering" || step === "verifying";

  const STEP_META = {
    loading:     { icon: "⏳", title: "Loading Face ID",      btn: null },
    register:    { icon: "👤", title: "Set Up Face ID",        btn: "Register My Face" },
    registering: { icon: null, title: "Registering…",          btn: null },
    verify:      { icon: "🔐", title: "Face ID",               btn: "Scan My Face" },
    verifying:   { icon: null, title: "Verifying…",            btn: null },
    success:     { icon: "✅", title: "Unlocked!",             btn: null },
    error:       { icon: "⚠️", title: "Recognition Failed",    btn: "Try Again" },
  };
  const meta = STEP_META[step];

  const handleBtn = async () => {
    if (step === "register" || (step === "error" && !(await loadDescriptor()))) {
      startRegister();
    } else if (step === "verify" || step === "error") {
      const saved = await loadDescriptor();
      if (saved) startVerify(saved);
      else startRegister();
    }
  };

  // Also allow re-register from verify screen
  const handleReRegister = async () => {
    stopCamera();
    startRegister();
  };

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"0 28px", gap:20 }}>
      <style>{`
        @keyframes spin  { to { transform: rotate(360deg) } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        .scan-ring { animation: spin 2s linear infinite; }
        .face-pulse { animation: pulse 1.5s ease-in-out infinite; }
      `}</style>

      {/* Icon or live camera */}
      <div style={{ position:"relative", width:180, height:180, display:"flex", alignItems:"center", justifyContent:"center" }}>
        {isScanning || step === "success" ? (
          <>
            <video ref={videoRef} playsInline muted style={{
              width:160, height:160, objectFit:"cover", borderRadius:"50%",
              display: step === "success" ? "none" : "block",
              border:`3px solid ${step==="success"?"#22c55e":COLORS.accent}`,
              transform:"scaleX(-1)",
            }}/>
            <canvas ref={canvasRef} style={{ display:"none" }}/>
            {isScanning && (
              <div className="scan-ring" style={{
                position:"absolute", inset:-8, borderRadius:"50%",
                border:`3px solid ${COLORS.accentLight}`,
                borderTopColor:"transparent",
              }}/>
            )}
            {step === "success" && (
              <div style={{ width:160, height:160, borderRadius:"50%", background:`${COLORS.accent}33`, border:`3px solid #22c55e`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:72 }}>✅</div>
            )}
          </>
        ) : (
          <div className={step==="loading"?"face-pulse":""} style={{
            width:160, height:160, borderRadius:"50%",
            background:`${COLORS.accent}22`,
            border:`2px dashed ${COLORS.border}`,
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:72,
          }}>
            {meta.icon}
          </div>
        )}
      </div>

      <h2 style={{ color:COLORS.text, fontSize:20, fontWeight:700, textAlign:"center", margin:0 }}>{meta.title}</h2>
      <p  style={{ color:COLORS.muted, fontSize:14, textAlign:"center", margin:0, minHeight:20 }}>{status}</p>

      {/* Progress bar */}
      {isScanning && (
        <div style={{ width:"100%", height:6, background:COLORS.card, borderRadius:3, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${progress}%`, background:COLORS.accent, borderRadius:3, transition:"width 0.3s" }}/>
        </div>
      )}

      {/* Primary button */}
      {meta.btn && (
        <button onClick={handleBtn} style={{
          background:COLORS.accent, border:"none", borderRadius:14,
          padding:"14px 0", color:"#fff", fontSize:15, fontWeight:600,
          cursor:"pointer", width:"100%",
        }}>{meta.btn}</button>
      )}

      {/* Re-register option on verify screen */}
      {step === "verify" && (
        <button onClick={handleReRegister} style={{
          background:"none", border:`1px solid ${COLORS.border}`, borderRadius:12,
          padding:"10px 0", color:COLORS.muted, fontSize:13, cursor:"pointer", width:"100%",
        }}>Use a different face</button>
      )}

      {step === "register" && (
        <p style={{ color:COLORS.muted, fontSize:12, textAlign:"center", margin:0 }}>
          Your face data is stored <b>only on this device</b> — never uploaded.
        </p>
      )}
    </div>
  );
}

// ─── Minigames ───────────────────────────────────────────────────────────────

function BreatheBubble({ onBack }) {
  const [phase, setPhase] = useState("inhale");
  const [count, setCount] = useState(4);
  const [cycle, setCycle] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    const phases = [
      { name:"inhale", duration:4 }, { name:"hold", duration:4 },
      { name:"exhale", duration:6 }, { name:"rest",  duration:2 },
    ];
    let pi = 0, cnt = phases[0].duration;
    setPhase(phases[0].name); setCount(cnt);
    timerRef.current = setInterval(() => {
      cnt--;
      if (cnt <= 0) {
        pi = (pi + 1) % phases.length;
        if (pi === 0) setCycle(c => c + 1);
        cnt = phases[pi].duration;
        setPhase(phases[pi].name);
      }
      setCount(cnt);
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  const size = phase === "inhale" ? 120 : phase === "exhale" ? 60 : phase === "hold" ? 120 : 80;
  const phaseColors = { inhale:"#7c3aed", hold:"#9d5af5", exhale:"#6d28d9", rest:"#4c1d95" };

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:24, padding:"0 24px" }}>
      <button onClick={onBack} style={{ alignSelf:"flex-start", background:"none", border:"none", color:COLORS.muted, fontSize:14, cursor:"pointer" }}>← Back</button>
      <h2 style={{ color:COLORS.text, fontSize:22, fontWeight:700, margin:0 }}>Breathe Bubble</h2>
      <p style={{ color:COLORS.muted, fontSize:14, margin:0 }}>Cycle {cycle + 1}</p>
      <div style={{ position:"relative", width:200, height:200, display:"flex", alignItems:"center", justifyContent:"center" }}>
        <div style={{ width:size, height:size, borderRadius:"50%", background:`radial-gradient(circle at 35% 35%, ${phaseColors[phase]}99, ${phaseColors[phase]})`, transition:"all 1s ease-in-out", boxShadow:`0 0 40px ${phaseColors[phase]}66` }}/>
      </div>
      <div style={{ textAlign:"center" }}>
        <div style={{ color:COLORS.text, fontSize:28, fontWeight:700, textTransform:"capitalize" }}>{phase}</div>
        <div style={{ color:COLORS.accentLight, fontSize:48, fontWeight:300 }}>{count}</div>
      </div>
    </div>
  );
}

function WorryJar({ onBack }) {
  const [worry,   setWorry]   = useState("");
  const [thrown,  setThrown]  = useState(false);
  const [worries, setWorries] = useState([]);

  const throwIn = () => {
    if (!worry.trim()) return;
    setWorries(w => [...w, worry]);
    setWorry(""); setThrown(true);
    setTimeout(() => setThrown(false), 1500);
  };

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"0 24px", gap:16 }}>
      <button onClick={onBack} style={{ alignSelf:"flex-start", background:"none", border:"none", color:COLORS.muted, fontSize:14, cursor:"pointer", marginTop:8 }}>← Back</button>
      <h2 style={{ color:COLORS.text, fontSize:22, fontWeight:700, margin:0 }}>Worry Jar</h2>
      <p style={{ color:COLORS.muted, fontSize:14, margin:0 }}>Write your worry and let it go</p>
      <div style={{ fontSize:80, textAlign:"center", transition:"transform 0.3s", transform:thrown?"scale(1.2)":"scale(1)" }}>🫙</div>
      <textarea value={worry} onChange={e => setWorry(e.target.value)} placeholder="What's on your mind?"
        style={{ background:COLORS.card, border:`1px solid ${COLORS.border}`, borderRadius:12, padding:12, color:COLORS.text, fontSize:14, resize:"none", height:100, fontFamily:"inherit" }}/>
      <button onClick={throwIn} style={{ background:COLORS.accent, border:"none", borderRadius:12, padding:"12px 0", color:"#fff", fontSize:15, fontWeight:600, cursor:"pointer" }}>Throw it in the jar</button>
      {worries.length > 0 && (
        <div>
          <p style={{ color:COLORS.muted, fontSize:12, marginBottom:8 }}>{worries.length} worries contained</p>
          {worries.slice(-3).map((w,i) => (
            <div key={i} style={{ background:COLORS.card, borderRadius:8, padding:"8px 12px", marginBottom:6, color:COLORS.muted, fontSize:13, opacity:0.6 }}>
              🔒 {w.substring(0,40)}{w.length>40?"...":""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MoodMatch({ onBack }) {
  const emojis = ["😊","😌","😔","😄","🌟","💜","🧘","🌈"];
  const makeCards = () => [...emojis,...emojis].sort(()=>Math.random()-0.5).map((e,i)=>({id:i,emoji:e,flipped:false,matched:false}));
  const [deck,     setDeck]     = useState(makeCards);
  const [selected, setSelected] = useState([]);
  const [moves,    setMoves]    = useState(0);

  const flip = id => {
    if (selected.length === 2) return;
    const card = deck.find(c => c.id === id);
    if (card.flipped || card.matched) return;
    const newDeck = deck.map(c => c.id===id ? {...c,flipped:true} : c);
    const newSel  = [...selected, id];
    setDeck(newDeck); setSelected(newSel);
    if (newSel.length === 2) {
      setMoves(m => m+1);
      const [a,b] = newSel.map(id => newDeck.find(c=>c.id===id));
      if (a.emoji === b.emoji) {
        setDeck(d => d.map(c => newSel.includes(c.id) ? {...c,matched:true} : c));
        setSelected([]);
      } else {
        setTimeout(() => { setDeck(d => d.map(c => newSel.includes(c.id) ? {...c,flipped:false} : c)); setSelected([]); }, 900);
      }
    }
  };

  const matched = deck.filter(c=>c.matched).length/2;
  const done    = matched === emojis.length;

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"0 24px", gap:12 }}>
      <button onClick={onBack} style={{ alignSelf:"flex-start", background:"none", border:"none", color:COLORS.muted, fontSize:14, cursor:"pointer", marginTop:8 }}>← Back</button>
      <h2 style={{ color:COLORS.text, fontSize:20, fontWeight:700, margin:0 }}>Mood Match</h2>
      <div style={{ display:"flex", justifyContent:"space-between" }}>
        <span style={{ color:COLORS.muted, fontSize:13 }}>Moves: {moves}</span>
        <span style={{ color:COLORS.muted, fontSize:13 }}>Matched: {matched}/{emojis.length}</span>
      </div>
      {done && <div style={{ background:COLORS.accent, borderRadius:10, padding:12, color:"#fff", textAlign:"center", fontSize:15, fontWeight:600 }}>🎉 Done in {moves} moves!</div>}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
        {deck.map(card => (
          <div key={card.id} onClick={()=>flip(card.id)} style={{
            background:card.flipped||card.matched?COLORS.card:COLORS.accent,
            borderRadius:10, aspectRatio:"1", display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:28, cursor:card.matched?"default":"pointer",
            opacity:card.matched?0.5:1, transition:"all 0.2s",
            border:`1px solid ${card.flipped?COLORS.accentLight:COLORS.border}`,
          }}>
            {card.flipped||card.matched ? card.emoji : ""}
          </div>
        ))}
      </div>
      {done && <button onClick={()=>{setDeck(makeCards());setMoves(0);}} style={{ background:COLORS.accent, border:"none", borderRadius:12, padding:12, color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}>Play Again</button>}
    </div>
  );
}

// ─── Chat ────────────────────────────────────────────────────────────────────

function ChatScreen() {
  const [unlocked, setUnlocked] = useState(false);
  const [msgs,     setMsgs]     = useState([
    { from:"bot", text:"Hey! I'm Yr, your mental wellbeing companion. I'm here to listen, no judgment. How can I help you today?" },
  ]);
  const [input,  setInput]  = useState("");
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs, typing]);

  const sendMsg = async text => {
    const msg = text || input.trim();
    if (!msg) return;
    setInput("");
    setMsgs(m => [...m, { from:"user", text:msg }]);
    setTyping(true);
    try {
      const res  = await fetch(`${RASA_URL}/webhooks/rest/webhook`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ sender:"user", message:msg }),
      });
      const data    = await res.json();
      const replies = data.map(d=>d.text).filter(Boolean);
      setTyping(false);
      if (replies.length) {
        replies.forEach((r,i) => setTimeout(()=>setMsgs(m=>[...m,{from:"bot",text:r}]), i*400));
      } else {
        setMsgs(m => [...m, { from:"bot", text:"I hear you. Tell me more about how you're feeling." }]);
      }
    } catch {
      setTyping(false);
      const fallbacks = {
        "I'm feeling anxious":  "Anxiety can feel overwhelming, but you're not alone. Try inhaling for 4 counts, holding for 4, exhaling for 6. 💜",
        "Help me breathe":      "Let's breathe together. Inhale slowly for 4… hold for 4… exhale for 6. You're doing great.",
        "I need to vent":       "I'm all ears. No judgment here — go ahead and let it out.",
        "Give me motivation":   "You've made it through 100% of your hard days so far. Keep going. 🌟",
      };
      setMsgs(m => [...m, { from:"bot", text: fallbacks[msg] || "I'm here with you. What you're feeling is valid. 💜" }]);
    }
  };

  if (!unlocked) return <FaceUnlock onUnlock={() => setUnlocked(true)} />;

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", minHeight:0 }}>
      <div style={{ background:COLORS.danger+"22", borderLeft:`3px solid ${COLORS.danger}`, margin:"0 16px 8px", borderRadius:8, padding:"8px 12px", display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontSize:14 }}>⚠️</span>
        <span style={{ color:"#fca5a5", fontSize:13 }}>Need urgent help? <b style={{ textDecoration:"underline", cursor:"pointer" }}>Tap here</b> for crisis resources</span>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:"0 16px", display:"flex", flexDirection:"column", gap:12 }}>
        {msgs.map((m,i) => (
          <div key={i} style={{ display:"flex", justifyContent:m.from==="user"?"flex-end":"flex-start", alignItems:"flex-end", gap:8 }}>
            {m.from==="bot" && (
              <div style={{ width:32, height:32, borderRadius:"50%", background:COLORS.accent, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, flexShrink:0 }}>Y</div>
            )}
            <div style={{
              background:m.from==="bot"?COLORS.card:COLORS.accent,
              borderRadius:m.from==="bot"?"18px 18px 18px 4px":"18px 18px 4px 18px",
              padding:"10px 14px", maxWidth:"78%", color:COLORS.text, fontSize:14, lineHeight:1.5,
            }}>{m.text}</div>
          </div>
        ))}
        {typing && (
          <div style={{ display:"flex", alignItems:"flex-end", gap:8 }}>
            <div style={{ width:32, height:32, borderRadius:"50%", background:COLORS.accent, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>Y</div>
            <div style={{ background:COLORS.card, borderRadius:"18px 18px 18px 4px", padding:"10px 14px" }}>
              <span style={{ color:COLORS.muted }}>●●●</span>
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      <div style={{ padding:"8px 16px", display:"flex", flexWrap:"wrap", gap:8 }}>
        {QUICK_REPLIES.map(q => (
          <button key={q} onClick={()=>sendMsg(q)} style={{ background:COLORS.card, border:`1px solid ${COLORS.border}`, borderRadius:20, padding:"6px 14px", color:COLORS.text, fontSize:13, cursor:"pointer" }}>{q}</button>
        ))}
      </div>

      <div style={{ padding:"8px 16px 16px", display:"flex", gap:10, alignItems:"center" }}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendMsg()} placeholder="Type a message…"
          style={{ flex:1, background:COLORS.card, border:`1px solid ${COLORS.border}`, borderRadius:24, padding:"10px 16px", color:COLORS.text, fontSize:14, fontFamily:"inherit" }}/>
        <button onClick={()=>sendMsg()} style={{ width:44, height:44, borderRadius:"50%", background:COLORS.accent, border:"none", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0, fontSize:18 }}>➤</button>
      </div>
    </div>
  );
}

// ─── Screens ─────────────────────────────────────────────────────────────────

function GamesScreen() {
  const [active, setActive] = useState(null);
  if (active==="breathe") return <BreatheBubble onBack={()=>setActive(null)}/>;
  if (active==="worry")   return <WorryJar      onBack={()=>setActive(null)}/>;
  if (active==="mood")    return <MoodMatch      onBack={()=>setActive(null)}/>;
  return (
    <div style={{ flex:1, overflowY:"auto", padding:"0 16px" }}>
      {GAMES.map(g => (
        <div key={g.id} onClick={()=>setActive(g.id)} style={{ background:COLORS.card, borderRadius:16, padding:16, marginBottom:12, cursor:"pointer", border:`1px solid ${COLORS.border}` }}>
          <div style={{ fontSize:40, marginBottom:8 }}>{g.icon}</div>
          <div style={{ color:COLORS.text, fontSize:17, fontWeight:700, marginBottom:4 }}>{g.name}</div>
          <div style={{ color:COLORS.muted, fontSize:13, marginBottom:10 }}>{g.desc}</div>
          <span style={{ background:`${g.color}33`, color:g.color, fontSize:12, padding:"4px 10px", borderRadius:20, fontWeight:600 }}>{g.tag}</span>
        </div>
      ))}
    </div>
  );
}

function HomeScreen({ setTab }) {
  const quote = QUOTES[0];
  return (
    <div style={{ flex:1, overflowY:"auto", padding:"0 16px" }}>
      <div style={{ background:COLORS.card, borderRadius:16, padding:20, marginBottom:16, border:`1px solid ${COLORS.border}` }}>
        <div style={{ color:COLORS.text, fontSize:16, fontStyle:"italic", lineHeight:1.5, marginBottom:8 }}>"{quote.text}"</div>
        <div style={{ color:COLORS.accentLight, fontSize:13 }}>— {quote.author}</div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        {[
          { icon:"🤖", title:"Chat with Yr",   desc:"I'm here to listen",   tab:"chat"  },
          { icon:"🎮", title:"Minigames",       desc:"Play your stress away", tab:"games" },
          { icon:"📍", title:"Near Me",         desc:"Activities nearby",     tab:null    },
          { icon:"📖", title:"Read Something",  desc:"Short reads, big feels",tab:null    },
        ].map(item => (
          <div key={item.title} onClick={()=>item.tab&&setTab(item.tab)} style={{ background:COLORS.card, borderRadius:16, padding:16, cursor:item.tab?"pointer":"default", border:`1px solid ${COLORS.border}` }}>
            <div style={{ fontSize:32, marginBottom:8 }}>{item.icon}</div>
            <div style={{ color:COLORS.text, fontSize:15, fontWeight:700, marginBottom:4 }}>{item.title}</div>
            <div style={{ color:COLORS.muted, fontSize:12 }}>{item.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfileScreen() {
  return (
    <div style={{ flex:1, overflowY:"auto", padding:"0 16px" }}>
      <div style={{ background:COLORS.card, borderRadius:16, padding:16, marginBottom:12, display:"flex", alignItems:"center", gap:14, border:`1px solid ${COLORS.border}` }}>
        <div style={{ width:52, height:52, borderRadius:"50%", background:`linear-gradient(135deg,${COLORS.accent},#db2777)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:28 }}>😊</div>
        <div>
          <div style={{ color:COLORS.text, fontSize:18, fontWeight:700 }}>Alex</div>
          <div style={{ color:COLORS.muted, fontSize:13 }}>🔥 7-day streak 🔥</div>
        </div>
      </div>
      <div style={{ background:COLORS.card, borderRadius:16, padding:16, marginBottom:12, border:`1px solid ${COLORS.border}` }}>
        <div style={{ color:COLORS.text, fontSize:15, fontWeight:700, marginBottom:14 }}>This Week's Mood</div>
        <div style={{ display:"flex", justifyContent:"space-between" }}>
          {MOODS.map((m,i) => (
            <div key={i} style={{ textAlign:"center" }}>
              <div style={{ fontSize:22, marginBottom:4 }}>{m}</div>
              <div style={{ color:COLORS.muted, fontSize:10 }}>{DAYS[i]}</div>
              <div style={{ width:4, height:4, borderRadius:"50%", background:COLORS.accent, margin:"4px auto 0" }}/>
            </div>
          ))}
        </div>
      </div>
      {[
        { icon:"📌", label:"Saved Quotes",     count:"3 saved" },
        { icon:"💜", label:"Saved Activities", count:"2 saved" },
      ].map(item => (
        <div key={item.label} style={{ background:COLORS.card, borderRadius:16, padding:"14px 16px", marginBottom:10, display:"flex", alignItems:"center", gap:14, border:`1px solid ${COLORS.border}`, cursor:"pointer" }}>
          <div style={{ width:38, height:38, borderRadius:10, background:`${COLORS.accent}33`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>{item.icon}</div>
          <div>
            <div style={{ color:COLORS.text, fontSize:14, fontWeight:600 }}>{item.label}</div>
            <div style={{ color:COLORS.muted, fontSize:12 }}>{item.count}</div>
          </div>
        </div>
      ))}
      <div style={{ color:COLORS.text, fontSize:15, fontWeight:700, margin:"16px 0 8px" }}>Settings</div>
      <div style={{ background:COLORS.card, borderRadius:16, padding:"14px 16px", display:"flex", alignItems:"center", gap:14, border:`1px solid ${COLORS.border}`, cursor:"pointer" }}>
        <span style={{ fontSize:18 }}>🔔</span>
        <span style={{ color:COLORS.text, fontSize:14 }}>Notifications</span>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id:"home",    icon:"🏠", label:"Home"    },
  { id:"chat",    icon:"💬", label:"Chat"    },
  { id:"games",   icon:"🎮", label:"Games"   },
  { id:"profile", icon:"👤", label:"Profile" },
];

export default function YrApp() {
  const [tab, setTab] = useState("home");

  const HEADERS = {
    home:    null,
    chat:    { title:"Chat with Yr",           sub:"I'm here to listen, no judgment"      },
    games:   { title:"Play your stress away 🎮", sub:"Choose a game to relax and recharge" },
    profile: { title:"Profile",                sub:null                                   },
  };

  const header = HEADERS[tab];

  return (
    <div style={{
      width:390, maxWidth:"100%", margin:"0 auto",
      height:"100vh", maxHeight:780,
      background:COLORS.bg, borderRadius:32,
      display:"flex", flexDirection:"column", overflow:"hidden",
      fontFamily:"'Segoe UI', system-ui, sans-serif",
      boxShadow:"0 32px 80px #00000088",
      border:`1px solid ${COLORS.border}`,
    }}>
      <div style={{ padding:"32px 20px 12px", flexShrink:0 }}>
        {tab==="home" ? (
          <>
            <h1 style={{ color:COLORS.text, fontSize:26, fontWeight:700, margin:0 }}>Hey Alex 👋</h1>
            <p  style={{ color:COLORS.muted, fontSize:14, margin:"4px 0 0" }}>You're feeling 😌 today</p>
          </>
        ) : header ? (
          <>
            <h1 style={{ color:COLORS.text, fontSize:20, fontWeight:700, margin:0, textAlign:tab==="chat"?"center":"left" }}>{header.title}</h1>
            {header.sub && <p style={{ color:COLORS.muted, fontSize:13, margin:"3px 0 0", textAlign:tab==="chat"?"center":"left" }}>{header.sub}</p>}
          </>
        ) : null}
      </div>

      <div style={{ flex:1, minHeight:0, display:"flex", flexDirection:"column", overflowY:tab==="chat"?"hidden":"auto" }}>
        {tab==="home"    && <HomeScreen    setTab={setTab}/>}
        {tab==="chat"    && <ChatScreen/>}
        {tab==="games"   && <GamesScreen/>}
        {tab==="profile" && <ProfileScreen/>}
      </div>

      <div style={{ display:"flex", background:COLORS.surface, borderTop:`1px solid ${COLORS.border}`, padding:"8px 0 12px", flexShrink:0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)} style={{ flex:1, background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, padding:"6px 0" }}>
            <div style={{ width:42, height:42, borderRadius:"50%", background:tab===t.id?COLORS.accent:"transparent", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, transition:"all 0.2s" }}>{t.icon}</div>
            <span style={{ color:tab===t.id?COLORS.accentLight:COLORS.muted, fontSize:11, fontWeight:tab===t.id?600:400 }}>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}