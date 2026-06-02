const { Telegraf, Markup } = require('telegraf')
const fs = require('fs')

const bot = new Telegraf(process.env.BOT_TOKEN)

const DATA_FILE = './data.json'
const SUPER_ADMIN = 8431715705

// ================== DB ==================
function loadDB() {
    if (!fs.existsSync(DATA_FILE)) {
        const db = { admins: [SUPER_ADMIN], loans: [] }
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2))
        return db
    }

    const db = JSON.parse(fs.readFileSync(DATA_FILE))
    if (!db.admins?.length) db.admins = [SUPER_ADMIN]
    if (!db.loans) db.loans = []
    return db
}

function saveDB(db) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2))
}

// ================== 权限 ==================
function isAdmin(ctx, db) {
    return ctx.from.id === SUPER_ADMIN || db.admins.includes(ctx.from.id)
}

// ================== 时间工具 ==================
function now() {
    return Date.now()
}

// ================== 面板 ==================
bot.command('panel', (ctx) => {
    const db = loadDB()
    if (!isAdmin(ctx, db)) return ctx.reply('❌ 无权限')

    ctx.reply('📊 钱庄系统',
        Markup.inlineKeyboard([
            [Markup.button.callback('📥 借款申请', 'loan_apply')],
            [Markup.button.callback('🏦 待放款', 'loan_pending')],
            [Markup.button.callback('💰 待还款', 'loan_repay')],
            [Markup.button.callback('⚠️ 逾期', 'loan_overdue')],
            [Markup.button.callback('📈 统计', 'stats')],
        ])
    )
})

// ================== 📥 申请列表 ==================
bot.action('loan_apply', (ctx) => {
    const db = loadDB()
    ctx.answerCbQuery()

    const list = db.loans.filter(i => i.status === 'apply')
    if (!list.length) return ctx.reply('暂无申请')

    const buttons = list.map(i => [
        Markup.button.callback(`🏦 放款 @${i.username}`, `give_${i.id}`)
    ])

    let msg = '📥 借款申请\n\n'
    list.forEach(i => {
        msg += `👤 @${i.username} 金额:${i.amount}\n`
    })

    ctx.reply(msg, Markup.inlineKeyboard(buttons))
})

// ================== 🏦 放款列表 ==================
bot.action('loan_pending', (ctx) => {
    const db = loadDB()
    ctx.answerCbQuery()

    const list = db.loans.filter(i => i.status === 'repaying')
    if (!list.length) return ctx.reply('暂无放款记录')

    let msg = '🏦 已放款列表\n\n'

    list.forEach(i => {
        const remaining = i.dueTime - now()
        msg += `👤 @${i.username}
本金：${i.amount}
应还：${i.total}
剩余时间：${Math.max(0, Math.floor(remaining / 3600000))}小时
ID:${i.id}\n\n`
    })

    ctx.reply(msg)
})

// ================== 💰 待还款 ==================
bot.action('loan_repay', (ctx) => {
    const db = loadDB()
    if (!isAdmin(ctx, db)) return ctx.reply('❌ 无权限')

    const list = db.loans.filter(i => i.status === 'repaying')
    if (!list.length) return ctx.reply('暂无待还款')

    const buttons = list.map(i => [
        Markup.button.callback(`💰 还款 @${i.username} ￥${i.total}`, `repay_${i.id}`)
    ])

    ctx.reply('待还款列表', Markup.inlineKeyboard(buttons))
})

// ================== ⚠️ 逾期 ==================
bot.action('loan_overdue', (ctx) => {
    const db = loadDB()
    ctx.answerCbQuery()

    const list = db.loans.filter(i =>
        i.status === 'repaying' && now() > i.dueTime
    )

    if (!list.length) return ctx.reply('暂无逾期')

    list.forEach(i => i.status = 'overdue')
    saveDB(db)

    let msg = '⚠️ 逾期列表\n\n'
    list.forEach(i => {
        msg += `👤 @${i.username} 应还:${i.total}\n`
    })

    ctx.reply(msg)
})

// ================== 💰 放款 ==================
bot.action(/give_(.+)/, (ctx) => {
    const db = loadDB()
    if (!isAdmin(ctx, db)) return ctx.reply('❌ 无权限')

    const loan = db.loans.find(i => i.id == ctx.match[1])
    if (!loan) return ctx.reply('❌ 未找到')

    const interest = loan.amount * 0.3
    const total = loan.amount + interest

    loan.interest = interest
    loan.total = total
    loan.status = 'repaying'
    loan.startTime = now()
    loan.dueTime = now() + 24 * 60 * 60 * 1000 // 24小时

    saveDB(db)

    ctx.answerCbQuery('已放款')
    ctx.reply(`🏦 已放款 @${loan.username}
💰 应还：${total}
⏰ 24小时内需还款`)
})

// ================== 💰 还款 ==================
bot.action(/repay_(.+)/, (ctx) => {
    const db = loadDB()
    if (!isAdmin(ctx, db)) return ctx.reply('❌ 无权限')

    const loan = db.loans.find(i => i.id == ctx.match[1])
    if (!loan) return ctx.reply('❌ 未找到')

    loan.status = 'done'
    saveDB(db)

    ctx.answerCbQuery('已还款')
    ctx.reply(`💰 已还清 @${loan.username}`)
})

// ================== 统计 ==================
bot.action('stats', (ctx) => {
    const db = loadDB()
    ctx.answerCbQuery()

    const apply = db.loans.filter(i => i.status === 'apply').length
    const repay = db.loans.filter(i => i.status === 'repaying').length
    const done = db.loans.filter(i => i.status === 'done').length
    const overdue = db.loans.filter(i => i.status === 'overdue').length

    ctx.reply(`📊 系统统计

申请：${apply}
放款：${repay}
完成：${done}
逾期：${overdue}`)
})

// ================== 借款申请 ==================
bot.on('text', (ctx) => {

    const db = loadDB()
    const text = ctx.message.text.trim()

    const match = text.match(/借款\s*([\d.]+)\s*([wW万]?)/)
    if (!match) return

    let amount = parseFloat(match[1])
    if (match[2]) amount *= 10000

    const userId = ctx.from.id
    const username = ctx.from.username || ctx.from.first_name

    if (db.loans.some(i => i.userId === userId && i.status !== 'done')) {
        return ctx.reply('⚠️ 你还有未完成借款')
    }

    db.loans.push({
        id: Date.now(),
        userId,
        username,
        amount,
        status: 'apply',
        time: now()
    })

    saveDB(db)

    ctx.reply(`📥 申请成功
👤 @${username}
💰 金额：${amount}
⏳ 等待放款`)
})

// ================== 启动 ==================
bot.launch()
console.log('🚀 钱庄系统最终完整版已启动')

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
