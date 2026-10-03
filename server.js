import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const db = new Database(path.join(__dirname, 'studyquest.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL COLLATE NOCASE UNIQUE,
 password_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 bio_public TEXT NOT NULL DEFAULT '',
 goal_public TEXT NOT NULL DEFAULT '',
 learning_public TEXT NOT NULL DEFAULT '',
 daily_goal_min INTEGER NOT NULL DEFAULT 180,
 session_min INTEGER NOT NULL DEFAULT 60,
 spins INTEGER NOT NULL DEFAULT 3,
 total_minutes INTEGER NOT NULL DEFAULT 0,
 study_days INTEGER NOT NULL DEFAULT 0,
 current_streak INTEGER NOT NULL DEFAULT 0,
 best_streak INTEGER NOT NULL DEFAULT 0,
 last_completed_date TEXT,
 xp INTEGER NOT NULL DEFAULT 0,
 level INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS study_sessions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 started_at INTEGER NOT NULL,
 ends_at INTEGER NOT NULL,
 duration_min INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'active',
 completed_at INTEGER,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS daily_stats (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 stat_date TEXT NOT NULL,
 minutes INTEGER NOT NULL DEFAULT 0,
 goal_met INTEGER NOT NULL DEFAULT 0,
 UNIQUE(user_id, stat_date),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS penalties (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 source_date TEXT NOT NULL,
 title TEXT NOT NULL,
 description TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(user_id, source_date),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS private_notes (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 content TEXT NOT NULL DEFAULT '',
 updated_at INTEGER NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS friend_requests (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 sender_id INTEGER NOT NULL,
 receiver_id INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 created_at INTEGER NOT NULL,
 UNIQUE(sender_id, receiver_id),
 FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS friends (
 user_id INTEGER NOT NULL,
 friend_id INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id, friend_id),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(friend_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

app.use(express.json({limit:'32kb'}));
app.use(session({secret:process.env.SESSION_SECRET||'study-quest-change-this-secret',resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:false,maxAge:1000*60*60*24*7}}));
app.use(express.static(__dirname));

const today=()=>new Date().toISOString().slice(0,10);
const levelForXp=xp=>Math.max(1,Math.floor(Math.sqrt(xp/100))+1);
const xpForNext=level=>level*level*100;
function category(minutes){if(minutes>=600)return 'Extreme Learner';if(minutes>=300)return 'Hardcore Learner';if(minutes>=180)return 'Serious Learner';if(minutes>=60)return 'Casual Learner';return 'Starting Learner';}
function requireAuth(req,res,next){if(!req.session.userId)return res.status(401).json({error:'LOGIN_REQUIRED'});next();}
function userRow(id){return db.prepare('SELECT * FROM users WHERE id=?').get(id);}
function publicUser(u){return {id:u.id,username:u.username,level:u.level,xp:u.xp,nextXp:xpForNext(u.level),streak:u.current_streak,bestStreak:u.best_streak,totalMinutes:u.total_minutes,studyDays:u.study_days,category:category(u.total_minutes),bio:u.bio_public,goal:u.goal_public,learning:u.learning_public,spins:u.spins,dailyGoal:u.daily_goal_min,sessionMin:u.session_min};}
function recalcLevel(id){const u=userRow(id);const level=levelForXp(u.xp);if(level!==u.level)db.prepare('UPDATE users SET level=? WHERE id=?').run(level,id);return level;}
function ensureDaily(id){const d=today();let s=db.prepare('SELECT * FROM daily_stats WHERE user_id=? AND stat_date=?').get(id,d);if(!s){db.prepare('INSERT INTO daily_stats(user_id,stat_date) VALUES(?,?)').run(id,d);s=db.prepare('SELECT * FROM daily_stats WHERE user_id=? AND stat_date=?').get(id,d);}return s;}
function ensurePenalty(id){const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);const prev=db.prepare('SELECT goal_met FROM daily_stats WHERE user_id=? AND stat_date=?').get(id,yesterday);if(prev&&!prev.goal_met){let p=db.prepare('SELECT * FROM penalties WHERE user_id=? AND source_date=?').get(id,yesterday);if(!p){const options=[['📚 Tomorrow +30','พรุ่งนี้ต้องเรียนเพิ่ม 30 นาที'],['🧠 Brain Tax','พรุ่งนี้ทำโจทย์เพิ่ม 5 ข้อ'],['✍️ Reflection','เขียนสรุปว่าทำไมวันนี้ไม่ครบ และพรุ่งนี้จะแก้อย่างไร'],['⏱️ Extra Round','พรุ่งนี้ต้องเรียนเพิ่มอีก 1 Session']];const x=options[Math.floor(Math.random()*options.length)];db.prepare('INSERT INTO penalties(user_id,source_date,title,description,created_at) VALUES(?,?,?,?,?)').run(id,yesterday,x[0],x[1],Date.now());p=db.prepare('SELECT * FROM penalties WHERE user_id=? AND source_date=?').get(id,yesterday);}return p;}return null;}
function updateDailyAndStreak(id){const u=userRow(id);const s=ensureDaily(id);if(!s.goal_met && s.minutes>=u.daily_goal_min){db.prepare('UPDATE daily_stats SET goal_met=1 WHERE id=?').run(s.id);const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);const prev=db.prepare('SELECT goal_met FROM daily_stats WHERE user_id=? AND stat_date=?').get(id,yesterday);const streak=prev?.goal_met?u.current_streak+1:1;db.prepare('UPDATE users SET current_streak=?,best_streak=MAX(best_streak,?),study_days=study_days+1,last_completed_date=? WHERE id=?').run(streak,streak,today(),id);}}

app.post('/api/register',async(req,res)=>{const {username,password,confirmPassword}=req.body;if(!username?.trim()||!password||password!==confirmPassword)return res.status(400).json({error:'ข้อมูลสมัครไม่ถูกต้อง'});if(username.trim().length>24||password.length<6)return res.status(400).json({error:'Username ไม่เกิน 24 ตัวอักษร และ Password อย่างน้อย 6 ตัวอักษร'});try{const hash=await bcrypt.hash(password,12);const info=db.prepare('INSERT INTO users(username,password_hash) VALUES(?,?)').run(username.trim(),hash);const id=Number(info.lastInsertRowid);db.prepare('INSERT INTO private_notes(user_id,content,updated_at) VALUES(?,?,?)').run(id,'',Date.now());req.session.userId=id;res.json({ok:true,user:publicUser(userRow(id))});}catch(e){if(String(e).includes('UNIQUE'))return res.status(409).json({error:'Username นี้ถูกใช้แล้ว'});res.status(500).json({error:'สมัครสมาชิกไม่สำเร็จ'});}});
app.post('/api/login',async(req,res)=>{const u=db.prepare('SELECT * FROM users WHERE username=?').get(req.body.username?.trim());if(!u||!(await bcrypt.compare(req.body.password||'',u.password_hash)))return res.status(401).json({error:'Username หรือ Password ไม่ถูกต้อง'});req.session.userId=u.id;res.json({ok:true,user:publicUser(u)});});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',requireAuth,(req,res)=>{const u=userRow(req.session.userId);const daily=ensureDaily(u.id);const active=db.prepare("SELECT * FROM study_sessions WHERE user_id=? AND status='active' ORDER BY id DESC LIMIT 1").get(u.id);if(active&&Date.now()>=active.ends_at)completeSession(active.id,u.id);const fresh=userRow(u.id);res.json({user:publicUser(fresh),daily:ensureDaily(u.id),penalty:ensurePenalty(u.id),active:db.prepare("SELECT * FROM study_sessions WHERE user_id=? AND status='active' ORDER BY id DESC LIMIT 1").get(u.id)||null,privateNote:db.prepare('SELECT content FROM private_notes WHERE user_id=?').get(u.id)?.content||''});});
app.put('/api/profile',requireAuth,(req,res)=>{const {bio,goal,learning,dailyGoal,sessionMin}=req.body;const dg=Math.min(1440,Math.max(1,Number(dailyGoal)||180));const sm=Math.min(720,Math.max(1,Number(sessionMin)||60));db.prepare('UPDATE users SET bio_public=?,goal_public=?,learning_public=?,daily_goal_min=?,session_min=? WHERE id=?').run(String(bio||'').slice(0,500),String(goal||'').slice(0,500),String(learning||'').slice(0,500),dg,sm,req.session.userId);res.json({user:publicUser(userRow(req.session.userId))});});
app.put('/api/private-note',requireAuth,(req,res)=>{db.prepare('UPDATE private_notes SET content=?,updated_at=? WHERE user_id=?').run(String(req.body.content||'').slice(0,10000),Date.now(),req.session.userId);res.json({ok:true});});
function completeSession(sessionId,userId){const s=db.prepare('SELECT * FROM study_sessions WHERE id=? AND user_id=?').get(sessionId,userId);if(!s||s.status!=='active')return false;if(Date.now()<s.ends_at)return false;db.prepare("UPDATE study_sessions SET status='completed',completed_at=? WHERE id=?").run(Date.now(),sessionId);db.prepare('UPDATE users SET total_minutes=total_minutes+?,xp=xp+?,spins=spins+3 WHERE id=?').run(s.duration_min,s.duration_min, userId);db.prepare('INSERT INTO daily_stats(user_id,stat_date,minutes) VALUES(?,?,?) ON CONFLICT(user_id,stat_date) DO UPDATE SET minutes=minutes+excluded.minutes').run(userId,today(),s.duration_min);updateDailyAndStreak(userId);recalcLevel(userId);return true;}
app.post('/api/timer/start',requireAuth,(req,res)=>{const id=req.session.userId;const existing=db.prepare("SELECT * FROM study_sessions WHERE user_id=? AND status='active'").get(id);if(existing)return res.status(409).json({error:'มี Session กำลังทำงานอยู่',session:existing});const min=Math.min(720,Math.max(1,Number(req.body.minutes)||userRow(id).session_min));const start=Date.now(),end=start+min*60000;const info=db.prepare('INSERT INTO study_sessions(user_id,started_at,ends_at,duration_min) VALUES(?,?,?,?)').run(id,start,end,min);res.json({session:db.prepare('SELECT * FROM study_sessions WHERE id=?').get(info.lastInsertRowid)});});
app.post('/api/timer/check',requireAuth,(req,res)=>{const s=db.prepare("SELECT * FROM study_sessions WHERE user_id=? AND status='active' ORDER BY id DESC LIMIT 1").get(req.session.userId);if(s&&Date.now()>=s.ends_at)completeSession(s.id,req.session.userId);const u=userRow(req.session.userId);res.json({user:publicUser(u),daily:ensureDaily(u.id),active:db.prepare("SELECT * FROM study_sessions WHERE user_id=? AND status='active' ORDER BY id DESC LIMIT 1").get(u.id)||null});});
app.post('/api/timer/abandon',requireAuth,(req,res)=>{const s=db.prepare("SELECT * FROM study_sessions WHERE user_id=? AND status='active' ORDER BY id DESC LIMIT 1").get(req.session.userId);if(!s)return res.json({ok:true});db.prepare("UPDATE study_sessions SET status='abandoned',completed_at=? WHERE id=?").run(Date.now(),s.id);res.json({ok:true});});
const events=[['☕','Coffee Break','พัก 15 นาที แล้วกลับมาเรียนต่อ'],['🎵','Sing Break','ร้องเพลงที่ชอบ 1 เพลง'],['🎮','Gaming Break','เล่นเกม 20 นาที แล้วกลับมา'],['🌿','Walk Break','เดินหรือยืดเส้น 15 นาที'],['😴','Power Nap','งีบ 20 นาที'],['🎬','Mini Entertainment','ดูสิ่งที่ชอบ 20 นาที'],['🧘','Chill 30','วันนี้พักได้ 30 นาที'],['⚡','Boss Fight','ทำโจทย์ยาก 3 ข้อ'],['🧠','Memory Quest','ปิดหนังสือแล้วเขียนสิ่งที่จำได้ 10 ข้อ'],['🎤','Teach It','อธิบายสิ่งที่เรียนให้คนอื่นฟัง 5 นาที'],['🔬','Mini Lab','ทำการทดลองวิทยาศาสตร์ง่าย ๆ ที่ปลอดภัย'],['🎨','Creative Notes','สรุปบทเรียนเป็นแผนภาพ'],['🚀','Future Me','เขียนเป้าหมายอนาคต'],['🏆','Combo Quest','เรียน 25 นาที + พัก 5 นาที จำนวน 3 รอบ']];
app.post('/api/spin',requireAuth,(req,res)=>{const u=userRow(req.session.userId);if(u.spins<=0)return res.status(400).json({error:'No Spins Available'});const e=events[Math.floor(Math.random()*events.length)];db.prepare('UPDATE users SET spins=spins-1 WHERE id=?').run(u.id);res.json({event:{icon:e[0],name:e[1],description:e[2]},spins:u.spins-1});});
app.get('/api/leaderboard',requireAuth,(req,res)=>{const sort=['streak','time','level'].includes(req.query.sort)?req.query.sort:'level';const col={streak:'current_streak',time:'total_minutes',level:'level'}[sort];const rows=db.prepare(`SELECT id,username,level,xp,current_streak,total_minutes FROM users ORDER BY ${col} DESC, id ASC LIMIT 100`).all();res.json({rows:rows.map((u,i)=>({...publicUser({...u,daily_goal_min:180,session_min:60,best_streak:u.current_streak,bio_public:'',goal_public:'',learning_public:'',spins:0,study_days:0},),rank:i+1}))});});
app.get('/api/users/search',requireAuth,(req,res)=>{const q=String(req.query.q||'').trim();if(!q)return res.json({users:[]});const rows=db.prepare('SELECT id,username,level,xp,current_streak,total_minutes,bio_public,goal_public,learning_public FROM users WHERE username LIKE ? AND id<>? LIMIT 20').all('%'+q+'%',req.session.userId);res.json({users:rows.map(u=>publicUser({...u,daily_goal_min:180,session_min:60,best_streak:u.current_streak,spins:0,study_days:0}))});});
app.get('/api/users/:id',requireAuth,(req,res)=>{const u=userRow(Number(req.params.id));if(!u)return res.status(404).json({error:'ไม่พบผู้ใช้'});res.json({user:publicUser(u)});});
app.get('/api/friends',requireAuth,(req,res)=>{const id=req.session.userId;const friends=db.prepare('SELECT u.id,u.username,u.level,u.xp,u.current_streak,u.total_minutes FROM users u JOIN friends f ON f.friend_id=u.id WHERE f.user_id=?').all(id);const incoming=db.prepare('SELECT r.id,u.username,u.level FROM friend_requests r JOIN users u ON u.id=r.sender_id WHERE r.receiver_id=? AND r.status=\'pending\'').all(id);const outgoing=db.prepare('SELECT r.id,u.username,u.level FROM friend_requests r JOIN users u ON u.id=r.receiver_id WHERE r.sender_id=? AND r.status=\'pending\'').all(id);res.json({friends,incoming,outgoing});});
app.post('/api/friends/request',requireAuth,(req,res)=>{const target=Number(req.body.userId);if(target===req.session.userId)return res.status(400).json({error:'เพิ่มตัวเองไม่ได้'});if(!userRow(target))return res.status(404).json({error:'ไม่พบผู้ใช้'});try{db.prepare('INSERT INTO friend_requests(sender_id,receiver_id,created_at) VALUES(?,?,?)').run(req.session.userId,target,Date.now());res.json({ok:true});}catch(e){res.status(409).json({error:'คำขอนี้มีอยู่แล้ว'});}});
app.post('/api/friends/respond',requireAuth,(req,res)=>{const r=db.prepare('SELECT * FROM friend_requests WHERE id=? AND receiver_id=?').get(Number(req.body.requestId),req.session.userId);if(!r)return res.status(404).json({error:'ไม่พบคำขอ'});if(req.body.accept){db.prepare("UPDATE friend_requests SET status='accepted' WHERE id=?").run(r.id);db.prepare('INSERT OR IGNORE INTO friends(user_id,friend_id,created_at) VALUES(?,?,?)').run(r.sender_id,r.receiver_id,Date.now());db.prepare('INSERT OR IGNORE INTO friends(user_id,friend_id,created_at) VALUES(?,?,?)').run(r.receiver_id,r.sender_id,Date.now());}else db.prepare("UPDATE friend_requests SET status='rejected' WHERE id=?").run(r.id);res.json({ok:true});});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.listen(process.env.PORT||3000,()=>console.log('Study Quest running on http://localhost:'+(process.env.PORT||3000)));
