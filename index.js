// bot.js
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('缺少环境变量 BOT_TOKEN');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

const SUPER_ADMIN = 8431715705;
const DATA_FILE = path.join(__dirname, 'users.json');
const ADMINS_FILE = path.join(__dirname, 'admins.json');
const SEEN_RATE = 2;
const COMPARE_RATE = 2;

let ADMINS = [SUPER_ADMIN];
if (fs.existsSync(ADMINS_FILE)) {
  try {
    ADMINS = JSON.parse(fs.readFileSync(ADMINS_FILE, 'utf8'));
  } catch (e) {}
}
// ==================== 加载系统抽水（防止重启清零） ====================
const RAKE_FILE = path.join(__dirname, 'systemRake.json');
let systemRake = 0;

try {
  if (fs.existsSync(RAKE_FILE)) {
    const data = JSON.parse(fs.readFileSync(RAKE_FILE, 'utf8'));
    systemRake = data.total || 0;
    global.systemRake = systemRake;
    console.log(`✅ 系统抽水已加载：${systemRake.toLocaleString()} 金币`);
  } else {
    global.systemRake = 0;
    console.log('📄 未找到 systemRake.json，已初始化为 0');
  }
} catch (e) {
  global.systemRake = 0;
  console.log('⚠️ 系统抽水加载失败，使用默认值 0');
}

function saveAdmins() {
  try { fs.writeFileSync(ADMINS_FILE, JSON.stringify(ADMINS, null, 2)); } catch (e) {}
}

// ==================== 数据 ====================
let users = {};
// ==================== 金币操作记录 ====================
let goldLogs = [];
if (fs.existsSync(DATA_FILE)) {
  try {
    users = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}');
  } catch (e) {
    users = {};
  }
}

function saveSystemRake() {
  try {
    fs.writeFileSync(RAKE_FILE, JSON.stringify({ total: global.systemRake || 0 }, null, 2));
  } catch (e) {
    console.error('保存系统抽水失败:', e);
  }
}
function saveGoldLogs() {
  try {
    fs.writeFileSync(GOLD_LOG_FILE, JSON.stringify(goldLogs, null, 2));
  } catch (e) {
    console.error('保存金币记录失败:', e);
  }
}

function saveUsers() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2)); } catch (e) {}
}

// ==================== 防刷系统 ====================
const cooldowns = {};
setInterval(() => {
  const now = Date.now();
  for (const userId in cooldowns) {
    for (const action in cooldowns[userId]) {
      if (cooldowns[userId][action] < now) delete cooldowns[userId][action];
    }
    if (Object.keys(cooldowns[userId] || {}).length === 0) delete cooldowns[userId];
  }
}, 60000);

function checkCooldown(userId, action, seconds = 2) {
  const now = Date.now();
  if (!cooldowns[userId]) cooldowns[userId] = {};
  if (cooldowns[userId][action] && now < cooldowns[userId][action]) return false;
  cooldowns[userId][action] = now + seconds * 1000;
  return true;
}

// ==================== 用户工具 ====================
function mentionUser(user) {
  return `<a href="tg://user?id=${user.id}">${user.first_name || '玩家'}</a>`;
}

function initUser(id, name) {
  if (!users[id]) {
    users[id] = { 
      id, 
      name: name || '玩家', 

      gold: 0,

      win: 0, 
      lose: 0, 

      checkin: '', 
      exp: 0, 
      level: 1,

      logs: [],

      // ====== 原游戏统计 ======
      gameFlow: 0,

      // ====== 新版炸金花统计（重点） ======
      todayBet: 0,        // 今日总投注（炸金花花出去的钱）
      todayWin: 0,        // 今日赢的钱（纯赢利）
      totalBet: 0,        // 历史总投注
      totalWin: 0,
    luckMultiplier: 1.0,

      lastFlowDate: ''    // 上次统计日期（用于每日重置）
    };

    saveUsers();
    console.log(`[新用户] ${name} (ID:${id}) 初始化完成`);
} else if (name && users[id].name !== name) {
    users[id].name = name;
    saveUsers();
  }
}

// 添加金币流水记录
function addGoldLog(userId, type, amount, remark = '') {
  if (!users[userId]) return;
  if (!users[userId].logs) users[userId].logs = [];

  users[userId].logs.push({
    time: new Date().toLocaleString('zh-CN'),
    type: type,           // 加金币 / 扣金币 / 转账 / 炸金花 等
    amount: amount,       // 正数=增加，负数=减少
    remark: remark
  });

  // 只保留最近 30 条记录
  if (users[userId].logs.length > 30) {
    users[userId].logs.shift();
  }
  saveUsers();
}

// 只统计炸金花游戏流水的函数
function addGameFlow(userId, amount, remark = '') {
  if (!users[userId]) return;

  const absAmount = Math.abs(amount);
  users[userId].gameFlow = (users[userId].gameFlow || 0) + absAmount;

  // 每累计 50万游戏流水 奖励 50 经验
  const oldFlow = users[userId].gameFlow - absAmount;
  const rewardExp = Math.floor(users[userId].gameFlow / 500000) * 50 - 
                    Math.floor(oldFlow / 500000) * 50;

  if (rewardExp > 0) {
    users[userId].exp += rewardExp;
    addExp(userId, 0); // 触发升级
    console.log(`[游戏流水奖励] ${users[userId].name} 获得 ${rewardExp} 经验（累计游戏流水 ${users[userId].gameFlow}）`);
  }

  // 记录流水
  if (!users[userId].logs) users[userId].logs = [];
  users[userId].logs.push({
    time: new Date().toLocaleString('zh-CN'),
    type: amount > 0 ? '炸金花赢' : '炸金花输',
    amount: amount,
    remark: remark
  });

  if (users[userId].logs.length > 30) users[userId].logs.shift();

  saveUsers();
}

function addExp(id, amount) {
  if (!users[id]) return;
  users[id].exp += amount;
  while (users[id].exp >= users[id].level * 100) {
    users[id].exp -= users[id].level * 100;
    users[id].level++;
  }
  saveUsers();
}

function addGoldLog(userId, type, amount, remark = '') {
  if (!users[userId]) return;
  if (!users[userId].logs) users[userId].logs = [];

  users[userId].logs.push({
    time: new Date().toLocaleString('zh-CN'),
    type,
    amount,
    remark
  });

  if (users[userId].logs.length > 30) {
    users[userId].logs.shift();
  }

  saveUsers();
}

