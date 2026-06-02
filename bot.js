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

// ================== 面板 ==================
bot.command('panel', (ctx) => {
    const db = loadDB()
    if (!isAdmin(ctx, db)) return ctx.reply('❌ 无权限')

    ctx.reply('📊 钱庄系统',
        Markup.inlineKeyboard([
            [Markup.button.callback('📥 借款列表(申请)', 'loan_apply')],
            [Markup.button.callback('🏦 待放款列表', 'loan_pending')],
            [Markup.button.callback('💰 待还款列表', 'loan_repay')],
            [Markup.button.callback('👮 管理员', 'list_admin')],
            [Markup.button.callback('📈 统计', 'stats')],
        ])
    )
})

// ================== 📥 借款申请列表（修复重点） ==================
bot.action('loan_apply', (ctx) => {
    const db = loadDB()
    ctx.answerCbQuery()

    const list = db.loans.filter(i => i.status === 'apply')

    if (!list.length) return ctx.reply('暂无借款申请')

    let msg = '📥 借款申请列表\n\n'

    const buttons = list.map(i => {
        msg += `👤 @${i.username} 金额：${i.amount}\n`
        return [Markup.button.callback(`🏦 放款 @${i.username}`, `give_${i.id}`)]
    })

    ctx.reply(msg, Markup.inlineKeyboard(buttons))
})

// ================== 🏦 待放款列表（修复） ==================
bot.action('loan_pending', (ctx) => {
    const db = loadDB()
    ctx.answerCbQuery()

    const list = db.loans.filter(i => i.status === 'apply')

    if (!list.length) return ctx.reply('暂无待放款')

    const buttons = list.map(i => [
        Markup.button.callback(`💰 放款 @${i.username} ￥${i.amount}`, `give_${i.id}`)
    ])

    ctx.reply('🏦 待放款列表', Markup.inlineKeyboard(buttons))
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

    ctx.reply('💰 待还款列表', Markup.inlineKeyboard(buttons))
})

// ================== 放款 ==================
bot.action(/give_(.+)/, (ctx) => {
    const db = loadDB()
    if (!isAdmin(ctx, db)) return ctx.reply('❌ 无权限')

    const loan = db.loans.find(i => i.id == ctx.match[1])
    if (!loan) return ctx.reply('❌ 未找到')

    loan.status = 'repaying'
    saveDB(db)

    ctx.answerCbQuery('已放款')
    ctx.reply(`🏦 已放款 @${loan.username}`)
})

// ================== 还款 ==================
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

    ctx.reply(`📊 统计

申请中：${apply}
待还款：${repay}
已完成：${done}`)
})

// ================== 👮 回复添加管理员（恢复版） ==================
bot.command('addadmin', (ctx) => {
    const db = loadDB()
    if (!isAdmin(ctx, db)) return ctx.reply('❌ 无权限')

    const reply = ctx.message.reply_to_message
    if (!reply) return ctx.reply('❌ 请回复用户消息使用 /addadmin')

    const id = reply.from.id

    if (!db.admins.includes(id)) {
        db.admins.push(id)
        saveDB(db)
    }

    ctx.reply(`✅ 已添加管理员：@${reply.from.username || reply.from.first_name}`)
})

// ================== 删除管理员 ==================
bot.command('deladmin', (ctx) => {
    const db = loadDB()
    if (!isAdmin(ctx, db)) return ctx.reply('❌ 无权限')

    const reply = ctx.message.reply_to_message
    if (!reply) return ctx.reply('❌ 请回复用户消息使用 /deladmin')

    const id = reply.from.id

    db.admins = db.admins.filter(a => a !== id)
    saveDB(db)

    ctx.reply('🗑 已删除管理员')
})

// ================== 管理员列表 ==================
bot.action('list_admin', (ctx) => {
    const db = loadDB()
    ctx.reply('👮 管理员列表：\n' + db.admins.join('\n'))
})

// ================== 借款 ==================
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
        total: amount,
        status: 'apply',
        time: new Date().toISOString()
    })

    saveDB(db)

    ctx.reply(`📥 申请成功
👤 @${username}
💰 金额：${amount}
⏳ 状态：申请中`)
})

// ================== 启动 ==================
bot.launch()
console.log('🚀 钱庄系统修复完成')

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
