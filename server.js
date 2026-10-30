const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static('public'));
app.get('/health', (_, res) => res.json({ ok: true, service: 'spy-impostor' }));

const rooms = new Map();
const WORD_PAIRS = [
  ['Airport','Railway Station'], ['Coffee','Tea'], ['Cricket','Football'],
  ['Beach','Swimming Pool'], ['Doctor','Nurse'], ['Hotel','Restaurant'],
  ['Laptop','Tablet'], ['Library','Bookstore'], ['Mountain','Hill'],
  ['Cinema','Theatre'], ['Bus','Train'], ['Pizza','Burger'],
  ['Guitar','Piano'], ['School','University'], ['Museum','Art Gallery'],
  ['Supermarket','Shopping Mall'], ['Camera','Camcorder'], ['Sailing','Fishing'],
  ['Camping','Hiking'], ['Desert','Savannah'], ['Wedding','Birthday Party'],
  ['Firefighter','Police Officer'], ['Airport','Seaport'], ['Pen','Pencil']
];
const cleanName = s => String(s || '').trim();
const validRoomName = s => /^[A-Za-z0-9_]{1,10}$/.test(s);
const code = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const pick = a => a[Math.floor(Math.random() * a.length)];
const publicRoom = r => ({ name:r.name, code:r.code, phase:r.phase, round:r.round, totalRounds:5,
  players:r.players.map(p=>({id:p.id,name:p.name,host:p.id===r.host,connected:p.connected,score:p.score,reverts:p.reverts})),
  deadline:r.deadline, clues:r.clues.map(c=>({playerId:c.playerId,playerName:r.players.find(p=>p.id===c.playerId)?.name,text:c.text})),
  chat:r.chat.slice(-30), votesSubmitted:Object.keys(r.votes).length, voteCount:r.players.length, eligibleIds:r.phase==='revote'?r.tiedCandidates: null,
  results:r.results, message:r.message, pair:r.phase==='results'?r.pair:null,
  spyId:r.phase==='results'?r.spyId:null, spyGuess:r.phase==='results'?r.spyGuess:null,
  voteSummary:r.phase==='results'?r.voteSummary:null
});
function emitRoom(r) { io.to(r.code).emit('room:update', publicRoom(r)); }
function player(r,id) { return r.players.find(p=>p.id===id); }
function error(s,msg) { s.emit('game:error',msg); }
function timer(r,ms,fn) {
  clearTimeout(r.timer); r.deadline=Date.now()+ms; emitRoom(r);
  r.timer=setTimeout(()=>{ if(rooms.get(r.code)===r) fn(); },ms);
}
function phase(r,p,ms,fn) { r.phase=p; timer(r,ms,fn); }
function startRound(r) {
  if(r.players.length<2) { r.phase='lobby'; r.message='At least two connected players are required.'; emitRoom(r); return; }
  r.round++;
  r.clues=[]; r.chat=[]; r.votes={}; r.isRevote=false; r.tiedCandidates=[]; r.voteSummary=null; r.spyGuess=null; r.guessCorrect=false; r.results=null; r.message='Check your private role and word.';
  let candidates=r.players.filter(p=>p.id!==r.lastSpyId);
  if(!candidates.length) candidates=r.players;
  const spy=pick(candidates); r.spyId=spy.id; r.lastSpyId=spy.id;
  const pair=pick(WORD_PAIRS.filter((_,i)=>!r.usedPairs.includes(i)) .length ? WORD_PAIRS.map((p,i)=>({p,i})).filter(x=>!r.usedPairs.includes(x.i)) : WORD_PAIRS.map((p,i)=>({p,i})));
  r.usedPairs.push(pair.i); r.pair=pair.p; r.players.forEach(p=>{p.role=p.id===spy.id?'spy':'civilian'; p.word=p.id===spy.id?pair.p[1]:pair.p[0]; p.submitted=false;});
  if(r.players.length===2) r.message='Duel mode: exchange clues, then the Spy guesses the Civilian word.';
  phase(r,'role',10000,()=>phase(r,'clues',45000,()=>beginDiscussion(r)));
  r.players.forEach(p=>io.to(p.id).emit('role:private',{role:p.role,word:p.word,round:r.round,duel:r.players.length===2}));
}
function beginDiscussion(r) { r.phase='discussion'; r.message='Discuss the clues. The Spy is preparing a word guess.'; timer(r,30000,()=>beginGuess(r)); }
function beginGuess(r) {
  r.phase='guess'; r.message='Spy: submit your guess now. Everyone else, wait for voting.'; emitRoom(r);
  const spy=player(r,r.spyId); if(spy) io.to(spy.id).emit('guess:prompt',{wordLength:r.pair[0].length,seconds:10});
  timer(r,10000,()=>beginVoting(r));
}
function beginVoting(r) {
  r.votes={}; r.phase='voting'; r.message=r.players.length===2?'Duel result is determined by the Spy word guess.':'Vote for the player you believe is the Spy.';
  if(r.players.length===2) { finishRound(r); return; }
  timer(r,20000,()=>finishRound(r));
}
function finishRound(r) {
  clearTimeout(r.timer); r.deadline=null;
  const counts={}; Object.values(r.votes).forEach(id=>counts[id]=(counts[id]||0)+1);
  let max=0; Object.values(counts).forEach(n=>max=Math.max(max,n));
  const leaders=Object.keys(counts).filter(id=>counts[id]===max);
  const tied=leaders.length>1 || leaders.length===0;
  if(!r.isRevote && leaders.length>1 && r.players.length>2){r.isRevote=true;r.tiedCandidates=leaders;r.votes={};r.phase='revote';r.message='The vote is tied. Revote between the tied players.';timer(r,15000,()=>finishRound(r));return emitRoom(r);}
  const caught=!tied && leaders[0]===r.spyId;
  if(r.players.length===2) {
    const spyWins=r.guessCorrect;
    r.players.forEach(p=>{ if(p.role==='spy' && spyWins) p.score+=150; if(p.role==='civilian' && !spyWins) p.score+=100; });
  } else {
    r.players.forEach(p=>{ if(p.role==='civilian' && r.votes[p.id]===r.spyId) p.score+=100; });
    const spy=player(r,r.spyId); if(spy && !caught) spy.score+=tied?100:150;
  }
  if(r.guessCorrect) { const spy=player(r,r.spyId); if(spy) spy.score+=50; }
  r.voteSummary=r.players.map(p=>({playerId:p.id,playerName:p.name,votedFor:r.votes[p.id]||null}));
  r.results={caught,spyEscaped:!caught,topVoted:leaders.map(id=>({id,name:player(r,id)?.name})),tie:tied,
    civilianWord:r.pair[0],spyWord:r.pair[1],spyName:player(r,r.spyId)?.name,guessCorrect:r.guessCorrect,
    guess:r.spyGuess,points:r.players.map(p=>({id:p.id,name:p.name,score:p.score}))};
  r.phase='results'; r.message=caught?'The Spy was caught!':'The Spy escaped!'; emitRoom(r);
  if(r.round>=5) { timer(r,'10000',()=>{r.phase='finished';r.message='Tournament complete!';emitRoom(r);}); }
  else timer(r,10000,()=>startRound(r));
}
function spendRevert(p) { if(p.reverts<=0) return false; p.reverts--; return true; }
function scheduleFinalize(r, p, kind) {
  p.pending[kind]=true;
  setTimeout(()=>{ if(!rooms.has(r.code))return; p.pending[kind]=false; },5000);
}