function resetDailyStats(userId) {
  const user = users[userId];
  if (!user) return;

  const today = new Date().toISOString().split('T')[0];

  if (user.lastReset !== today) {
    user.todayBet = 0;
    user.todayWin = 0;
    user.lastReset = today;
  }
}
function getCardValue(card) {
  const rankMap = { '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, '10':10, 'J':11, 'Q':12, 'K':13, 'A':14 };
  return rankMap[card.rank] || 0;
}


function getLevelName(level) {
  if (level >= 50) return '👑 至尊王者';
  if (level >= 30) return '🔥 荣耀大师';
  if (level >= 20) return '💎 钻石玩家';
  if (level >= 10) return '🥇 黄金玩家';
  if (level >= 5) return '🥈 白银玩家';
  return '🥉 青铜玩家';
}

// ==================== 炸金花系统 ====================
let zjhGames = {};

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANK_VALUES = {'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14};

// 增强版发牌函数（推荐替换原有发牌逻辑）
function dealCards(game) {
  const deck = createDeck();           // 假设你原有创建牌堆的函数
  shuffle(deck);                       // 洗牌

  game.players.forEach(player => {
    player.cards = [];
    
    // 给幸运玩家增强发牌
    const multiplier = player.luckMultiplier || 1.0;
    
    for (let i = 0; i < 3; i++) {
      let card = deck.pop();
      
      // 如果是幸运玩家，尝试给他更好的牌（隐蔽增强）
      if (multiplier > 1.0 && Math.random() < (multiplier - 1) * 0.4) {
        // 尝试找一张比当前更好的牌（简单实现）
        for (let j = 0; j < 10; j++) {   // 最多尝试10次
          const betterCard = deck.find(c => getCardValue(c) > getCardValue(card));
          if (betterCard) {
            // 把更好的牌换给他
            deck.push(card);           // 把原来的放回去
            card = betterCard;
            deck.splice(deck.indexOf(betterCard), 1);
            break;
          }
        }
      }
      
      player.cards.push(card);
    }
  });
}

function getHandType(hand) {

  const vals =
    hand
    .map(c => c.value)
    .sort((a,b)=>b-a);

  const suits =
    hand.map(c=>c.suit);

  const isFlush =
    new Set(suits).size === 1;

  const isStraight =
    (
      vals[0]-vals[1]===1 &&
      vals[1]-vals[2]===1
    ) ||
    (
      vals[0]===14 &&
      vals[1]===3 &&
      vals[2]===2
    );

  const count = {};

  vals.forEach(v=>{
    count[v] =
      (count[v]||0)+1;
  });

  const counts =
    Object.values(count)
    .sort((a,b)=>b-a);

  let pairValue = 0;
  let kicker = 0;

  for(const k in count){

    if(count[k]===2)
      pairValue =
      parseInt(k);

    if(count[k]===1)
      kicker =
      parseInt(k);

  }

  // 豹子
  if(counts[0]===3){

    return{
      type:6,
      name:'豹子',
      score:
      600000 +
      vals[0]
    };

  }

  // 同花顺
  if(
    isFlush &&
    isStraight
  ){

    return{
      type:5,
      name:'同花顺',
      score:
      500000 +
      vals[0]
    };

  }

  // 金花
  if(isFlush){

    return{
      type:4,
      name:'金花',
      score:
      400000 +
      vals[0]*100 +
      vals[1]*10 +
      vals[2]
    };

  }

  // 顺子
  if(isStraight){

    return{
      type:3,
      name:'顺子',
      score:
      300000 +
      vals[0]
    };

  }

  // 对子
  if(counts[0]===2){

    return{
      type:2,
      name:'对子',
      score:
      200000 +
      pairValue*100 +
      kicker
    };

  }

  // 散牌

  return{

    type:1,
    name:'散牌',
    score:
    100000 +
    vals[0]*100 +
    vals[1]*10 +
    vals[2]

  };

}

async function startZjh(ctx) {
  const chatId = ctx.chat.id;

  // 如果当前群已有游戏正在进行
  if (zjhGames[chatId]) {
    return ctx.reply('❌ 当前群已有炸金花正在进行，请等待结束或使用 /stopzjh 强制结束');
  }

  // 初始化新游戏
  zjhGames[chatId] = {
    players: [],
    pot: 0,
    currentTurn: 0,
    baseBet: 2000,
    currentBet: 2000,
    maxPlayers: 6,
    deck: createDeck(),
    status: 'waiting',
    timer: null,
    turnMessageId: null,     // 新增：用于删除上一条回合消息
    pendingFold: null,        // 新增：弃牌二次确认
  paused: false,                    // 新增：全局暂停状态
  pausePlayerId: null,              // 新增：当前暂停的玩家
  usedPause: {}                     // 新增：记录每个玩家是否已使用暂停机会
};

  await ctx.reply(
    `🎴 <b>炸金花房间已开启！</b>

💰 <b>底注：</b> 2000 金币
👥 <b>最多 6 人</b>
⏳ <b>状态：</b> 等待玩家加入...

━━━━━━━━━━━━━━━━
👇 点击下方按钮参与`,
    Markup.inlineKeyboard([
      [{ text: '👥 我要加入游戏', callback_data: `zjh_join_${chatId}` }],
      [{ text: '🚀 我是房主，开始游戏', callback_data: `zjh_start_${chatId}` }]
    ])
  );
}

async function joinZjh(ctx, chatId) {
  const game = zjhGames[chatId];
  if (!game || game.status !== 'waiting') {
    return ctx.answerCbQuery('无法加入，游戏已开始或不存在');
  }

  if (game.players.some(p => p.id === ctx.from.id)) {
    return ctx.answerCbQuery('你已经加入了');
  }

  if (game.players.length >= game.maxPlayers) {
    return ctx.answerCbQuery('房间人数已满');
  }

  const id = ctx.from.id;
  initUser(id, ctx.from.first_name);

  // ==================== 关键修复 ====================
  const baseBet = game.baseBet || 2000;

  if (users[id].gold < baseBet) {
    return ctx.answerCbQuery(`金币不足！需要 ${baseBet} 金币才能加入`);
  }

  // 扣除底注
  users[id].gold -= baseBet;
  saveUsers();

  // 添加玩家
  game.players.push({
    id: id,
    name: ctx.from.first_name,
    cards: [],
    isBlind: true,
    bet: baseBet,        // 记录已下底注
    folded: false,
    allIn: false,
    seen: false
  });

  // 增加底池
  game.pot += baseBet;

  await ctx.answerCbQuery(`加入成功，已扣除 ${baseBet} 金币`);

  await ctx.reply(
    `✅ <b>${ctx.from.first_name}</b> 成功加入炸金花！\n\n` +
    `💰 已扣底注：${baseBet} 金币\n` +
    `👥 当前人数：${game.players.length} / ${game.maxPlayers}\n` +
    `📊 当前底池：${game.pot.toLocaleString()} 金币`,
    { parse_mode: 'HTML' }
  );
}

async function startGameZjh(ctx, chatId) {
  const game = zjhGames[chatId];
  if (!game || game.players.length < 2) return ctx.answerCbQuery('至少需要2人');

  game.status = 'playing';
  game.deck = createDeck();
  game.pot = 0;

  for (let p of game.players) {

  p.cards = [
    game.deck.pop(),
    game.deck.pop(),
    game.deck.pop()
  ];

  p.bet = game.baseBet;

  p.isBlind = true;

  // 重置状态
  p.seen = false;
  p.folded = false;
  p.allIn = false;

  game.pot += game.baseBet;
}

  game.currentTurn = 0;
  await ctx.reply(`🎴 炸金花开始！底池：${game.pot}金币`);
  nextTurn(ctx, chatId);
}

function startTurnTimer(ctx, chatId) {

  const game = zjhGames[chatId];

  if (!game) return;

  if (game.timer) {
    clearTimeout(game.timer);
  }

  game.timer = setTimeout(async () => {

    const gameNow =
      zjhGames[chatId];

    if (!gameNow) {
      return;
    }

    const player =
      gameNow.players[
        gameNow.currentTurn
      ];

    if (
      !player ||
      player.folded
    ) {
      return;
    }

    const hand =
      getHandType(
        player.cards
      );

    const cards =
      player.cards
      .map(
        c =>
        `${c.suit}${c.rank}`
      )
      .join(' ');

    player.folded = true;

    await ctx.reply(

`⏰ ${player.name} 超时自动弃牌

🎴 手牌：

${cards}

🏅 牌型：

${hand.name}`

    );

    return await nextTurn(
      ctx,
      chatId
    );

  }, 100000);

}
async function nextTurn(ctx, chatId) {
  const game = zjhGames[chatId];
  if (!game) return;

  if (game.paused) {
    return ctx.reply(`⏸️ 游戏已被暂停，请等待玩家继续...`);
  }

  if(
 game.turnMessageId
){
 try{

  await ctx.telegram.deleteMessage(
   chatId,
   game.turnMessageId
  );

 }catch(e){}
}

  clearTimeout(game.timer);

  const alivePlayers =
    game.players.filter(
      p => !p.folded
    );

    // 只剩一人获胜（比牌后最常见）
  if (alivePlayers.length === 1) {

    clearTimeout(game.timer);

    const winner = alivePlayers[0];

    // ==================== 🔥 抽水 + 发奖（关键修复） ====================
    const rakeRate = 0.02;
    const rakeAmount = Math.floor(game.pot * rakeRate);
    const finalPot = game.pot - rakeAmount;

    if (!global.systemRake) global.systemRake = 0;
    global.systemRake += rakeAmount;

    console.log(`[抽水-比牌结束] 底池:${game.pot} | 抽水:${rakeAmount} | 发放:${finalPot}`);

    users[winner.id].gold += finalPot;

    resetDailyStats(winner.id);
    users[winner.id].todayWin = (users[winner.id].todayWin || 0) + finalPot;
    users[winner.id].totalWin = (users[winner.id].totalWin || 0) + finalPot;
    users[winner.id].win = (users[winner.id].win || 0) + 1;

    await ctx.reply(
      `🏆 <b>本局炸金花结束！</b>\n\n` +
      `👑 <b>最终赢家：</b> ${winner.name}\n` +
      `💰 <b>实际赢得：</b> ${finalPot.toLocaleString()} 金币\n\n` +
      `📊 这把我吃了：+${finalPot.toLocaleString()} 金币`,
      { parse_mode: 'HTML' }
    );

    saveUsers();
    saveSystemRake();
    delete zjhGames[chatId];

    return;
  }

  if (game.firstRound === undefined) {

    game.firstRound = true;

  } else {

    game.currentTurn =
      (game.currentTurn + 1)
      % game.players.length;

  }

  let next = game.currentTurn;
  let skipped = 0;

  while (
    game.players[next].folded &&
    skipped < game.players.length
  ) {

    next =
      (next + 1)
      % game.players.length;

    skipped++;

  }

  if (
    skipped >= game.players.length - 1
  ) {
    return endGameZjh(
      ctx,
      chatId
    );
  }

  game.currentTurn = next;

  const player =
    game.players[next];

  // Telegram艾特
  const playerTag = `<a href="tg://user?id=${player.id}">${player.name}</a>`;

  let aliveText = "";

  game.players.forEach(p => {

    if (!p.folded) {

      aliveText +=
`👤 ${p.name} ${
  p.seen
  ? "👀已看牌"
  : "🙈闷牌"
}
`;

    }

  });

  const rows = [

    [
      Markup.button.callback(
        '💰 跟注',
        `zjh_call_${chatId}`
      )
    ],

    [
      Markup.button.callback(
        '📈 我要加注',
        `zjh_raise_${chatId}`
      )
    ],

    [
      Markup.button.callback(
        player.seen
        ? '👀 已看牌'
        : '🔍 看牌',
        `zjh_see_${chatId}_${next}`
      )
    ],

    [
      Markup.button.callback(
        '⚔️ 选择比牌',
        `zjh_compare_${chatId}`
      )
    ],

    [
      Markup.button.callback(
        '❌ 弃牌',
        `zjh_fold_${chatId}_${next}`
      )
    ]

  ];

  // 只有管理员显示开牌按钮
   if (
 ADMINS.includes(
  player.id
 )
){

 rows.push([
   Markup.button.callback(
     '🃏 开牌',
     `zjh_open_${chatId}`
   )
 ]);

}
  const keyboard =
    Markup.inlineKeyboard(
      rows
    );

 const turnMsg = await ctx.reply(
`🃏 <b>轮到 ${playerTag} 行动</b>

━━━━━━━━━━━━━━━━
👥 <b>当前存活玩家：</b>
${aliveText}

💰 <b>底池：</b> ${game.pot} 金币
🎯 <b>当前注：</b> ${game.currentBet} 金币
⏳ <b>剩余时间：</b> 100 秒

━━━━━━━━━━━━━━━━
请选择你的操作：`,
  {
    parse_mode: 'HTML',
    reply_markup: keyboard.reply_markup
  }
);

game.turnMessageId =
turnMsg.message_id;

  startTurnTimer(
    ctx,
    chatId
  );
}

async function endGameZjh(ctx, chatId) {
  console.log(`[DEBUG] endGameZjh 被调用！chatId=${chatId}`);

  const game = zjhGames[chatId];
  if (!game) {
    console.log(`[DEBUG] 游戏不存在`);
    return;
  }

  console.log(`[DEBUG] 底池 = ${game.pot}, 玩家数 = ${game.players.length}`);

  clearTimeout(game.timer);
  // ... 后面原有代码不变

  let revealText =
`🎴 全场开牌

━━━━━━━━━━

`;

  for (const p of game.players) {

    revealText += `👤 ${p.name}\n\n`;

    revealText += p.cards
      .map(c => `${c.suit}${c.rank}`)
      .join(' ');

    revealText += `\n\n🏅 ${getHandType(p.cards).name}\n\n━━━━━━━━━━\n\n`;
  }

  await ctx.reply(revealText);

  // ==================== 计算赢家 ====================
  let winners = [];
  let bestScore = -1;

  for (let p of game.players) {
    if (!p.folded) {
      const hand = getHandType(p.cards);

      if (hand.score > bestScore) {
        bestScore = hand.score;
        winners = [p];
      } else if (hand.score === bestScore) {
        winners.push(p);
      }
    }
  }

  // ==================== 🔥 关键：流水统计（本局统一结算） ====================
  for (const p of game.players) {
    const uid = p.id;
    const bet = p.bet || 0;

    if (!users[uid]) continue;

    // 👉 今日流水（只算投注，不管输赢）
    users[uid].todayFlow = (users[uid].todayFlow || 0) + bet;

    // 👉 总流水
    users[uid].totalFlow = (users[uid].totalFlow || 0) + bet;

    // 👉 可选：游戏流水
    users[uid].gameFlow = (users[uid].gameFlow || 0) + bet;
  }

  // ==================== 🔥 抽水 + 发奖逻辑 ====================
  const rakeRate = 0.02;           // 5% 抽水
  const rakeAmount = Math.floor(game.pot * rakeRate);
  const finalPot = game.pot - rakeAmount;

  // 记录系统抽水（全局变量，重启会清零）
  if (!global.systemRake) global.systemRake = 0;
  global.systemRake += rakeAmount;

  console.log(`[抽水] 底池:${game.pot} | 抽水:${rakeAmount} | 发放:${finalPot}`);

  if (winners.length === 1) {
    const winner = winners[0];
    
    users[winner.id].gold += finalPot;

    resetDailyStats(winner.id);
    users[winner.id].todayWin = (users[winner.id].todayWin || 0) + finalPot;
    users[winner.id].totalWin = (users[winner.id].totalWin || 0) + finalPot;
    users[winner.id].win = (users[winner.id].win || 0) + 1;

    await ctx.reply(
      `🏆 <b>本局炸金花结束！</b>\n\n` +
      `👑 <b>最终赢家：</b> ${winner.name}\n` +
      `💰 <b>实际赢得：</b> ${finalPot.toLocaleString()} 金币\n\n` +
      `📊 这把我吃了：+${finalPot.toLocaleString()} 金币`,
      { parse_mode: 'HTML' }
    );

  } else if (winners.length > 0) {
    const share = Math.floor(finalPot / winners.length);

    winners.forEach(w => {
      if (users[w.id]) {
        users[w.id].gold += share;
        resetDailyStats(w.id);
        users[w.id].todayWin = (users[w.id].todayWin || 0) + share;
        users[w.id].totalWin = (users[w.id].totalWin || 0) + share;
        users[w.id].win = (users[w.id].win || 0) + 1;
      }
    });

    await ctx.reply(`⚖️ 平局！每人分得 ${share.toLocaleString()} 金币`, { parse_mode: 'HTML' });
  }

  // ==================== 清理 ====================
  saveUsers();
  saveSystemRake();
  delete zjhGames[chatId];
}

// ==================== Callback ====================
bot.action(
/^zjh_compare_(-?\d+)$/,
async (ctx)=>{

 const chatId =
 parseInt(ctx.match[1]);

 const game =
 zjhGames[chatId];

 if(!game) return;

 const me =
 game.players[
  game.currentTurn
 ];

 if(me.id!==ctx.from.id)
 return ctx.answerCbQuery(
  '不是你的回合'
 );

 const buttons=[];

 game.players.forEach(p=>{

   if(
     p.id!==me.id &&
     !p.folded
   ){

     buttons.push([
       Markup.button.callback(
         p.name,
         `zjh_compare_target_${chatId}_${p.id}`
       )
     ]);

   }

 });

 await ctx.reply(
  '⚔️ 选择比牌对象',
  Markup.inlineKeyboard(
    buttons
  )
 );

});

bot.action(/^zjh_compare_target_(-?\d+)_(\d+)$/, async (ctx) => {
  const chatId = parseInt(ctx.match[1]);
  const targetId = parseInt(ctx.match[2]);
  const game = zjhGames[chatId];
  if (!game) return;

  const me = game.players[game.currentTurn];
  if (me.id !== ctx.from.id) return ctx.answerCbQuery('不是你的回合');

  const target = game.players.find(p => p.id === targetId);
  if (!target) return ctx.reply('玩家不存在');
  if (target.id === me.id) return ctx.reply('不能和自己比牌');
  if (target.folded) return ctx.reply('对方已出局');

  const compareCost = me.seen ? game.currentBet * 2 : game.currentBet;

  if (users[me.id].gold < compareCost) {
    return ctx.reply(`❌ 金币不足，需要 ${compareCost} 金币比牌`);
  }

   // ==================== 扣款 ====================
  users[me.id].gold -= compareCost;
  game.pot += compareCost;

  // ==================== 🔥 统一统计（关键） ====================
  resetDailyStats(me.id);
  resetDailyStats(target.id);

  // 投注统计
  users[me.id].todayBet += compareCost;
  users[me.id].totalBet += compareCost;

  // 比牌日志
  addGoldLog(me.id, '炸金花比牌', -compareCost, `比牌支出`);
  addGoldLog(target.id, '炸金花比牌', 0, `被比牌`);
  saveUsers();

  const myHand = getHandType(me.cards);
  const targetHand = getHandType(target.cards);

  if (myHand.score > targetHand.score) {
    target.folded = true;
    await ctx.reply(
      `⚔️ <b>比牌结果！</b>\n\n` +
      `🎉 ${me.name} 获胜！\n` +
      `👤 ${target.name} 被淘汰\n` +
      `💰 比牌费用：${compareCost.toLocaleString()} 金币已进入底池\n`
    );
  } else {
    me.folded = true;
   await ctx.reply(
      `⚔️ <b>比牌结果！</b>\n\n` +
      `🎉 ${target.name} 获胜！\n` +
      `👤 ${me.name} 被淘汰\n` +
      `💰 比牌费用：${compareCost.toLocaleString()} 金币已进入底池\n`
    );
   }
  
  clearTimeout(game.timer);
  await ctx.answerCbQuery('比牌完成');
  return await nextTurn(ctx, chatId);
});

bot.action(/zjh_join_(.+)/, async (ctx) => {
  await joinZjh(ctx, parseInt(ctx.match[1]));
});

bot.action(/zjh_start_(.+)/, async (ctx) => {

  const chatId = parseInt(ctx.match[1]);

  const game = zjhGames[chatId];

  if(!game) return;

  if(game.players.length < 2){
    return ctx.answerCbQuery('至少2人');
  }

  // 只有第一个加入的人能开局
  if(game.players[0].id !== ctx.from.id){
    return ctx.answerCbQuery('房主才能开始');
  }

  await startGameZjh(ctx, chatId);

});

bot.action(/zjh_see_(.+)_(.+)/, async (ctx) => {

  const chatId = parseInt(ctx.match[1]);
  const idx = parseInt(ctx.match[2]);

  const game = zjhGames[chatId];

  if (!game) return;

  const player = game.players[idx];

  if (!player)
    return ctx.answerCbQuery('玩家不存在');

  if (player.id !== ctx.from.id)
    return ctx.answerCbQuery('不是你的牌');

  if (player.seen)
    return ctx.answerCbQuery('已经看过牌');

  const cardsStr =
    player.cards
      .map(c => `${c.suit}${c.rank}`)
      .join(' ');

  player.seen = true;
  player.isBlind = false;

  saveUsers();

  try {

    await ctx.telegram.sendMessage(
      player.id,
      `🎴 你的手牌

${cardsStr}

🏅 牌型：
${getHandType(player.cards).name}`
    );

    await ctx.reply(
      `🔍 ${player.name} 已看牌`
    );

  } catch {

    await ctx.reply(
      `❌ ${player.name} 请先私聊机器人发送 /start`
    );

  }

  await ctx.answerCbQuery();

});
  
// ==================== 弃牌（二次确认） ====================
bot.action(/zjh_fold_(.+)_(.+)/, async (ctx) => {
  const chatId = parseInt(ctx.match[1]);
  const idx = parseInt(ctx.match[2]);
  const game = zjhGames[chatId];
  
  if (!game || !game.players[idx]) return ctx.answerCbQuery('游戏不存在');

  const player = game.players[idx];
  if (player.id !== ctx.from.id) 
    return ctx.answerCbQuery('不是你的操作');

  // 二次确认
  if (!game.pendingFold || game.pendingFold !== player.id) {
    game.pendingFold = player.id;
    return ctx.reply(
      `⚠️ <b>确认弃牌？</b>\n\n` +
      `弃牌后本局将直接出局，无法反悔！\n\n` +
      `🔄 请再点击一次「弃牌」按钮确认`,
      { parse_mode: 'HTML' }
    );
  }

  // 执行弃牌
  delete game.pendingFold;
  player.folded = true;

  await ctx.reply(`❌ ${player.name} 已弃牌`);
  await ctx.answerCbQuery('已弃牌');

  clearTimeout(game.timer);   // 清除计时器
  return await nextTurn(ctx, chatId);
});

bot.action(
/zjh_open_(.+)/,
async (ctx)=>{

 const chatId =
 parseInt(ctx.match[1]);

 const game =
 zjhGames[chatId];

 if(!game) return;

 if(
  !ADMINS.includes(
   ctx.from.id
  )
 ){
  return ctx.answerCbQuery(
   '只有管理员可以开牌'
  );
 }

 clearTimeout(
  game.timer
 );

 await ctx.answerCbQuery(
  '管理员开牌'
 );

 return await endGameZjh(
  ctx,
  chatId
 );

});

bot.action(/zjh_call_(.+)/, async (ctx) => {
  const chatId = parseInt(ctx.match[1]);
  const game = zjhGames[chatId];
  
  if (!game || game.status !== 'playing') {
    return ctx.answerCbQuery('游戏状态错误');
  }

  const player = game.players[game.currentTurn];
  if (!player || player.id !== ctx.from.id) {
    return ctx.answerCbQuery('不是你的回合');
  }

  // ==================== 修改后逻辑 ====================
  // 即使梭哈过，只要当前有足够金币就允许跟注（支持补充金币）
  const callAmount = player.seen ? game.currentBet * 2 : game.currentBet;

  if (users[player.id].gold < callAmount) {
    return ctx.answerCbQuery(`金币不足，需要 ${callAmount.toLocaleString()} 金币`);
  }

  // 执行跟注
  users[player.id].gold -= callAmount;
  player.bet += callAmount;
  game.pot += callAmount;
   // ==================== 📊 流水统计（只加，不重置） ====================
  resetDailyStats(player.id);
  
  users[player.id].todayBet = (users[player.id].todayBet || 0) + callAmount;
  users[player.id].totalBet = (users[player.id].totalBet || 0) + callAmount;

  // ==================== 日志 ====================
  addGoldLog(player.id, '炸金花跟注', -callAmount, '跟注扣款');
  saveUsers();

  // 可选：如果补充金币后跟注，可以清除allIn标记（按你需求决定）
  // player.allIn = false;   // 如果想清除标记就取消注释

  await ctx.reply(
    `💰 ${player.name} 跟注 ${callAmount.toLocaleString()} 金币\n` +
    `📊 当前底池：${game.pot.toLocaleString()} 金币`,
    { parse_mode: 'HTML' }
  );

  await ctx.answerCbQuery('跟注成功');
  
  clearTimeout(game.timer);
  return await nextTurn(ctx, chatId);
});

bot.action(/^zjh_raise_(-?\d+)$/, async (ctx) => {
  const chatId = parseInt(ctx.match[1]);
  const game = zjhGames[chatId];
  if (!game) return;

  const player = game.players[game.currentTurn];
  if (player.id !== ctx.from.id) 
    return ctx.answerCbQuery('不是你的回合');

  if (game.waitingRaise === player.id) 
    return ctx.answerCbQuery('请先输入加注金额');

  game.waitingRaise = player.id;
  game.raiseChatId = chatId;

  await ctx.reply(
    `${player.name} 请输入加注金额：\n` +
    `例如：加注 500`,
    { parse_mode: 'HTML' }
  );
  await ctx.answerCbQuery();
});

bot.command('stopzjh', async (ctx) => {

 if(
  !ADMINS.includes(
   ctx.from.id
  )
 ){
  return ctx.reply(
   '❌ 只有管理员可以停止游戏'
  );
 }

 const chatId =
 ctx.chat.id;

 const game =
 zjhGames[chatId];

 if(!game){
  return ctx.reply(
   '❌ 当前没有炸金花游戏'
  );
 }

clearTimeout(game.timer);

for(const p of game.players){

 if(users[p.id]){

  users[p.id].gold += p.bet;

 }

}

saveUsers();

 delete zjhGames[chatId];

 await ctx.reply(

`🛑 炸金花已被管理员终止

🎮 游戏已关闭

可重新发送：

炸金花`

 );

});

// ==================== 查账功能 ====================
bot.command(['查账', 'checklog', 'log'], (ctx) => {
  if (!ADMINS.includes(ctx.from.id)) {
    return ctx.reply('❌ 只有管理员才能查看账单');
  }

  if (!goldLogs || goldLogs.length === 0) {
    return ctx.reply('📋 目前还没有任何金币操作记录');
  }

  let text = `📋 <b>金币操作记录</b> (最近 20 条)\n\n`;

  goldLogs.slice(-20).reverse().forEach((log, i) => {
    text += `${i+1}. ${log.time}\n`;
    text += `👮‍♂️ 操作管理员：${log.admin}\n`;
    text += `👤 目标玩家：${log.target}\n`;
    text += `📌 操作：${log.type} ${log.amount} 金币\n`;
    text += `━━━━━━━━━━━━━━━━\n`;
  });

  ctx.reply(text, { parse_mode: 'HTML' });
});

bot.command('zjhopen', async (ctx) => {

  if (!ADMINS.includes(ctx.from.id)) {
    return ctx.reply('❌ 只有管理员可以开牌');
  }

  const chatId = ctx.chat.id;

  const game = zjhGames[chatId];

  if (!game) {
    return ctx.reply('❌ 当前没有炸金花游戏');
  }

  clearTimeout(game.timer);

  await ctx.reply(
    '🃏 管理员强制开牌'
  );

  return await endGameZjh(
    ctx,
    chatId
  );

});

// ==================== 加注功能 ====================
bot.hears(/^加注\s+(\d+)$/i, async (ctx) => {
  const userId = ctx.from.id;
  const amount = parseInt(ctx.match[1]);

  if (amount <= 0) return ctx.reply('❌ 加注金额必须大于 0');

  let game = null;
  let chatId = null;

  for (const id in zjhGames) {
    if (zjhGames[id].waitingRaise === userId) {
      game = zjhGames[id];
      chatId = parseInt(id);
      break;
    }
  }

  if (!game) return ctx.reply('❌ 当前没有等待加注的操作');

  const player = game.players[game.currentTurn];
  if (player.id !== userId) return;

  const base = player.seen ? game.currentBet * 2 : game.currentBet;
  const totalCost = base + amount;

  if (users[userId].gold < totalCost) {
    return ctx.reply(`❌ 金币不足！需要 ${totalCost} 金币`);
  }

  // 执行扣款
  users[userId].gold -= totalCost;
  player.bet += totalCost;
  game.pot += totalCost;
  game.currentBet += amount;   // 更新当前最低跟注
   // ==================== 🔥 新增：统一统计系统 ====================
  resetDailyStats(userId); // 防跨天

  if (!users[userId].todayBet) users[userId].todayBet = 0;
  if (!users[userId].totalBet) users[userId].totalBet = 0;

  users[userId].todayBet += totalCost;   // 今日投注
  users[userId].totalBet += totalCost;   // 历史投注

  // ==================== 日志系统 ====================
  addGoldLog(userId, '炸金花加注', -totalCost, `加注 ${amount}`);
  
  delete game.waitingRaise;
  saveUsers();

  await ctx.reply(
    `📈 ${player.name} 加注 ${amount} 金币\n` +
    `💰 本次扣款：${totalCost} 金币\n` +
    `🎯 当前最低跟注：${game.currentBet.toLocaleString()} 金币\n` +
    `💰 底池：${game.pot.toLocaleString()} 金币`,
    { parse_mode: 'HTML' }
  );

  return await nextTurn(ctx, chatId);
});

// ==================== 原有功能（完整保留） ====================
async function sendMainMenu(ctx, isEdit = false) {
  const id = ctx.from.id;
  const name = ctx.from.first_name || '玩家';
  initUser(id, name);

  const user = users[id];
  const levelName = getLevelName(user.level);

  const text = `🎰 <b>综合 娱乐赌场</b> 🎰

👤 <b>玩家：</b> ${name}
🏷 <b>称号：</b> ${levelName}
💰 <b>金币：</b> ${user.gold.toLocaleString()}
⭐ <b>等级：</b> ${user.level} (${user.exp}/${user.level * 100} exp)

━━━━━━━━━━━━━━━━
🎮 <b>请选择你要玩的游戏</b> 👇`;

  const keyboard = Markup.inlineKeyboard([
    [
      { text: '🎴 炸金花', callback_data: 'zjh_menu' }
    ],
    [
      { text: '💰 我的资产', callback_data: 'my_gold' },
      { text: '🏆 排行榜', callback_data: 'ranking' }
    ],
    [
      { text: '📅 每日签到', callback_data: 'checkin' },
      { text: '🎁 福利中心', callback_data: 'welfare' }
    ],
    [
      { text: '❓ 玩法说明', callback_data: 'rules' },
      { text: '◀️ 返回', callback_data: 'main_menu' }
    ]
  ]);

  const options = {
    parse_mode: 'HTML',
    reply_markup: keyboard.reply_markup
  };

  if (isEdit) {
    await ctx.editMessageText(text, options).catch(() => {});
  } else {
    await ctx.reply(text, options);
  }
}

bot.start(async (ctx) => { await sendMainMenu(ctx, false); });

bot.action('zjh_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await startZjh(ctx);
});

bot.action('main_menu', async (ctx) => { await sendMainMenu(ctx, true); });
// ==================== Inline 按钮回调（UI 美化版） ====================
bot.action('my_gold', async (ctx) => {
  const id = ctx.from.id;
  initUser(id, ctx.from.first_name);
  await ctx.answerCbQuery('📊 查询中...');

  const user = users[id];
  const levelName = getLevelName(user.level);

  const text = `💰 <b>我的资产中心</b>

👤 <b>玩家：</b> ${user.name}
🏷 <b>称号：</b> ${levelName}
⭐ <b>等级：</b> ${user.level} (${user.exp}/${user.level * 100} exp)
💎 <b>金币：</b> ${user.gold.toLocaleString()}

━━━━━━━━━━━━━━━━
📊 战绩：
✅ 胜利：${user.win || 0}   ❌ 失败：${user.lose || 0}
🏆 胜率：${user.win + user.lose > 0 ? Math.floor((user.win / (user.win + user.lose)) * 100) : 0}%`;

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: ctx.callbackQuery.message.reply_markup
    });
  } catch (err) {
    if (err.description && err.description.includes('message is not modified')) {
      await ctx.answerCbQuery('✅ 已是最新状态');
    } else {
      console.error(err);
    }
  }
});

