const { Telegraf, Markup } = require('telegraf')
const fs = require('fs')
const cron = require('node-cron')

const bot = new Telegraf(process.env.BOT_TOKEN)

const DATA_FILE = './data.json'

// ================== DB ==================
function loadDB() {
    if (!fs.existsSync(DATA_FILE)) {
        return { admins: [], loans: [] }
    }
    return JSON.parse(fs.readFileSync(DATA_FILE))
}

function saveDB(db) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2))
}

// ================== 权限 ==================
function isAdmin(ctx, db) {
    return db.admins.includes(ctx.from.id)
}

// ================== 面板入口 ==================
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

    if (!db.loans.length) return ctx.reply('暂无记录')

    let msg = '📋 借款列表\n\n'
    db.loans.forEach(l => {
        msg += `${l.user} | ${l.amount} | ${l.total} | ${l.status}\n`
    })

    ctx.reply(msg)
})

// ================== 统计 ==================
bot.action('stats', (ctx) => {
    const db = loadDB()

    const total = db.loans.reduce((a,b)=>a+b.amount,0)
    const unpaid = db.loans.filter(i=>i.status==='unpaid').reduce((a,b)=>a+b.total,0)
    const paid = db.loans.filter(i=>i.status==='paid').reduce((a,b)=>a+b.total,0)

    ctx.reply(
`📊 系统统计

总借出：${total}
未还：${unpaid}
已还：${paid}`
    )
})

// ================== 标记还款（进入输入模式） ==================
const repayStep = new Map()

bot.action('repay_menu', (ctx) => {
    const db = loadDB()
    if (!isAdmin(ctx, db)) return ctx.reply('❌ 无权限')

    repayStep.set(ctx.from.id, true)
    ctx.reply('请输入要标记还款的用户名：')
})

// ================== 删除记录 ==================
const deleteStep = new Map()

bot.action('delete_menu', (ctx) => {
    const db = loadDB()
    if (!isAdmin(ctx, db)) return ctx.reply('❌ 无权限')

    deleteStep.set(ctx.from.id, true)
    ctx.reply('请输入要删除的用户名：')
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
const addAdminStep = new Map()

bot.action('add_admin', (ctx) => {
    addAdminStep.set(ctx.from.id, true)
    ctx.reply('请输入管理员ID：')
})

// ================== 删除管理员 ==================
const delAdminStep = new Map()

bot.action('del_admin', (ctx) => {
    delAdminStep.set(ctx.from.id, true)
    ctx.reply('请输入要删除的管理员ID：')
})

// ================== 管理员列表 ==================
bot.action('list_admin', (ctx) => {
    const db = loadDB()
    ctx.reply('👮 管理员：\n' + db.admins.join('\n'))
})

// ================== 文本处理（输入模式） ==================
bot.on('text', (ctx) => {
    const db = loadDB()
    const id = ctx.from.id
    const text = ctx.message.text

    // ===== repay =====
    if (repayStep.get(id)) {
        const loan = db.loans.find(i => i.user === text && i.status === 'unpaid')
        if (!loan) return ctx.reply('未找到记录')

        loan.status = 'paid'
        saveDB(db)

        repayStep.delete(id)
        return ctx.reply('✅ 已标记还款')
    }

    // ===== delete =====
    if (deleteStep.get(id)) {
        db.loans = db.loans.filter(i => i.user !== text)
        saveDB(db)

        deleteStep.delete(id)
        return ctx.reply('🗑 已删除')
    }

    // ===== add admin =====
    if (addAdminStep.get(id)) {
        const uid = parseInt(text)
        if (!db.admins.includes(uid)) db.admins.push(uid)

        saveDB(db)
        addAdminStep.delete(id)
        return ctx.reply('✅ 已添加管理员')
    }

    // ===== del admin =====
    if (delAdminStep.get(id)) {
        const uid = parseInt(text)
        db.admins = db.admins.filter(a => a !== uid)

        saveDB(db)
        delAdminStep.delete(id)
        return ctx.reply('🗑 已删除管理员')
    }
})

// ================== 自动借款识别 ==================
bot.on('text', (ctx) => {
    const text = ctx.message.text
    const user = ctx.from.username || ctx.from.first_name

    const match = text.match(/(借款|借)\s*([\d.]+w?)/)
    if (!match) return

    const amount = parseFloat(match[2]) * (match[2].includes('w') ? 10000 : 1)

    const db = loadDB()

    if (db.loans.some(i => i.user === user && i.status === 'unpaid')) {
        return ctx.reply('⚠️ 有未还款')
    }

    const interest = amount * 0.3
    const total = amount + interest

    const now = new Date()
    const due = new Date(Date.now() + 86400000)

    db.loans.push({
        user,
        amount,
        interest,
        total,
        time: now.toISOString(),
        due: due.toISOString(),
        status: 'unpaid'
    })

    saveDB(db)

    ctx.reply('📌 借款成功')
})

bot.launch()
console.log('🚀 panel bot running')
