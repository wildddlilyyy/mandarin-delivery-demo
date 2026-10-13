export const STATE_KEY = 'delivery-demo:v1:state';
export const SESSION_KEY = 'delivery-demo:v1:user';
export const ACCOUNTS = ['driver01', 'manager01'];
const seedRows = [
  ['20261012192853973', '示範客戶 A', '台北市中山區', '未送達'],
  ['20261013100000001', '示範客戶 B', '新北市板橋區', '未送達'],
  ['20261013100000002', '示範客戶 C', '台北市大安區', '已送達'],
  ['20261013100000003', '示範客戶 D', '台北市信義區', '未送達'],
];
export function seedState() {
  return { version: 1, orders: seedRows.map(([number, recipient, area, status]) => ({ number, recipient, area, status })), queues: { driver01: [], manager01: [] }, batches: [], events: [] };
}
const clone = x => JSON.parse(JSON.stringify(x));
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export class StorageError extends Error {}
export function validateState(s) {
  if (!s || s.version !== 1 || !Array.isArray(s.orders) || s.orders.length !== 4 || !Array.isArray(s.events) || !Array.isArray(s.batches) || !s.queues) throw new StorageError('展示資料格式異常，請確認後重設。');
  const orderSet = new Set(seedRows.map(x => x[0]));
  if (new Set(s.orders.map(o => o.number)).size !== 4 || s.orders.some(o => !o || !orderSet.has(o.number) || typeof o.recipient !== 'string' || typeof o.area !== 'string' || !['未送達', '已送達'].includes(o.status))) throw new StorageError('訂單資料格式異常，請確認後重設。');
  for (const a of ACCOUNTS) if (!Array.isArray(s.queues[a]) || s.queues[a].some(n => typeof n !== 'string' || !orderSet.has(n)) || new Set(s.queues[a]).size !== s.queues[a].length) throw new StorageError('待送出清單格式異常，請確認後重設。');
  if (s.events.some(e => !e || typeof e.id !== 'string' || typeof e.account !== 'string' || typeof e.action !== 'string' || typeof e.result !== 'string' || !Number.isFinite(Date.parse(e.time)))) throw new StorageError('操作紀錄格式異常，請確認後重設。');
  if (s.batches.some(b => !b || typeof b.id !== 'string' || !ACCOUNTS.includes(b.account) || !Number.isFinite(Date.parse(b.time)) || !['running','complete','interrupted'].includes(b.state) || !Array.isArray(b.numbers) || b.numbers.some(n => !orderSet.has(n)) || !Array.isArray(b.results) || b.results.some(r => !r || !orderSet.has(r.number) || !['success','failed','skipped','interrupted'].includes(r.result)))) throw new StorageError('批次資料格式異常，請確認後重設。');
  return s;
}
export class DemoService {
  constructor(storage, session, now = () => new Date().toISOString()) {
    this.storage = storage; this.session = session; this.now = now; this.busy = false;
    this.load(); this.recover();
  }
  load() {
    try { const raw = this.storage.getItem(STATE_KEY); this.state = raw ? validateState(JSON.parse(raw)) : seedState(); if (!raw) this.storage.setItem(STATE_KEY, JSON.stringify(this.state)); }
    catch (e) { throw new StorageError(e instanceof StorageError ? e.message : '無法讀取或保存展示資料，請檢查瀏覽器儲存設定。'); }
  }
  currentUser() { try { const a = this.session.getItem(SESSION_KEY); return ACCOUNTS.includes(a) ? a : null; } catch { throw new StorageError('登入狀態無法保存，請允許此網站使用瀏覽器儲存。'); } }
  requireUser() { const a = this.currentUser(); if (!a) throw new Error('請先登入。'); return a; }
  commit(mutator) {
    const next = clone(this.state); const out = mutator(next);
    try { this.storage.setItem(STATE_KEY, JSON.stringify(next)); }
    catch { throw new StorageError('儲存失敗，這次變更尚未保存。請釋放空間或檢查瀏覽器設定。'); }
    this.state = next; return out;
  }
  event(s, action, extra = {}) {
    const account = this.currentUser();
    s.events.push({ id: uid(), time: this.now(), account: account || '未登入', authenticated: Boolean(account), action, number: null, batchId: null, before: null, after: null, result: 'success', message: '', ...extra });
  }
  appendEvent(action, extra = {}) { this.commit(s => this.event(s, action, extra)); }
  login(account, password) {
    const a = account.trim(); const good = ACCOUNTS.includes(a) && password === 'demo1234';
    if (!good) { this.appendEvent('login_failed', { account: a.slice(0,80) || '未填寫', authenticated: false, result: 'failed', message: '帳號或密碼不正確' }); return false; }
    try { this.session.setItem(SESSION_KEY, a); } catch { throw new StorageError('登入狀態無法保存，請允許瀏覽器儲存。'); }
    try { this.appendEvent('login', { account: a, authenticated: true }); } catch (e) { this.session.removeItem(SESSION_KEY); throw e; }
    return true;
  }
  logout() { if (this.busy) throw new Error('請等待本批次處理完成。'); this.appendEvent('logout'); this.session.removeItem(SESSION_KEY); }
  lookupOrder(number) { return clone(this.state.orders.find(o => o.number === String(number).trim()) || null); }
  queue() { const account = this.requireUser(); return this.state.queues[account].map(n => this.lookupOrder(n)); }
  add(input, source = 'manual_input') {
    const account = this.requireUser(); if (this.busy) throw new Error('正在處理批次。');
    const number = String(input).trim(); if (!number) throw new Error('請輸入訂單編號。');
    const o = this.lookupOrder(number); const q = this.state.queues[account];
    let result = 'added', message = '已加入訂單';
    if (!o) { result = 'unknown'; message = '查無此訂單，請確認編號或使用展示訂單。'; }
    else if (o.status === '已送達') { result = 'delivered'; message = '此訂單已送達，無需再次登記。'; }
    else if (q.includes(number)) { result = 'duplicate'; message = '此訂單已在清單中，已略過重複。'; }
    else if (q.length >= 500) { result = 'limit'; message = '單批最多 500 筆，請先送出目前清單。'; }
    this.commit(s => { this.event(s, source, { number: number.slice(0,200), result, message }); if (result === 'added') s.queues[account].push(number); });
    return { result, message, order: o };
  }
  remove(number) { const a = this.requireUser(); if (this.busy) throw new Error('正在處理批次。'); this.commit(s => { s.queues[a] = s.queues[a].filter(n => n !== number); this.event(s, 'remove_order', { number }); }); }
  recover() {
    if (!this.state.batches.some(b => b.state === 'running')) return;
    this.commit(s => { for (const b of s.batches.filter(b => b.state === 'running')) {
      for (const number of b.numbers.filter(n => !b.results.some(r => r.number === n))) {
        b.results.push({ number, result: 'interrupted', before: s.orders.find(o=>o.number===number).status, after: s.orders.find(o=>o.number===number).status, message: '上次處理中斷，請重新核對後送出。', time: this.now() });
        this.event(s, 'update_interrupted', { account: b.account, authenticated: true, batchId: b.id, number, result: 'interrupted' });
      }
      b.state = 'interrupted';
    }});
  }
  async submitDelivered(onProgress = () => {}, delay = ms => new Promise(r => setTimeout(r,ms))) {
    const a = this.requireUser(); if (this.busy) throw new Error('本批次正在處理，請勿重複送出。');
    const numbers = [...this.state.queues[a]]; if (!numbers.length) throw new Error('清單沒有可送出的訂單。');
    const id = uid(); this.busy = true;
    try {
      this.commit(s => { s.batches.push({ id, account:a, time:this.now(), state:'running', numbers, results:[] }); this.event(s,'batch_submit',{batchId:id,message:`${numbers.length} 筆 → 已送達`}); });
      for (let i=0;i<numbers.length;i++) {
        await delay(350); const number = numbers[i];
        this.commit(s => {
          const b=s.batches.find(b=>b.id===id); if(b.results.some(r=>r.number===number))return;
          const o=s.orders.find(o=>o.number===number), before=o.status;
          const result=before==='已送達'?'skipped':number==='20261013100000003'?'failed':'success';
          if(result==='success')o.status='已送達';
          const message=result==='failed'?'示範更新失敗；原狀態保留。':result==='skipped'?'已送達，略過修改。':'已更新模擬訂單，未同步 SHOPLINE。';
          const r={number,result,before,after:o.status,message,time:this.now()};b.results.push(r);
          this.event(s,'update_delivery',{batchId:id,number,before,after:o.status,result,message});
          s.queues[a]=s.queues[a].filter(n=>n!==number);
        });
        onProgress(i+1,numbers.length);
      }
      this.commit(s=>{s.batches.find(b=>b.id===id).state='complete';this.event(s,'batch_complete',{batchId:id});});
      return clone(this.state.batches.find(b=>b.id===id));
    } finally {this.busy=false;}
  }
  batch(id) { this.requireUser(); return clone(this.state.batches.find(b=>b.id===id)||null); }
  events(filters = {}) { this.requireUser(); return clone(this.state.events.filter(e => this.match(e, filters)).slice().reverse()); }
  match(e,f) {
    const parts=new Intl.DateTimeFormat('en',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(e.time));
    const value=type=>parts.find(p=>p.type===type).value;
    const day=`${value('year')}-${value('month')}-${value('day')}`;
    return (!f.account || e.account===f.account) && (!f.result||e.result===f.result) && (!f.action||e.action===f.action) && (!f.from||day>=f.from) && (!f.to||day<=f.to);
  }
  history(filters={}) {
    this.requireUser(); const rows=[];
    for(const o of this.state.orders){const events=this.state.events.filter(e=>e.action==='update_delivery'&&e.number===o.number);const matching=events.filter(e=>this.match(e,filters));
      if(matching.length){const e=matching.at(-1);if(!filters.query || (o.number+' '+o.recipient).includes(filters.query.trim()))rows.push({...o,event:clone(e)});}}
    return rows.sort((a,b)=>b.event.time.localeCompare(a.event.time));
  }
  detail(number) {this.requireUser();const order=this.lookupOrder(number);return order?{order,events:this.events().filter(e=>e.number===number)}:null;}
  resetDemo() { if(this.busy)throw new Error('請等待批次完成。'); const next=seedState();this.event(next,'demo_reset',{message:'使用者確認重設展示資料'});try{this.storage.setItem(STATE_KEY,JSON.stringify(next));}catch{throw new StorageError('重設失敗，請檢查瀏覽器儲存設定。');}this.state=next; }
}
