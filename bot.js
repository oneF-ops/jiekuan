const { Telegraf } = require('telegraf')
const fs = require('fs')
const cron = require('node-cron')

const bot = new Telegraf(process.env.BOT_TOKEN)

// 管理员
const ADMINS = [process.env.ADMIN_ID]

// 数据文件
const DATA_FILE = './data.json'

// ================== 数据操作 ==================
function loadData() {
    if (!fs.existsSync(DATA_FILE)) return []
    return JSON.parse(fs.readFileSync(DATA_FILE))
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

// ================== 金额解析 ==================
function parseAmount(str) {
    str = str.toLowerCase()
    if (str.includes('w')) return parseFloat(str) * 10000
    return parseFloat(str)
}

// ================== 防重复借款 ==================
function hasUnpaidLoan(data, user) {
    return data.some(i => i.user === user && i.status === 'unpaid')
}

// ================== 自动借款识别 ==================
bot.on('text', (ctx) => {
    const text = ctx.message.text
    const user = ctx.from.username || ctx.from.first_name

    const match = text.match(/(借款|借)\s*([\d.]+w?)/)
    if (!match) return

    const amount = parseAmount(match[2])
    if (!amount) return

    let data = loadData()

    // ❌ 防重复借款
    if (hasUnpaidLoan(data, user)) {
        return ctx.reply(`⚠️ ${user} 还有未结清借款，无法再次借款`)
    }

    const interest = amount * 0.3
    const total = amount + interest

    const now = new Date()
    const due = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    const record = {
        user,
        amount,
        interest,
        total,
        time: now.toISOString(),
        due: due.toISOString(),
        status: 'unpaid'
    }

    data.push(record)
    saveData(data)

    ctx.reply(
`📌 借款成功

用户：${user}
本金：${amount}
利息：${interest}
应还：${total}
最晚还款：${due.toLocaleString()}`
    )
})

// ================== 借款列表 ==================
bot.command('loanlist', (ctx) => {
    const data = loadData()

    if (!data.length) return ctx.reply('暂无记录')

    let msg = '📊 当前借款名单\n\n'

    data.forEach(d => {
        msg += `${d.user} | ${d.amount} | ${d.total} | ${d.status}\n`
    })

    ctx.reply(msg)
})

// ================== 标记还款 ==================
bot.command('repay', (ctx) => {
    if (!ADMINS.includes(ctx.from.id.toString())) return

    const name = ctx.message.text.split(' ')[1]
    let data = loadData()

    const item = data.find(i => i.user === name && i.status === 'unpaid')
    if (!item) return ctx.reply('未找到未还记录')

    item.status = 'paid'
    saveData(data)

    ctx.reply(`✅ 已标记 ${name} 已还款`)
})

// ================== 删除记录 ==================
bot.command('remove', (ctx) => {
    if (!ADMINS.includes(ctx.from.id.toString())) return

    const name = ctx.message.text.split(' ')[1]
    let data = loadData()

    data = data.filter(i => i.user !== name)
    saveData(data)

    ctx.reply(`🗑 已删除 ${name}`)
})

// ================== 统计功能 ==================
bot.command('stats', (ctx) => {
    const data = loadData()

    const totalLoan = data.reduce((a, b) => a + b.amount, 0)
    const unpaid = data.filter(i => i.status === 'unpaid').reduce((a, b) => a + b.total, 0)
    const paid = data.filter(i => i.status === 'paid').reduce((a, b) => a + b.total, 0)

    const users = new Set(data.map(i => i.user)).size

    ctx.reply(
`📊 系统统计

借款总额：${totalLoan}
未还总额：${unpaid}
已还总额：${paid}
借款人数：${users}`
    )
})

// ================== 用户查询 ==================
bot.command('user', (ctx) => {
    const name = ctx.message.text.split(' ')[1]
    if (!name) return ctx.reply('用法：/user A')

    const data = loadData().filter(i => i.user === name)

    if (!data.length) return ctx.reply('无记录')

    let msg = `👤 ${name} 借款记录\n\n`

    data.forEach(d => {
        msg += `本金:${d.amount} 应还:${d.total} 状态:${d.status}\n`
    })

    ctx.reply(msg)
})

// ================== 到期提醒（每小时） ==================
cron.schedule('0 * * * *', () => {
    const data = loadData()
    const now = Date.now()

    data.forEach(d => {
        if (d.status !== 'unpaid') return

        const due = new Date(d.due).getTime()
        const diff = due - now

        // 提前1小时提醒
        if (diff < 3600000 && diff > 0) {
            bot.telegram.sendMessage(
                process.env.ADMIN_ID,
                `⚠️ ${d.user} 即将到期，还剩不到1小时`
            )
        }

        // 已超时
        if (diff <= 0) {
            bot.telegram.sendMessage(
                process.env.ADMIN_ID,
                `🚨 ${d.user} 已逾期未还款`
            )
        }
    })
})

bot.launch()
console.log('🚀 bot running...')