const { Telegraf, Markup } = require('telegraf')
const fs = require('fs')

const bot = new Telegraf(process.env.BOT_TOKEN)

const DATA_FILE = './data.json'

// 🔥 这里改成你的 Telegram ID（超级管理员，永远最高权限）
const SUPER_ADMIN = 8431715705

// ================== DB ==================
function loadDB() {
    if (!fs.existsSync(DATA_FILE)) {
        const db = {
            admins: [SUPER_ADMIN],
            loans: []
        }
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2))
        return db
    }

    const db = JSON.parse(fs.readFileSync(DATA_FILE))

    // 🔥 防止被清空管理员导致锁死
    if (!db.admins || db.admins.length === 0) {
        db.admins = [SUPER_ADMIN]
    }

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

    ctx.reply(
        '📊 钱庄管理面板',
        Markup.inlineKeyboard([
            [Markup.button.callback('📋 借款列表', 'loan_list')],
            [Markup.button.callback('💰 标记还款', 'repay_menu')],
            [Markup.button.callback('🗑 删除记录', 'delete_menu')],
            [Markup.button.callback('📈 系统统计', 'stats')],
            [Markup.button.callback('👮 管理员管理', 'admin_menu')],
        ])
    )
})

// ================== 借款列表 ==================
bot.action('loan_list', (ctx) => {
    const db = loadDB()
    ctx.answerCbQuery()

    if (!db.loans.length) return ctx.reply('暂无记录')

    let msg = '📋 借款列表\n\n'

    db.loans.forEach(l => {
        msg += `ID:${l.id}\n用户:${l.username}\n金额:${l.amount}\n应还:${l.total}\n状态:${l.status}\n\n`
    })

    ctx.reply(msg)
})

// ================== 统计 ==================
bot.action('stats', (ctx) => {
    const db = loadDB()
    ctx.answerCbQuery()

    const total = db.loans.reduce((a, b) => a + b.amount, 0)
    const unpaid = db.loans.filter(i => i.status === 'unpaid').reduce((a, b) => a + b.total, 0)
    const paid = db.loans.filter(i => i.status === 'paid').reduce((a, b) => a + b.total, 0)

    ctx.reply(
`📊 系统统计

总借出：${total}
未还：${unpaid}
已还：${paid}`
    )
})

// ================== 💰 还款按钮 ==================
bot.action('repay_menu', (ctx) => {
    const db = loadDB()
    if (!isAdmin(ctx, db)) return ctx.reply('❌ 无权限')

    const users = db.loans.filter(i => i.status === 'unpaid')
    if (!users.length) return ctx.reply('暂无未还记录')

    const buttons = users.map(u =>
        [Markup.button.callback(
            `👤 ${u.username} | ￥${u.total}`,
            `repay_${u.id}`
        )]
    )

    ctx.reply(
        '请选择要标记还款的用户：',
        Markup.inlineKeyboard(buttons)
    )
})

// ================== 还款 ==================
bot.action(/repay_(.+)/, (ctx) => {
    const db = loadDB()
    if (!isAdmin(ctx, db)) return ctx.reply('❌ 无权限')

    const loan = db.loans.find(i => i.id == ctx.match[1])
    if (!loan) return ctx.reply('❌ 未找到记录')

    loan.status = 'paid'
    saveDB(db)

    ctx.answerCbQuery('已还款')
    ctx.reply(`✅ 已标记还款：${loan.username}`)
})

// ================== 🗑 删除按钮 ==================
bot.action('delete_menu', (ctx) => {
    const db = loadDB()
    if (!isAdmin(ctx, db)) return ctx.reply('❌ 无权限')

    if (!db.loans.length) return ctx.reply('暂无记录')

    const buttons = db.loans.map(u =>
        [Markup.button.callback(
            `🗑 ${u.username} | ￥${u.total}`,
            `del_${u.id}`
        )]
    )

    ctx.reply(
        '请选择要删除的记录：',
        Markup.inlineKeyboard(buttons)
    )
})

// ================== 删除 ==================
bot.action(/del_(.+)/, (ctx) => {
    const db = loadDB()
    if (!isAdmin(ctx, db)) return ctx.reply('❌ 无权限')

    const loan = db.loans.find(i => i.id == ctx.match[1])
    if (!loan) return ctx.reply('❌ 未找到记录')

    db.loans = db.loans.filter(i => i.id != loan.id)
    saveDB(db)

    ctx.answerCbQuery('已删除')
    ctx.reply(`🗑 已删除：${loan.username}`)
})

// ================== 管理员菜单 ==================
bot.action('admin_menu', (ctx) => {
    const db = loadDB()
    if (!isAdmin(ctx, db)) return ctx.reply('❌ 无权限')

    ctx.reply(
        '👮 管理员管理',
        Markup.inlineKeyboard([
            [Markup.button.callback('➕ 添加管理员', 'add_admin')],
            [Markup.button.callback('➖ 删除管理员', 'del_admin')],
            [Markup.button.callback('👮 管理员列表', 'list_admin')],
        ])
    )
})

// ================== 添加管理员 ==================
bot.action('add_admin', (ctx) => {
    ctx.reply('请输入要添加的 userId：')

    bot.once('text', (msgCtx) => {
        const db = loadDB()
        if (!isAdmin(msgCtx, db)) return msgCtx.reply('❌ 无权限')

        const uid = parseInt(msgCtx.message.text)

        if (!db.admins.includes(uid)) {
            db.admins.push(uid)
            saveDB(db)
        }

        msgCtx.reply('✅ 已添加管理员')
    })
})

// ================== 删除管理员 ==================
bot.action('del_admin', (ctx) => {
    ctx.reply('请输入要删除的 userId：')

    bot.once('text', (msgCtx) => {
        const db = loadDB()
        if (!isAdmin(msgCtx, db)) return msgCtx.reply('❌ 无权限')

        const uid = parseInt(msgCtx.message.text)

        db.admins = db.admins.filter(a => a !== uid)
        saveDB(db)

        msgCtx.reply('🗑 已删除管理员')
    })
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

    if (db.loans.some(i => i.userId === userId && i.status === 'unpaid')) {
        return ctx.reply('⚠️ 你还有未还款')
    }

    const interest = amount * 0.3
    const total = amount + interest

    db.loans.push({
        id: Date.now(),
        userId,
        username,
        amount,
        interest,
        total,
        status: 'unpaid',
        time: new Date().toISOString()
    })

    saveDB(db)

    ctx.reply(
`📌 借款成功

用户：${username}
本金：${amount}
利息：${interest}
应还：${total}`
    )
})

// ================== 启动 ==================
bot.launch()
console.log('🚀 钱庄系统已启动')

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
