const express = require('express');
const path = require('path');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_OWNER_ID = process.env.TELEGRAM_OWNER_ID;

const users = new Map();
let telegramBot = null;
let loaderRunning = false;

app.get('/', (req, res) => {
    const file = path.join(__dirname, 'public', 'index.html');

    if (fs.existsSync(file)) {
        return res.sendFile(file);
    }

    res.status(404).send('Dashboard file not found.');
});

app.get('/health', (req, res) => {
    res.json({
        status: 'online',
        uptime: Math.floor(process.uptime())
    });
});

app.get('/stats', (req, res) => {
    res.json({
        status: 'online',
        loaderRunning,
        registeredUsers: users.size,
        uptime: Math.floor(process.uptime())
    });
});

app.post('/stop', (req, res) => {
    loaderRunning = false;

    res.json({
        success: true,
        message: 'Stop request received.'
    });
});

if (TELEGRAM_BOT_TOKEN && TELEGRAM_OWNER_ID) {
    telegramBot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
        polling: true
    });

    function isOwner(msg) {
        return msg.from &&
            String(msg.from.id) === String(TELEGRAM_OWNER_ID);
    }

    function mainMenu() {
        return {
            reply_markup: {
                keyboard: [
                    ['🆔 Submit UID'],
                    ['📱 Submit WhatsApp Number'],
                    ['📊 Loader Status'],
                    ['▶️ Start Loader', '🛑 Stop Loader']
                ],
                resize_keyboard: true
            }
        };
    }

    telegramBot.onText(/^\/start$/, async (msg) => {
        if (!isOwner(msg)) {
            return telegramBot.sendMessage(
                msg.chat.id,
                '⛔ Access denied.'
            );
        }

        users.set(msg.from.id, {
            step: 'uid',
            uid: null,
            phone: null
        });

        await telegramBot.sendMessage(
            msg.chat.id,
            '🤖 Welcome to your Loader Bot!\n\n' +
            'सबसे पहले अपनी UID भेजें।\n' +
            'अपनी निजी जानकारी किसी अनजान व्यक्ति को न भेजें।'
        );
    });

    telegramBot.onText(/^\/status$/, async (msg) => {
        if (!isOwner(msg)) {
            return telegramBot.sendMessage(
                msg.chat.id,
                '⛔ Access denied.'
            );
        }

        await telegramBot.sendMessage(
            msg.chat.id,
            '📊 Server: ONLINE\n' +
            '⏱ Uptime: ' +
            Math.floor(process.uptime()) + ' seconds\n' +
            '▶️ Loader: ' +
            (loaderRunning ? 'RUNNING' : 'STOPPED')
        );
    });

    telegramBot.onText(/^\/stop$/, async (msg) => {
        if (!isOwner(msg)) {
            return telegramBot.sendMessage(
                msg.chat.id,
                '⛔ Access denied.'
            );
        }

        loaderRunning = false;

        await telegramBot.sendMessage(
            msg.chat.id,
            '🛑 Stop request received.\n' +
            'यह कमांड Render सर्वर को बंद नहीं करती।'
        );
    });

    telegramBot.onText(/^\/help$/, async (msg) => {
        if (!isOwner(msg)) {
            return telegramBot.sendMessage(
                msg.chat.id,
                '⛔ Access denied.'
            );
        }

        await telegramBot.sendMessage(
            msg.chat.id,
            '/start - Start bot\n' +
            '/status - Check status\n' +
            '/stop - Stop request\n' +
            '/help - Help menu',
            mainMenu()
        );
    });

    telegramBot.on('message', async (msg) => {
        if (!msg.text || !isOwner(msg)) return;
        if (msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text.trim();

        if (
            ['🆔 Submit UID', '📱 Submit WhatsApp Number',
             '📊 Loader Status', '▶️ Start Loader',
             '🛑 Stop Loader'].includes(text)
        ) {
            if (text === '🆔 Submit UID') {
                users.set(userId, { step: 'uid' });

                return telegramBot.sendMessage(
                    chatId,
                    'अपनी UID भेजें:'
                );
            }

            if (text === '📱 Submit WhatsApp Number') {
                users.set(userId, {
                    ...(users.get(userId) || {}),
                    step: 'phone'
                });

                return telegramBot.sendMessage(
                    chatId,
                    'Country code सहित नंबर भेजें। उदाहरण: +91XXXXXXXXXX'
                );
            }

            if (text === '📊 Loader Status') {
                return telegramBot.sendMessage(
                    chatId,
                    'Loader: ' +
                    (loaderRunning ? 'RUNNING' : 'STOPPED')
                );
            }

            if (text === '▶️ Start Loader') {
                return telegramBot.sendMessage(
                    chatId,
                    '⚠️ वास्तविक Loader अभी कनेक्ट नहीं है।\n' +
                    'पहले अपने अधिकृत Loader का implementation जोड़ना होगा।'
                );
            }

            if (text === '🛑 Stop Loader') {
                loaderRunning = false;

                return telegramBot.sendMessage(
                    chatId,
                    '🛑 Stop request received.'
                );
            }
        }

        const user = users.get(userId);
        if (!user) return;

        if (user.step === 'uid') {
            if (text.length < 3 || text.length > 100) {
                return telegramBot.sendMessage(
                    chatId,
                    'UID सही से भेजें।'
                );
            }

            user.uid = text;
            user.step = 'phone';

            return telegramBot.sendMessage(
                chatId,
                '✅ UID प्राप्त हुई।\nअब अपना WhatsApp नंबर country code सहित भेजें:'
            );
        }

        if (user.step === 'phone') {
            const phone = text.replace(/[\s()-]/g, '');

            if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
                return telegramBot.sendMessage(
                    chatId,
                    '❌ नंबर सही नहीं है। उदाहरण: +91XXXXXXXXXX'
                );
            }

            user.phone = phone;
            user.step = 'ready';

            return telegramBot.sendMessage(
                chatId,
                '✅ UID और नंबर प्राप्त हो गए।\n\n' +
                '⚠️ Pairing Code बनाने के लिए वास्तविक WhatsApp ' +
                'Loader कोड अभी जोड़ना बाकी है।\n\n' +
                'अपना OTP या WhatsApp verification code किसी को न दें।',
                mainMenu()
            );
        }

        if (user.step === 'ready') {
            return telegramBot.sendMessage(
                chatId,
                'Menu से विकल्प चुनें या /status भेजें।',
                mainMenu()
            );
        }
    });

    telegramBot.on('polling_error', (err) => {
        console.error('Telegram polling error:', err.message);
    });

    console.log('Telegram bot initialized.');
} else {
    console.log(
        'Set TELEGRAM_BOT_TOKEN and TELEGRAM_OWNER_ID in Render Environment.'
    );
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