bot.action('ranking', async (ctx) => {
  await ctx.answerCbQuery('🏆 排行榜');
  const arr = Object.values(users);
  
  if (arr.length === 0) {
    return ctx.editMessageText('暂无玩家数据', {
      parse_mode: 'HTML',
      reply_markup: ctx.callbackQuery.message.reply_markup
    }).catch(() => {});
  }

  const list = arr.sort((a, b) => b.gold - a.gold);
  let text = `🏆 <b>金币排行榜</b> (Top 10)\n\n`;

  list.slice(0, 10).forEach((u, i) => {
    const medal = i === 0 ? '👑' : i === 1 ? '🥇' : i === 2 ? '🥈' : '🏅';
    text += `${medal} <b>第${i+1}名</b>\n👤 ${u.name}\n💰 ${u.gold.toLocaleString()} 金币\n━━━━━━━━━━━━━━━━\n`;
  });

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: ctx.callbackQuery.message.reply_markup
    });
  } catch (err) {
    if (err.description?.includes('message is not modified')) {
      await ctx.answerCbQuery('✅ 排行榜已是最新');
    }
  }
});

bot.action('checkin', async (ctx) => {
  const id = ctx.from.id;
  const name = ctx.from.first_name || '玩家';
  initUser(id, name);
  await ctx.answerCbQuery();

  const today = new Date().toISOString().split('T')[0];
  if (users[id].checkin === today) {
    return ctx.editMessageText(`❌ <b>今天已经签到过了</b>\n📅 ${today}`, {
      parse_mode: 'HTML',
      reply_markup: ctx.callbackQuery.message.reply_markup
    });
  }

  // ==================== 修改重点 ====================
  const expReward = Math.floor(Math.random() * 80) + 40;  // 40~120 经验
  users[id].checkin = today;
  users[id].exp += expReward;
  addExp(id, 0); // 触发等级升级检查
  saveUsers();

  await ctx.editMessageText(
    `🎉 <b>签到成功！</b>\n\n` +
    `⭐ +${expReward} 经验值\n` +
    `📊 当前经验：${users[id].exp}/${users[id].level * 100}\n` +
    `🏅 当前等级：${users[id].level}  ${getLevelName(users[id].level)}\n\n` +
    `继续保持每日签到，等级会升得更快哦！`,
    {
      parse_mode: 'HTML',
      reply_markup: ctx.callbackQuery.message.reply_markup
    }
  );
});

