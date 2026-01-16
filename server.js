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
let isReady = false; // متغير لحفظ حالة الجاهزية

const client = new Client({
    authStrategy: new LocalAuth(),
    authTimeoutMs: 0, 
    qrMaxRetries: 10,
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
        timeout: 0 
    }
});

// صفحة البقاء حياً
app.get('/ping', (req, res) => { res.status(200).send('Pong!'); });

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });
app.use(express.static(__dirname));

io.on('connection', (socket) => {
    socket.emit('log', '🔌 متصل بالواجهة..');
    
    // إذا كان البوت جاهزاً مسبقاً، أخبر المتصفح فوراً
    if (isReady) {
        socket.emit('ready', 'Connected');
        socket.emit('log', '✅ البوت متصل بالفعل!');
    }

    socket.on('start_session', () => { 
        if (!isClientInitialized) {
            socket.emit('log', '🚀 جاري بدء المحرك..');
            isClientInitialized = true;
            try {
                client.initialize().catch(err => {
                    console.error("Init Error:", err);
                    socket.emit('log', '❌ خطأ: ' + err.message);
                    isClientInitialized = false; 
                });
            } catch (error) { isClientInitialized = false; }
        } else if (isReady) {
             socket.emit('ready', 'Connected');
        } else {
             socket.emit('log', '⏳ البوت يعمل في الخلفية، انتظر...');
        }
    });
});

client.on('qr', (qr) => { 
    QRCode.toDataURL(qr, (err, url) => { 
        io.emit('qr', url); 
        io.emit('log', '📷 الباركود جديد.. امسحه الآن.');
    }); 
});

// أهم حدث: عند نجاح المسح
client.on('authenticated', () => {
    io.emit('log', '🔐 تم المسح بنجاح! جاري مزامنة البيانات (قد يستغرق دقيقة)..');
    io.emit('authenticated', 'Auth Success'); // إشارة جديدة للشاشة
    console.log('AUTHENTICATED');
});

client.on('auth_failure', msg => {
    io.emit('log', '❌ فشل المصادقة: ' + msg);
    console.error('AUTHENTICATION FAILURE', msg);
});

client.on('ready', () => { 
    isReady = true;
    io.emit('log', '🎉 النظام جاهز كلياً!');
    io.emit('ready', 'Connected'); 
    console.log('READY');
});

client.on('message_create', async msg => {
    if (msg.fromMe && (msg.body.startsWith('✅') || msg.body.startsWith('📊'))) return;
    const chat = await msg.getChat();
    if (chat.isGroup && chat.name === "مصاريف جواد") {
        if (msg.body.startsWith('✅') || msg.body.startsWith('📊')) return;
        
        io.emit('log', `📩 رسالة: ${msg.body}`);
        console.log(`Msg: ${msg.body}`);

        try {
            const gpt = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: 'أنت محاسب. رد JSON فقط. Add: {"type":"add","amount":0,"category":"","item":""}. Query: {"type":"query"}.' },
                    { role: "user", content: msg.body }
                ],
                response_format: { type: "json_object" }
            });

            const action = JSON.parse(gpt.choices[0].message.content);
            if (action.type === 'add') {
                await axios.post(SHEET_URL, action);
                msg.reply(`✅ ${action.amount} (${action.category})`);
            } else if (action.type === 'query') {
                const res = await axios.post(SHEET_URL, {type: "query"});
                msg.reply(`📊 مصروفاتك: ${res.data.spent} | المتبقي: ${res.data.remaining}`);
            }
        } catch (e) { console.error(e); }
    }
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Running on ${PORT}`); });
