const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const OpenAI = require('openai');
const QRCode = require('qrcode');
const axios = require('axios');
const path = require('path');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SHEET_URL = process.env.SHEET_URL; 

let isClientInitialized = false;

// 1. إعدادات المتصفح الصبور (لحل الخطأ الأحمر)
const client = new Client({
    authStrategy: new LocalAuth(),
    authTimeoutMs: 0, // 👈 انتظار المصادقة للأبد (مهم جداً)
    puppeteer: {
        headless: true,
        executablePath: '/usr/bin/google-chrome-stable',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', 
            '--disable-gpu'
        ],
        timeout: 0 // 👈 انتظار المتصفح للأبد
    }
});

// 2. كود "النكز" (Keep-Alive) لمنع النوم
app.get('/ping', (req, res) => {
    res.status(200).send('Pong! I am alive.');
});

// نكز ذاتي كل 5 دقائق
setInterval(() => {
    console.log('⏰ Keep-Alive Ping...');
    // هذا الكود يبقي المعالج نشطاً
}, 300000); 

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.use(express.static(__dirname));

io.on('connection', (socket) => {
    socket.emit('log', '🔌 الواجهة متصلة..');
    
    socket.on('start_session', () => { 
        if (!isClientInitialized) {
            socket.emit('log', '🚀 جاري التشغيل (وضع الصبر مفعل)..');
            isClientInitialized = true;
            
            client.initialize().catch(err => {
                console.error("Init Error:", err);
                socket.emit('log', '⚠️ إعادة المحاولة...');
                isClientInitialized = false; 
            });
        }
    });
});

client.on('qr', (qr) => { 
    QRCode.toDataURL(qr, (err, url) => { 
        io.emit('qr', url); 
        io.emit('log', '✅ الباركود جاهز!');
    }); 
});

client.on('ready', () => { 
    io.emit('log', '🎉 البوت متصل!');
    io.emit('ready', 'Connected'); 
    console.log('Client is ready!');
});

client.on('message_create', async msg => {
    if (msg.fromMe && (msg.body.startsWith('✅') || msg.body.startsWith('📊') || msg.body.startsWith('❌'))) return;

    const chat = await msg.getChat();
    
    if (chat.isGroup && chat.name === "مصاريف جواد") {
        
        if (msg.body.startsWith('✅') || msg.body.startsWith('📊')) return;

        io.emit('log', `📩 رسالة: ${msg.body}`);
        
        try {
            const gpt = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: 'أنت محاسب. إذا إضافة مصروف رد JSON: {"type":"add","amount":0,"category":"","item":""}. إذا استعلام رد JSON: {"type":"query"}.' },
                    { role: "user", content: msg.body }
                ],
                response_format: { type: "json_object" }
            });

            const action = JSON.parse(gpt.choices[0].message.content);

            if (action.type === 'add') {
                await axios.post(SHEET_URL, action);
                msg.reply(`✅ ${action.amount} (${action.category})`);
            } 
            else if (action.type === 'query') {
                const res = await axios.post(SHEET_URL, {type: "query"});
                const data = res.data;
                msg.reply(`📊 صرفت: ${data.spent} | باقي: ${data.remaining}`);
            }

        } catch (e) {
            console.error(e);
        }
    }
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Running on ${PORT}`); });