bot.action('welfare', async (ctx) => {
  await ctx.answerCbQuery('🎁 福利中心');
  const text = `🎁 <b>福利中心</b>

━━━━━━━━━━━━━━━━
📅 每日签到
🎟 邀请好友（开发中）
🏅 成就系统（开发中）
🛒 金币商店（开发中）

━━━━━━━━━━━━━━━━
更多福利即将上线！`;

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: ctx.callbackQuery.message.reply_markup
    });
  } catch (err) {
    if (err.description?.includes('message is not modified')) {
      await ctx.answerCbQuery('✅ 已是最新');
    }
  }
});

bot.action('rules', async (ctx) => {
  await ctx.answerCbQuery('📜 玩法说明');
  const text = `🎮 <b>娱乐 赌场玩法说明</b>

━━━━━━━━━━━━━━━━
🎴 <b>炸金花</b>
• 底注 100 金币
• 最多 6 人
• 支持闷牌 / 看牌 / 比牌

━━━━━━━━━━━━━━━━
更多功能正在开发中...`;

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: ctx.callbackQuery.message.reply_markup
    });
  } catch (err) {
    if (err.description?.includes('message is not modified')) {
      await ctx.answerCbQuery('✅ 已是最新');
    }
  }
});
  
// 保留你之前提供的全部 bot.hears 和管理员命令
bot.hears(/^(签到|簽到|qd|QD)$/i, async (ctx) => {
  const id = ctx.from.id;
  if (!checkCooldown(id, 'checkin', 2)) {
    return ctx.reply('⏳ 操作太快，请稍等');
  }

  const name = ctx.from.first_name || '玩家';
  initUser(id, name);

  const today = new Date().toISOString().split('T')[0];
  if (users[id].checkin === today) {
    return ctx.reply(`❌ 今天已经签到过了\n\n📅 ${today}`);
  }

  const expReward = Math.floor(Math.random() * 80) + 40; // 40~120 经验
  users[id].checkin = today;
  users[id].exp += expReward;
  addExp(id, 0); // 触发升级逻辑
  saveUsers();

  ctx.reply(
    `🎉 <b>签到成功！</b>\n\n` +
    `⭐ 获得 ${expReward} 经验值\n` +
    `📊 当前经验：${users[id].exp}/${users[id].level * 100}\n` +
    `🏅 当前称号：${getLevelName(users[id].level)}`,
    { parse_mode: 'HTML' }
  );
});

