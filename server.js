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

// إعدادات المتصفح الخاصة بالسيرفرات
const client = new Client({
    authStrategy: new LocalAuth(),
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
        timeout: 60000 
    }
});

// صفحة الويب
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.use(express.static(__dirname));

// إدارة الاتصال بالواجهة
io.on('connection', (socket) => {
    socket.emit('log', '🔌 الواجهة متصلة..');
    
    socket.on('start_session', () => { 
        if (!isClientInitialized) {
            socket.emit('log', '🚀 جاري التشغيل.. انتظر دقيقة');
            isClientInitialized = true;
            client.initialize().catch(err => {
                console.error("Init Error:", err);
                socket.emit('log', '❌ خطأ في التشغيل: ' + err.message);
                isClientInitialized = false; 
            });
        } else {
             socket.emit('log', '⚠️ البوت يعمل بالفعل.. انتظر.');
        }
    });
});

// عند استلام الباركود
client.on('qr', (qr) => { 
    QRCode.toDataURL(qr, (err, url) => { 
        io.emit('qr', url); 
        io.emit('log', '✅ الباركود جاهز! امسحه الآن.');
    }); 
});

// عند الجاهزية
client.on('ready', () => { 
    io.emit('log', '🎉 البوت متصل وجاهز للعمل!');
    io.emit('ready', 'Connected'); 
});

// استقبال الرسائل (بما فيها رسائلك أنت)
client.on('message_create', async msg => {
    
    // تجاهل رسائل البوت نفسه
    if (msg.fromMe && (msg.body.startsWith('✅') || msg.body.startsWith('📊') || msg.body.startsWith('❌'))) return;

    const chat = await msg.getChat();
    
    // التأكد أن الرسالة في قروب "مصاريف جواد"
    if (chat.isGroup && chat.name === "مصاريف جواد") {
        
        // إذا كانت الرسالة من البوت نفسه (ردوده)، نتجاهلها حتى لا يدخل في حلقة مفرغة
        // لكن نسمح برسائلك أنت (التي تعتبر fromMe = true أيضاً)
        // الشرط هنا: إذا كانت الرسالة تبدأ بـ ✅ أو 📊 نتجاهلها فقط
        if (msg.body.startsWith('✅') || msg.body.startsWith('📊')) return;

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
        }
    }
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Running on ${PORT}`); });