io.on('connection', socket => {
  socket.on('room:create', ({roomName,playerName}) => {
    roomName=cleanName(roomName); playerName=cleanName(playerName).slice(0,20);
    if(!validRoomName(roomName)) return error(socket,'Room name must be 1–10 characters: letters, numbers, or underscore only.');
    if(!playerName) return error(socket,'Enter a player name.');
    const key=roomName.toLowerCase();
    if([...rooms.values()].some(r=>r.name.toLowerCase()===key)) return error(socket,'That room name is already in use. Choose another.');
    let c=code(); while(rooms.has(c)) c=code();
    const p={id:socket.id,name:playerName,score:0,reverts:3,connected:true,pending:{}};
    const r={name:roomName,code:c,host:socket.id,players:[p],phase:'lobby',round:0,clues:[],chat:[],votes:{},usedPairs:[],lastSpyId:null,deadline:null,timer:null,results:null,message:'Waiting for players.'};
    rooms.set(c,r); socket.join(c); socket.emit('room:joined',{code:c,roomName}); emitRoom(r);
  });
  socket.on('room:join', ({roomCode,playerName}) => {
    const c=String(roomCode||'').trim().toUpperCase(), r=rooms.get(c), name=cleanName(playerName).slice(0,20);
    if(!r) return error(socket,'Room not found. Check the joining code.');
    if(r.phase!=='lobby') return error(socket,'This game has already started.');
    if(r.players.length>=8) return error(socket,'This room is full.');
    if(!name) return error(socket,'Enter a player name.');
    if(r.players.some(p=>p.name.toLowerCase()===name.toLowerCase())) return error(socket,'That player name is already taken in this room.');
    r.players.push({id:socket.id,name,score:0,reverts:3,connected:true,pending:{}}); socket.join(c); socket.emit('room:joined',{code:c,roomName:r.name}); emitRoom(r);
  });
  socket.on('game:start',()=>{const r=[...rooms.values()].find(x=>x.players.some(p=>p.id===socket.id)); if(!r)return; if(r.host!==socket.id)return error(socket,'Only the host can start the game.'); if(r.phase!=='lobby')return; if(r.players.length<2)return error(socket,'At least two players are required.'); startRound(r);});
  socket.on('clue:submit',({text})=>{const r=[...rooms.values()].find(x=>x.players.some(p=>p.id===socket.id));if(!r||r.phase!=='clues')return;const p=player(r,socket.id);if(!p||p.submitted)return;const clue=String(text||'').trim().slice(0,60);if(!clue)return error(socket,'Enter a clue first.');if(clue.toLowerCase()===p.word.toLowerCase())return error(socket,'You cannot submit your exact secret word.');p.submitted=true;r.clues.push({playerId:p.id,text:clue,at:Date.now()});p.lastClue=clue;p.clueReverted=false;scheduleFinalize(r,p,'clue');if(r.clues.length===r.players.length){clearTimeout(r.timer);timer(r,5000,()=>beginDiscussion(r));}else emitRoom(r);});
  socket.on('chat:send',({text})=>{const r=[...rooms.values()].find(x=>x.players.some(p=>p.id===socket.id));if(!r||r.phase!=='discussion')return;const p=player(r,socket.id),msg=String(text||'').trim().slice(0,180);if(!p||!msg)return;r.chat.push({playerId:p.id,playerName:p.name,text:msg});emitRoom(r);});
  socket.on('spy:guess',({word})=>{const r=[...rooms.values()].find(x=>x.players.some(p=>p.id===socket.id));if(!r||r.phase!=='guess'||r.spyId!==socket.id||r.spyGuess!==null)return;const guess=String(word||'').trim().slice(0,60);if(!guess)return error(socket,'Enter your guess.');r.spyGuess=guess;r.guessCorrect=guess.toLowerCase()===r.pair[0].toLowerCase();beginVoting(r);});
  socket.on('vote:submit',({targetId})=>{const r=[...rooms.values()].find(x=>x.players.some(p=>p.id===socket.id));if(!r||!['voting','revote'].includes(r.phase))return;const p=player(r,socket.id);if(!p||r.votes[socket.id])return;if(targetId===socket.id||!player(r,targetId))return error(socket,'Choose another player.');if(r.phase==='revote'&&!r.tiedCandidates.includes(targetId))return error(socket,'Revote only between the tied candidates.');r.votes[socket.id]=targetId;scheduleFinalize(r,p,'vote');if(Object.keys(r.votes).length===r.players.length){clearTimeout(r.timer);timer(r,5000,()=>finishRound(r));}else emitRoom(r);});
  socket.on('action:revert',({kind})=>{const r=[...rooms.values()].find(x=>x.players.some(p=>p.id===socket.id));if(!r)return;const p=player(r,socket.id);if(!p||!['clue','vote'].includes(kind)||!p.pending[kind])return error(socket,'The five-second revert window has expired.');if(!spendRevert(p))return error(socket,'You have no revert tokens remaining.');p.pending[kind]=false;if(kind==='clue'&&r.phase==='clues'){r.clues=r.clues.filter(c=>c.playerId!==p.id);p.submitted=false;p.lastClue=null;}if(kind==='vote'&&['voting','revote'].includes(r.phase))delete r.votes[p.id];emitRoom(r);});
  socket.on('disconnect',()=>{for(const r of rooms.values()){const p=player(r,socket.id);if(!p)continue;p.connected=false;if(r.host===p.id){const next=r.players.find(x=>x.connected);if(next)r.host=next.id;}emitRoom(r);setTimeout(()=>{const current=player(r,socket.id);if(current&&!current.connected&&r.phase==='lobby'){r.players=r.players.filter(x=>x.id!==socket.id);if(!r.players.length){clearTimeout(r.timer);rooms.delete(r.code);}else emitRoom(r);}},30000);}});
});
server.listen(PORT,()=>console.log(`Spy & Impostor running on port ${PORT}`));