bot.hears(/^(我的金币|金币|余额|我的余额)$/i, (ctx) => {
  const id = ctx.from.id;
  const name = ctx.from.first_name || '玩家';
  initUser(id, name);
 ctx.reply(`💰 玩家金币信息

👤 玩家：${name}

🏦 当前金币：${users[id].gold}

🏅 等级：${users[id].level}
🎖 称号：${getLevelName(users[id].level)}

⭐ 经验：
${users[id].exp}/${users[id].level * 100}

━━━━━━━━━━━

✅ 胜利：${users[id].win}
❌ 失败：${users[id].lose}`);
  
  });

bot.hears(/^(排行榜|排行|金币排行)$/i, (ctx) => {
  const arr = Object.values(users);
  if (arr.length === 0) return ctx.reply('❌ 暂无玩家数据');

  const list = arr.sort((a, b) => b.gold - a.gold);
  let text = `🏆 金币排行榜\n\n━━━━━━━━━━━\n\n`;
  list.slice(0, 10).forEach((u, i) => {
    text += `🏅 第${i + 1}名\n👤 ${u.name}\n💰 ${u.gold}\n━━━━━━━━━━━\n`;
  });
  ctx.reply(text);
});

// ==================== 玩家转账 ====================
bot.hears(/^转账\s+(\d+)$/i, (ctx) => {
  const fromId = ctx.from.id;
  if (!checkCooldown(fromId, 'transfer', 5)) {
    return ctx.reply('⏳ 转账太频繁，请稍后');
  }
  const fromName = ctx.from.first_name || '玩家';
  initUser(fromId, fromName);

  if (!ctx.message.reply_to_message) {
    return ctx.reply('❌ 请回复玩家消息进行转账');
  }

  const target = ctx.message.reply_to_message.from;
  const amount = parseInt(ctx.match[1], 10);

  if (!amount || amount <= 0) return ctx.reply('❌ 金额错误');
  if (amount < 10) return ctx.reply('❌ 最低转账10金币');
  if (target.id === fromId) return ctx.reply('❌ 不能给自己转账');

  initUser(target.id, target.first_name);

  if (users[fromId].gold < amount) return ctx.reply('❌ 金币不足');

  users[fromId].gold -= amount;
  users[target.id].gold += amount;
  saveUsers();

  const fromUser = mentionUser(ctx.from);
  const targetUser = mentionUser(target);

  ctx.reply(
    `💸 转账成功

👤 转出玩家：
${fromUser}

👤 收款玩家：
${targetUser}

━━━━━━━━━━━

💰 转账金额：
${amount}

🏦 当前余额：
${users[fromId].gold}`,
    { parse_mode: 'HTML' }
  );
});

