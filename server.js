const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const OpenAI = require('openai');
const QRCode = require('qrcode');
const axios = require('axios');
const path = require('path'); // مكتبة لتحديد المسارات بدقة

// قراءة المتغيرات
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SHEET_URL = process.env.SHEET_URL; 

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: '/opt/render/project/src/.wwebjs_auth' }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--no-first-run', '--single-process', '--disable-gpu']
    }
});

// هذا السطر هو الإصلاح 👇
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.use(express.static(__dirname));

io.on('connection', (socket) => {
    socket.on('start_session', () => { client.initialize(); });
});

client.on('qr', (qr) => { QRCode.toDataURL(qr, (err, url) => { io.emit('qr', url); }); });
client.on('ready', () => { io.emit('ready', 'Connected'); console.log('Ready!'); });

client.on('message', async msg => {
    const chat = await msg.getChat();
    if (chat.isGroup && chat.name === "مصاريف جواد") {
        io.emit('log', `📩 رسالة جديدة: ${msg.body}`);
        try {
            const gpt = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: 'أنت محاسب. إذا كانت إضافة مصروف رد JSON: {"type":"add","amount":0,"category":"","item":""}. إذا استعلام رد JSON: {"type":"query"}. تجاهل أي كلام آخر.' },
                    { role: "user", content: msg.body }
                ],
                response_format: { type: "json_object" }
            });

            const action = JSON.parse(gpt.choices[0].message.content);

            if (action.type === 'add') {
                await axios.post(SHEET_URL, action);
                msg.reply(`✅ تم تسجيل ${action.amount} (${action.category})`);
            } 
            else if (action.type === 'query') {
                const res = await axios.post(SHEET_URL, {type: "query"});
                const data = res.data;
                msg.reply(`📊 التقرير:\n- صرفت: ${data.spent}\n- باقي: ${data.remaining}\n- الميزانية: ${data.budget}`);
            }

        } catch (e) {
            console.error(e);
            io.emit('log', '❌ خطأ: ' + e.message);
        }
    }
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Running on ${PORT}`); });
