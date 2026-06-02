const { Telegraf } = require('telegraf')
const fs = require('fs')
const cron = require('node-cron')

const bot = new Telegraf(process.env.BOT_TOKEN)

const DATA_FILE = './data.json'

// ================== 数据结构 ==================
function loadDB() {
    if (!fs.existsSync(DATA_FILE)) {
        return { admins: [], loans: [] }
    }
    return JSON.parse(fs.readFileSync(DATA_FILE))
}

function saveDB(db) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2))
}

// ================== 权限判断 ==================
function isAdmin(ctx, db) {
    return db.admins.includes(ctx.from.id)
}

// ================== 金额解析 ==================
function parseAmount(str) {
    str = str.toLowerCase()
    if (str.includes('w')) return parseFloat(str) * 10000
    return parseFloat(str)
}

// ================== 自动借款识别 ==================
bot.on('text', (ctx) => {
    const text = ctx.message.text
    const user = ctx.from.username || ctx.from.first_name

    const match = text.match(/(借款|借)\s*([\d.]+w?)/)
    if (!match) return

    const amount = parseAmount(match[2])
    if (!amount) return

    const db = loadDB()

    // 防重复借款
    if (db.loans.some(i => i.user === user && i.status === 'unpaid')) {
        return ctx.reply('⚠️ 你还有未还清借款')
    }

    const interest = amount * 0.3
    const total = amount + interest

    const now = new Date()
    const due = new Date(now.getTime() + 24 * 60 * 60 * 1000)

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

    ctx.reply(
`📌 借款成功

用户：${user}
本金：${amount}
利息：${interest}
应还：${total}
到期：${due.toLocaleString()}`
    )
})


// ================== 添加管理员 ==================
bot.command('addadmin', (ctx) => {
    const db = loadDB()
    if (!isAdmin(ctx, db)) return ctx.reply('❌ 无权限')

    const id = parseInt(ctx.message.text.split(' ')[1])
    if (!id) return ctx.reply('用法：/addadmin 123456')

    if (!db.admins.includes(id)) {
        db.admins.push(id)
        saveDB(db)
    }

    ctx.reply(`✅ 已添加管理员：${id}`)
})

// ================== 删除管理员 ==================
bot.command('deladmin', (ctx) => {
    const db = loadDB()
    if (!isAdmin(ctx, db)) return ctx.reply('❌ 无权限')

    const id = parseInt(ctx.message.text.split(' ')[1])
    if (!id) return ctx.reply('用法：/deladmin 123456')

    db.admins = db.admins.filter(a => a !== id)
    saveDB(db)

    ctx.reply(`🗑 已删除管理员：${id}`)
})

// ================== 管理员列表 ==================
bot.command('admins', (ctx) => {
    const db = loadDB()

    if (!isAdmin(ctx, db)) return ctx.reply('❌ 无权限')

    if (!db.admins.length) return ctx.reply('暂无管理员')

    ctx.reply(
        '👮 当前管理员：\n' +
        db.admins.map(a => `- ${a}`).join('\n')
    )
})


// ================== 借款列表 ==================
bot.command('loanlist', (ctx) => {
    const db = loadDB()

    let msg = '📊 借款名单\n\n'

    db.loans.forEach(d => {
        msg += `${d.user} | ${d.amount} | ${d.total} | ${d.status}\n`
    })

    ctx.reply(msg)
})


// ================== 标记还款 ==================
bot.command('repay', (ctx) => {
    const db = loadDB()
    if (!isAdmin(ctx, db)) return ctx.reply('❌ 无权限')

    const name = ctx.message.text.split(' ')[1]

    const loan = db.loans.find(i => i.user === name && i.status === 'unpaid')
    if (!loan) return ctx.reply('未找到记录')

    loan.status = 'paid'
    saveDB(db)

    ctx.reply(`✅ 已标记 ${name} 已还款`)
})


// ================== 删除记录 ==================
bot.command('remove', (ctx) => {
    const db = loadDB()
    if (!isAdmin(ctx, db)) return ctx.reply('❌ 无权限')

    const name = ctx.message.text.split(' ')[1]

    db.loans = db.loans.filter(i => i.user !== name)
    saveDB(db)

    ctx.reply(`🗑 已删除 ${name}`)
})


// ================== 统计 ==================
bot.command('stats', (ctx) => {
    const db = loadDB()

    const total = db.loans.reduce((a, b) => a + b.amount, 0)
    const unpaid = db.loans.filter(i => i.status === 'unpaid').reduce((a, b) => a + b.total, 0)
    const paid = db.loans.filter(i => i.status === 'paid').reduce((a, b) => a + b.total, 0)

    ctx.reply(
`📊 统计

总借出：${total}
未还：${unpaid}
已还：${paid}`
    )
})


// ================== 用户查询 ==================
bot.command('user', (ctx) => {
    const name = ctx.message.text.split(' ')[1]

    const db = loadDB()
    const list = db.loans.filter(i => i.user === name)

    if (!list.length) return ctx.reply('无记录')

    ctx.reply(
        list.map(i =>
            `${i.user} ${i.amount} 应还:${i.total} ${i.status}`
        ).join('\n')
    )
})


// ================== 到期提醒 ==================
cron.schedule('0 * * * *', () => {
    const db = loadDB()
    const now = Date.now()

    db.loans.forEach(l => {
        if (l.status !== 'unpaid') return

        const due = new Date(l.due).getTime()
        const diff = due - now

        if (diff < 3600000 && diff > 0) {
            bot.telegram.sendMessage(
                db.admins[0],
                `⚠️ ${l.user} 即将到期`
            )
        }

        if (diff <= 0) {
            bot.telegram.sendMessage(
                db.admins[0],
                `🚨 ${l.user} 已逾期`
            )
        }
    })
})

bot.launch()
console.log('🚀 bot running...')