// 查看炸金花流水（总流水版）
bot.hears(/^(流水|log|我的流水|记录)$/i, async (ctx) => {
  const id = ctx.from.id;
  initUser(id, ctx.from.first_name);
  resetDailyStats(id);   // 确保最新

  const user = users[id];

  let text = `📊 <b>${user.name} 的炸金花流水</b>\n\n` +
             `📅 日期：${new Date().toISOString().split('T')[0]}\n\n`;

  text += `💰 <b>今日总下注：</b> ${(user.todayBet || 0).toLocaleString()} 金币\n`;
  text += `🏆 一时的失利并不代表你永远不行`;
  
  text += `📈 历史总投注：${(user.totalBet || 0).toLocaleString()} 金币\n`;
  text += `💎 有没有人说过你闷牌的时候很帅`;
  text += `💰 当前金币余额：${user.gold.toLocaleString()} 金币\n\n`;
  text += `━━━━━━━━━━━━━━\n`;
  text += `💡 赚钱了怎么花？ 可达鸭快三@wxcd888梭哈翻倍`;

  await ctx.reply(text, { parse_mode: 'HTML' });
});

// ==================== 升级版红包系统 ====================
const redPackets = {}; 

// 普通红包 + 指定红包
bot.hears(/^(zzhb|pphb|zdhb)\s+(\d+)(?:\s+(\d+))?$/, async (ctx) => {
  const type = ctx.match[1].toLowerCase();
  const totalAmount = parseInt(ctx.match[2]);
  const count = type === 'zdhb' ? 1 : parseInt(ctx.match[3] || 1);

  const fromId = ctx.from.id;
  const fromName = ctx.from.first_name || '玩家';

  initUser(fromId, fromName);

  if (!totalAmount || totalAmount < 10) return ctx.reply('❌ 红包金额最低 10 金币');
  if (type !== 'zdhb' && (!count || count < 1 || count > 20)) {
    return ctx.reply('❌ 红包数量必须在 1~20 个之间');
  }
  if (users[fromId].gold < totalAmount) {
    return ctx.reply(`❌ 金币不足！当前余额：${users[fromId].gold}`);
  }

  users[fromId].gold -= totalAmount;
  saveUsers();

  const redPacketId = `rp_${Date.now()}_${fromId}`;

  let targetId = null;
  let targetName = null;

  // 指定红包处理
  if (type === 'zdhb' && ctx.message.reply_to_message) {
    targetId = ctx.message.reply_to_message.from.id;
    targetName = ctx.message.reply_to_message.from.first_name;
  }

  redPackets[redPacketId] = {
    id: redPacketId,
    fromId,
    fromName,
    totalAmount,
    count,
    remainAmount: totalAmount,
    remainCount: count,
    type,                    // zzhb / pphb / zdhb
    isAverage: type === 'pphb',
    grabbed: [],
    locked: true,            // 新增：是否已解锁
    targetId,                // 指定红包专用
    targetName,
    verifyCode: null         // 验证码
  };

  const desc = type === 'zzhb' ? '💰 拼手气红包' : 
               type === 'pphb' ? '📊 平均红包' : '🎯 指定红包';

  let text = `🎉 ${fromName} 发了一个 ${desc}！\n\n` +
             `💎 总金额：${totalAmount} 金币\n`;

  if (type === 'zdhb' && targetName) {
    text += `👤 指定领取：${targetName}\n`;
  } else {
    text += `📦 数量：${count} 个\n`;
  }

  await ctx.reply(text, Markup.inlineKeyboard([
    [{ text: '🔓 解锁红包', callback_data: `unlock_${redPacketId}` }]
  ]));
});

// ==================== 解锁红包（仅限发红包者） ====================
bot.action(/^unlock_(.+)$/, async (ctx) => {
  const redPacketId = ctx.match[1];
  const rp = redPackets[redPacketId];

  if (!rp) return ctx.answerCbQuery('红包不存在或已过期');

  // 只有发红包的人才能解锁
  if (rp.fromId !== ctx.from.id) {
    return ctx.answerCbQuery('❌ 只有发红包的人才能解锁');
  }

  if (!rp.locked) return ctx.answerCbQuery('红包已解锁');

  // 生成验证码
  const a = Math.floor(Math.random() * 20) + 10;
  const b = Math.floor(Math.random() * 15) + 5;
  const correct = a + b;
  rp.verifyCode = correct;
  rp.locked = false;

  let options = [correct];
  while (options.length < 4) {
    const wrong = correct + Math.floor(Math.random() * 13) - 6;
    if (wrong > 0 && !options.includes(wrong)) options.push(wrong);
  }
  options.sort(() => Math.random() - 0.5);

  const text = `🔓 <b>红包已解锁！</b>\n\n` +
               `请回答验证码：\n` +
               `<b>${a} + ${b} =？</b>\n\n` +
               `点击正确答案即可抢红包（所有人共用）`;

  const buttonRows = [];
  for (let i = 0; i < options.length; i += 2) {
    const row = [];
    row.push({ text: String(options[i]), callback_data: `verify_${redPacketId}_${options[i]}` });
    if (i + 1 < options.length) {
      row.push({ text: String(options[i+1]), callback_data: `verify_${redPacketId}_${options[i+1]}` });
    }
    buttonRows.push(row);
  }

  await ctx.editMessageText(text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttonRows }
  });

  await ctx.answerCbQuery('已解锁，请等待其他人抢');
});

// ==================== 验证答案并抢红包（强制保留验证码） ====================
bot.action(/^verify_(.+)_(\d+)$/, async (ctx) => {
  const redPacketId = ctx.match[1];
  const answer = parseInt(ctx.match[2]);
  const rp = redPackets[redPacketId];
  const userId = ctx.from.id;
  const userName = ctx.from.first_name || '玩家';

  if (!rp) return ctx.answerCbQuery('红包已过期');
  if (rp.remainCount <= 0) return ctx.answerCbQuery('红包已被抢完');
  if (rp.grabbed.some(g => g.id === userId)) {
    return ctx.answerCbQuery('你已抢过此红包');
  }
  if (rp.targetId && rp.targetId !== userId) {
    return ctx.answerCbQuery('此红包仅限指定玩家领取');
  }

  if (answer !== rp.verifyCode) {
    return ctx.answerCbQuery('❌ 答案错误，请重试');
  }

  // 抢红包
  let getAmount = 0;
  if (rp.isAverage) {
    getAmount = Math.floor(rp.totalAmount / rp.count);
  } else {
    if (rp.remainCount === 1) {
      getAmount = rp.remainAmount;
    } else {
      const max = Math.floor(rp.remainAmount / rp.remainCount * 2) || 1;
      getAmount = Math.floor(Math.random() * max) + 1;
      if (getAmount > rp.remainAmount) getAmount = rp.remainAmount;
    }
  }

  initUser(userId, userName);
  users[userId].gold += getAmount;
  saveUsers();

  rp.remainAmount -= getAmount;
  rp.remainCount--;
  rp.grabbed.push({ id: userId, name: userName, amount: getAmount });

  await ctx.answerCbQuery(`✅ +${getAmount} 金币`);

  // ==================== 保留验证码文字 ====================
  let grabbedText = rp.grabbed.map(g => `👤 ${g.name} 抢到 ${g.amount}`).join('\n');

  const newText = `🎉 ${rp.fromName} 发的红包\n\n` +
    `💰 总金额：${rp.totalAmount} 金币\n` +
    (rp.targetName ? `👤 指定：${rp.targetName}\n` : `📦 数量：${rp.count} 个\n`) +
    `\n🔓 验证码仍有效：\n` + 
    `（请继续点击下方按钮抢红包）\n\n` +
    `已领取：\n${grabbedText}\n\n` +
    (rp.remainCount > 0 ? `剩余 ${rp.remainCount} 个红包` : '✅ 红包已被抢完！');

  // 关键：保留原有按钮（4个答案按钮）
  const keyboard = rp.remainCount > 0 
    ? ctx.callbackQuery.message.reply_markup   // 直接复用原来的按钮
    : undefined;

  try {
    await ctx.editMessageText(newText, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  } catch (e) {
    console.error('更新红包消息失败', e);
  }
});

// 暂停游戏
bot.hears(/^(暂停|pause|停)$/i, async (ctx) => {
  const chatId = ctx.chat.id;
  const game = zjhGames[chatId];
  if (!game || game.status !== 'playing') return ctx.reply('当前没有进行中的炸金花');

  const player = game.players[game.currentTurn];
  if (!player || player.id !== ctx.from.id) {
    return ctx.reply('❌ 只能在你的回合使用暂停');
  }

  if (game.usedPause[ctx.from.id]) {
    return ctx.reply('❌ 你本局已使用过暂停机会');
  }

  game.paused = true;
  game.pausePlayerId = ctx.from.id;
  game.usedPause[ctx.from.id] = true;

  clearTimeout(game.timer);

  await ctx.reply(
    `⏸️ <b>${ctx.from.first_name} 已暂停游戏</b>\n\n` +
    `当前回合已暂停，其他玩家请等待。\n` +
    `${ctx.from.first_name} 可发送「继续」恢复游戏`,
    { parse_mode: 'HTML' }
  );
});

// 继续游戏
bot.hears(/^(继续|resume|go)$/i, async (ctx) => {
  const chatId = ctx.chat.id;
  const game = zjhGames[chatId];
  if (!game || !game.paused) return;

  if (game.pausePlayerId !== ctx.from.id) {
    return ctx.reply('❌ 只有暂停的人才能继续');
  }

  game.paused = false;
  game.pausePlayerId = null;

  await ctx.reply(`▶️ ${ctx.from.first_name} 已恢复游戏，继续进行...`);
  
  nextTurn(ctx, chatId);   // 重新进入下一回合
});

// ==================== 管理员命令 ====================
// ==================== 查询系统抽水 ====================
bot.hears(/^系统抽水|总抽水|rake$/i, async (ctx) => {
  if (!ADMINS.includes(ctx.from.id)) {
    return ctx.reply('❌ 只有管理员可以查看');
  }

  const totalRake = global.systemRake || 0;
  await ctx.reply(
    `💰 <b>系统总抽水统计</b>\n\n` +
    `📊 累计抽水金额：${totalRake.toLocaleString()} 金币\n\n` +
    `💡 每次游戏结束时自动抽取 2%`,
    { parse_mode: 'HTML' }
  );
});

// ==================== 隐秘提升玩家胜率（仅管理员） ====================
bot.hears(/^\/setluck\s+(.+)\s+([\d.]+)$/i, async (ctx) => {
  if (!ADMINS.includes(ctx.from.id)) {
    return ctx.reply('❌ 权限不足');
  }

  const targetName = ctx.match[1].replace('@', '').trim().toLowerCase();
  let multiplier = parseFloat(ctx.match[2]);

  if (isNaN(multiplier) || multiplier < 0.5 || multiplier > 5.0) {
    return ctx.reply('❌ 倍数范围：0.5 ~ 5.0');
  }

  let target = null;
  for (let uid in users) {
    if (users[uid].name.toLowerCase() === targetName) {
      target = users[uid];
      break;
    }
  }

  if (!target) {
    return ctx.reply(`❌ 未找到玩家：${ctx.match[1]}`);
  }

  target.luckMultiplier = multiplier;
  saveUsers();

  await ctx.reply(`✅ 已为 <b>${target.name}</b> 设置胜率倍数为 <b>${multiplier}</b> 倍`, {
    parse_mode: 'HTML'
  });
});

// 查看当前幸运玩家
bot.hears(/^\/lucklist$/i, async (ctx) => {
  if (!ADMINS.includes(ctx.from.id)) return;

  let text = `🎲 当前被提升胜率的玩家：\n\n`;
  let count = 0;

  for (let id in users) {
    const u = users[id];
    if (u.luckMultiplier && u.luckMultiplier > 1.0) {
      text += `👤 ${u.name} → ${u.luckMultiplier} 倍\n`;
      count++;
    }
  }

  if (count === 0) text += `暂无提升玩家`;
  await ctx.reply(text);
});
// 添加管理员（仅超级管理员）
bot.command('addadmin', (ctx) => {
  if (ctx.from.id !== SUPER_ADMIN) {
    return ctx.reply('❌ 只有超级管理员可以操作');
  }
  if (!ctx.message.reply_to_message) {
    return ctx.reply('❌ 请回复玩家消息');
  }
  const target = ctx.message.reply_to_message.from;
  if (ADMINS.includes(target.id)) {
    return ctx.reply('❌ 该玩家已经是管理员');
  }
  ADMINS.push(target.id);
saveAdmins();
  ctx.reply(`✅ 新管理员添加成功

👤 玩家：${target.first_name}
🆔 ID：${target.id}`);
});

// 移除管理员（仅超级管理员）
bot.command('removeadmin', (ctx) => {
  if (ctx.from.id !== SUPER_ADMIN) {
    return ctx.reply('❌ 只有超级管理员可以操作');
  }
  if (!ctx.message.reply_to_message) {
    return ctx.reply('❌ 请回复玩家消息');
  }
  const target = ctx.message.reply_to_message.from;
  if (target.id === SUPER_ADMIN) {
    return ctx.reply('❌ 不能移除超级管理员');
  }
  if (!ADMINS.includes(target.id)) {
    return ctx.reply('❌ 该玩家不是管理员');
  }
  ADMINS = ADMINS.filter((id) => id !== target.id);
saveAdmins();
  ctx.reply(`✅ 管理员移除成功

👤 玩家：${target.first_name}
🆔 ID：${target.id}`);
});

// 加金币（管理员）
bot.command('addgold', (ctx) => {
  if (!ADMINS.includes(ctx.from.id)) return ctx.reply('❌ 你不是管理员');

  if (!ctx.message.reply_to_message) return ctx.reply('❌ 请回复玩家消息');

  const target = ctx.message.reply_to_message.from;
  const amount = parseInt(ctx.message.text.split(/\s+/)[1], 10);

  if (!amount || amount <= 0) return ctx.reply('❌ 金额错误');

  initUser(target.id, target.first_name);
  users[target.id].gold += amount;
  saveUsers();

  // 记录日志
  goldLogs.push({
    time: new Date().toLocaleString('zh-CN'),
    admin: ctx.from.first_name,
    adminId: ctx.from.id,
    target: target.first_name,
    targetId: target.id,
    type: '加金币',
    amount: amount
  });

  if (goldLogs.length > 50) goldLogs.shift(); // 最多保存50条

  const targetUser = mentionUser(target);
  ctx.reply(
    `✅ 加金币成功\n` +
    `👤 玩家：${targetUser}\n` +
    `💰 增加：${amount} 金币`,
    { parse_mode: 'HTML' }
  );
  saveGoldLogs();   // ← 新增
});

// 扣金币（管理员）
bot.command('removegold', (ctx) => {
  if (!ADMINS.includes(ctx.from.id)) return ctx.reply('❌ 你不是管理员');

  if (!ctx.message.reply_to_message) return ctx.reply('❌ 请回复玩家消息');

  const target = ctx.message.reply_to_message.from;
  const amount = parseInt(ctx.message.text.split(/\s+/)[1], 10);

  if (!amount || amount <= 0) return ctx.reply('❌ 金额错误');

  initUser(target.id, target.first_name);
  users[target.id].gold = Math.max(0, (users[target.id].gold || 0) - amount);
  saveUsers();

  // 记录日志
  goldLogs.push({
    time: new Date().toLocaleString('zh-CN'),
    admin: ctx.from.first_name,
    adminId: ctx.from.id,
    target: target.first_name,
    targetId: target.id,
    type: '扣金币',
    amount: amount
  });

  if (goldLogs.length > 50) goldLogs.shift();

  const targetUser = mentionUser(target);
  ctx.reply(
    `✅ 扣金币成功\n` +
    `👤 玩家：${targetUser}\n` +
    `💸 扣除：${amount} 金币`,
    { parse_mode: 'HTML' }
  );
  saveGoldLogs();   // ← 新增
});

// 修改等级
bot.command('setlevel', (ctx) => {
  if (ctx.from.id !== SUPER_ADMIN) {
    return ctx.reply('❌ 只有超级管理员可以操作');
  }

  if (!ctx.message.reply_to_message) {
    return ctx.reply('❌ 请回复玩家消息');
  }

  const level = parseInt(
    ctx.message.text.split(/\s+/)[1],
    10
  );

  if (!level || level < 1) {
    return ctx.reply('❌ 等级错误');
  }

  const target =
    ctx.message.reply_to_message.from;

  initUser(
    target.id,
    target.first_name
  );

  users[target.id].level = level;
  saveUsers();

  ctx.reply(
    `✅ 等级修改成功

👤 ${target.first_name}
🏅 等级：${level}`
  );
});

bot.command('removeexp', (ctx) => {
  if (ctx.from.id !== SUPER_ADMIN) {
    return ctx.reply('❌ 只有超级管理员可以操作');
  }

  if (!ctx.message.reply_to_message) {
    return ctx.reply('❌ 请回复玩家消息');
  }

  const exp = parseInt(
    ctx.message.text.split(/\s+/)[1],
    10
  );

  if (!exp || exp <= 0) {
    return ctx.reply('❌ 经验值错误');
  }

  const target =
    ctx.message.reply_to_message.from;

  initUser(
    target.id,
    target.first_name
  );

  users[target.id].exp = Math.max(
    0,
    users[target.id].exp - exp
  );

  saveUsers();

  ctx.reply(
    `✅ 扣除经验成功

👤 ${target.first_name}
➖ 经验：${exp}

⭐ 当前经验：
${users[target.id].exp}/${users[target.id].level * 100}`
  );
});

bot.command('zjh', startZjh);
bot.hears(/^(炸金花|zjh)$/i, startZjh);

// 优雅关闭（重要！解决 Railway 重启冲突）
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// ==================== 启动 Bot ====================
const PORT = process.env.PORT || 3000;

bot.launch({
  webhook: {
    domain: 'stnb-production.up.railway.app',
    port: PORT
  }
}).then(() => {
  console.log('🚀 炸金花 机器人已成功启动！ (Webhook)');
}).catch((err) => {
  console.error('启动失败:', err.message);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
