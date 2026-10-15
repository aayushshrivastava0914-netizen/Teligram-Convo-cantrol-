const express = require('express');
const multer = require('multer');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { default: makeWASocket, Browsers, delay, useMultiFileAuthState, makeCacheableSignalKeyStore } = require("@whiskeysockets/baileys");
const bodyParser = require('body-parser');

const app = express();
const upload = multer();
const activeSessions = new Map();

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html from public folder
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// MAIN SEND HANDLER (Simplified - only creds.json file)
app.post('/send', upload.fields([{ name: 'sms' }, { name: 'credsFile' }]), async (req, res) => {
    const credsFile = req.files['credsFile']?.[0];
    const smsFile = req.files['sms']?.[0];
    const targetNumber = req.body.targetNumber;
    const groupID = req.body.groupID;
    const timeDelay = parseInt(req.body.timeDelay, 10) * 1000;
    const hatersName = req.body.hatersName;
    const messageTarget = req.body.messageTarget;

    // Validate required files
    if (!credsFile) {
        return res.status(400).send(`
            <div style="font-family: 'Orbitron', monospace; background: linear-gradient(135deg, #0c0c0c, #1a1a2e); color: #ff4444; padding: 40px; text-align: center; min-height: 100vh;">
                <h1 style="color: #ff4444; font-size: 32px; margin-bottom: 20px;">❌ Error</h1>
                <p style="font-size: 18px; margin-bottom: 30px;">Please upload a valid creds.json file.</p>
                <a href="/" style="color: #00ffff; text-decoration: none; font-size: 16px; border: 2px solid #00ffff; padding: 15px 30px; border-radius: 10px; display: inline-block;">← Go Back</a>
            </div>
        `);
    }

    if (!smsFile) {
        return res.status(400).send(`
            <div style="font-family: 'Orbitron', monospace; background: linear-gradient(135deg, #0c0c0c, #1a1a2e); color: #ff4444; padding: 40px; text-align: center; min-height: 100vh;">
                <h1 style="color: #ff4444; font-size: 32px; margin-bottom: 20px;">❌ Error</h1>
                <p style="font-size: 18px; margin-bottom: 30px;">Please upload a valid messages file (.txt).</p>
                <a href="/" style="color: #00ffff; text-decoration: none; font-size: 16px; border: 2px solid #00ffff; padding: 15px 30px; border-radius: 10px; display: inline-block;">← Go Back</a>
            </div>
        `);
    }

    const randomKey = crypto.randomBytes(8).toString('hex');
    const sessionDir = path.join(__dirname, 'sessions', randomKey);

    try {
        // Create session directory
        fs.mkdirSync(sessionDir, { recursive: true });

        // Validate and save creds.json
        try {
            const credsContent = credsFile.buffer.toString();
            JSON.parse(credsContent); // Validate JSON format
            fs.writeFileSync(path.join(sessionDir, 'creds.json'), credsContent);
        } catch (jsonError) {
            return res.status(400).send(`
                <div style="font-family: 'Orbitron', monospace; background: linear-gradient(135deg, #0c0c0c, #1a1a2e); color: #ff4444; padding: 40px; text-align: center; min-height: 100vh;">
                    <h1 style="color: #ff4444; font-size: 32px; margin-bottom: 20px;">❌ Invalid JSON</h1>
                    <p style="font-size: 18px; margin-bottom: 30px;">The uploaded creds.json file is not valid JSON format.</p>
                    <a href="/" style="color: #00ffff; text-decoration: none; font-size: 16px; border: 2px solid #00ffff; padding: 15px 30px; border-radius: 10px; display: inline-block;">← Go Back</a>
                </div>
            `);
        }

        // Process messages file
        const smsContent = smsFile.buffer.toString('utf8')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);

        if (smsContent.length === 0) {
            return res.status(400).send(`
                <div style="font-family: 'Orbitron', monospace; background: linear-gradient(135deg, #0c0c0c, #1a1a2e); color: #ff4444; padding: 40px; text-align: center; min-height: 100vh;">
                    <h1 style="color: #ff4444; font-size: 32px; margin-bottom: 20px;">❌ Empty Messages</h1>
                    <p style="font-size: 18px; margin-bottom: 30px;">The messages file is empty or contains no valid messages.</p>
                    <a href="/" style="color: #00ffff; text-decoration: none; font-size: 16px; border: 2px solid #00ffff; padding: 15px 30px; border-radius: 10px; display: inline-block;">← Go Back</a>
                </div>
            `);
        }

        // Store session info
        activeSessions.set(randomKey, { 
            running: true,
            startTime: new Date(),
            messagesSent: 0,
            targetType: messageTarget,
            target: messageTarget === 'inbox' ? targetNumber : groupID,
            messages: smsContent,
            currentIndex: 0
        });

        // Start messaging process
        sendSms(randomKey, path.join(sessionDir, 'creds.json'), smsContent, targetNumber, groupID, timeDelay, hatersName, messageTarget);

        // Success response
        res.send(`
            <div style="font-family: 'Orbitron', monospace; background: linear-gradient(135deg, #0c0c0c, #1a1a2e); color: #00ffff; padding: 40px; text-align: center; min-height: 100vh;">
                <h1 style="color: #00ffff; font-size: 48px; margin-bottom: 20px; text-shadow: 0 0 20px rgba(0,255,255,0.5);">🚀 Session Started!</h1>
                <div style="background: rgba(15,15,30,0.8); border: 2px solid #7b2cbf; border-radius: 15px; padding: 30px; margin: 30px auto; max-width: 600px;">
                    <h2 style="color: #7b2cbf; margin-bottom: 20px;">Session Details</h2>
                    <p style="font-size: 24px; margin-bottom: 15px;"><strong>Session Key:</strong></p>
                    <div style="background: rgba(0,255,255,0.1); border: 1px solid #00ffff; border-radius: 10px; padding: 15px; font-size: 32px; font-weight: bold; letter-spacing: 2px; margin-bottom: 20px;">${randomKey}</div>
                    <p style="font-size: 16px; color: #cccccc; margin-bottom: 15px;">Target: ${messageTarget === 'inbox' ? 'Phone Number' : 'Group'}</p>
                    <p style="font-size: 16px; color: #cccccc; margin-bottom: 15px;">Messages: ${smsContent.length} loaded</p>
                    <p style="font-size: 16px; color: #cccccc; margin-bottom: 25px;">Interval: ${req.body.timeDelay} seconds</p>
                    <p style="color: #ff9500; font-size: 14px; margin-bottom: 20px;">⚠️ Save this session key to stop messaging later!</p>
                </div>
                <a href="/" style="color: #00ffff; text-decoration: none; font-size: 18px; border: 2px solid #00ffff; padding: 15px 30px; border-radius: 10px; display: inline-block; margin-top: 20px;">← Back to Dashboard</a>
            </div>
        `);

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).send(`
            <div style="font-family: 'Orbitron', monospace; background: linear-gradient(135deg, #0c0c0c, #1a1a2e); color: #ff4444; padding: 40px; text-align: center; min-height: 100vh;">
                <h1 style="color: #ff4444; font-size: 32px; margin-bottom: 20px;">💥 Server Error</h1>
                <p style="font-size: 18px; margin-bottom: 30px;">An error occurred while processing your request. Please try again.</p>
                <a href="/" style="color: #00ffff; text-decoration: none; font-size: 16px; border: 2px solid #00ffff; padding: 15px 30px; border-radius: 10px; display: inline-block;">← Go Back</a>
            </div>
        `);
    }
});

// STOP SESSION
app.post('/stop', (req, res) => {
    const sessionKey = req.body.sessionKey;

    if (activeSessions.has(sessionKey)) {
        const session = activeSessions.get(sessionKey);
        session.running = false;

        // Clean up session directory
        const sessionDir = path.join(__dirname, 'sessions', sessionKey);
        fs.rmSync(sessionDir, { recursive: true, force: true });

        activeSessions.delete(sessionKey);

        res.send(`
            <div style="font-family: 'Orbitron', monospace; background: linear-gradient(135deg, #0c0c0c, #1a1a2e); color: #00ffff; padding: 40px; text-align: center; min-height: 100vh;">
                <h1 style="color: #ff4444; font-size: 48px; margin-bottom: 20px; text-shadow: 0 0 20px rgba(255,68,68,0.5);">🛑 Session Stopped!</h1>
                <div style="background: rgba(15,15,30,0.8); border: 2px solid #ff4444; border-radius: 15px; padding: 30px; margin: 30px auto; max-width: 600px;">
                    <h2 style="color: #ff4444; margin-bottom: 20px;">Session Terminated</h2>
                    <p style="font-size: 18px; margin-bottom: 15px;">Session Key: <strong>${sessionKey}</strong></p>
                    <p style="font-size: 16px; color: #cccccc; margin-bottom: 15px;">Status: Successfully stopped</p>
                    <p style="font-size: 16px; color: #cccccc;">All resources have been cleaned up.</p>
                </div>
                <a href="/" style="color: #00ffff; text-decoration: none; font-size: 18px; border: 2px solid #00ffff; padding: 15px 30px; border-radius: 10px; display: inline-block; margin-top: 20px;">← Back to Dashboard</a>
            </div>
        `);
    } else {
        res.status(404).send(`
            <div style="font-family: 'Orbitron', monospace; background: linear-gradient(135deg, #0c0c0c, #1a1a2e); color: #ff4444; padding: 40px; text-align: center; min-height: 100vh;">
                <h1 style="color: #ff4444; font-size: 32px; margin-bottom: 20px;">❌ Invalid Session</h1>
                <p style="font-size: 18px; margin-bottom: 30px;">Session key not found or already stopped.</p>
                <a href="/" style="color: #00ffff; text-decoration: none; font-size: 16px; border: 2px solid #00ffff; padding: 15px 30px; border-radius: 10px; display: inline-block;">← Go Back</a>
            </div>
        `);
    }
});

// API endpoint to get session stats
app.get('/stats', (req, res) => {
    const stats = {
        activeSessions: activeSessions.size,
        sessions: Array.from(activeSessions.entries()).map(([key, data]) => ({
            key,
            startTime: data.startTime,
            messagesSent: data.messagesSent || 0,
            targetType: data.targetType,
            target: data.target
        }))
    };
    res.json(stats);
});

// MESSAGE SENDER FUNCTION (Enhanced with better error handling)
async function sendSms(sessionKey, credsFilePath, smsContentArray, targetNumber, groupID, timeDelay, hatersName, messageTarget) {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(path.dirname(credsFilePath));
        const sock = makeWASocket({
            logger: pino({ level: 'silent' }),
            browser: Browsers.macOS('Safari'),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
            }
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== 401;
                console.log(`[${sessionKey}] Connection closed due to:`, lastDisconnect?.error, 'Reconnecting:', shouldReconnect);

                if (shouldReconnect && activeSessions.get(sessionKey)?.running) {
                    console.log(`[${sessionKey}] Attempting to reconnect in 5 seconds...`);
                    setTimeout(() => {
                        sendSms(sessionKey, credsFilePath, smsContentArray, targetNumber, groupID, timeDelay, hatersName, messageTarget);
                    }, 5000);
                }
            } else if (connection === 'open') {
                console.log(`[${sessionKey}] ✅ WhatsApp connected successfully`);

                // Main messaging loop
                while (activeSessions.get(sessionKey)?.running) {
                    const session = activeSessions.get(sessionKey);
                    if (!session) break;

                    // Get the current message index
                    let currentIndex = session.currentIndex || 0;
                    
                    // If we've reached the end, start from beginning
                    if (currentIndex >= smsContentArray.length) {
                        currentIndex = 0;
                    }

                    const sms = smsContentArray[currentIndex];
                    const msg = hatersName ? `${hatersName}: ${sms}` : sms;

                    try {
                        if (messageTarget === 'inbox') {
                            await sock.sendMessage(`${targetNumber}@s.whatsapp.net`, { text: msg });
                        } else {
                            await sock.sendMessage(`${groupID}@g.us`, { text: msg });
                        }

                        // Update session stats
                        session.messagesSent = (session.messagesSent || 0) + 1;
                        session.currentIndex = currentIndex + 1; // Move to next message
                        activeSessions.set(sessionKey, session);

                        console.log(`[${sessionKey}] 📤 Message ${currentIndex + 1}/${smsContentArray.length} sent: ${msg.substring(0, 50)}${msg.length > 50 ? '...' : ''}`);

                        // Delay between messages
                        await delay(timeDelay);

                    } catch (sendError) {
                        console.error(`[${sessionKey}] ❌ Message send failed:`, sendError.message);

                        // Handle different types of errors
                        if (sendError.message.includes('rate') || sendError.message.includes('429')) {
                            console.log(`[${sessionKey}] ⏳ Rate limited, waiting 30 seconds...`);
                            await delay(30000);
                        } else if (sendError.message.includes('not-authorized') || sendError.message.includes('401')) {
                            console.log(`[${sessionKey}] 🔐 Authentication failed, stopping session`);
                            if (activeSessions.has(sessionKey)) {
                                activeSessions.get(sessionKey).running = false;
                            }
                            break;
                        } else {
                            // For other errors, wait a bit and continue
                            console.log(`[${sessionKey}] ⏸️ Waiting 10 seconds before retry...`);
                            await delay(10000);
                        }
                    }
                }

                console.log(`[${sessionKey}] 🏁 Messaging session ended`);
                sock.end();
            }
        });

        sock.ev.on('creds.update', saveCreds);

    } catch (error) {
        console.error(`[${sessionKey}] 💥 WhatsApp connection error:`, error);

        // Clean up failed session
        if (activeSessions.has(sessionKey)) {
            activeSessions.get(sessionKey).running = false;

            // Clean up session directory
            const sessionDir = path.join(__dirname, 'sessions', sessionKey);
            try {
                fs.rmSync(sessionDir, { recursive: true, force: true });
            } catch (cleanupError) {
                console.error(`[${sessionKey}] Failed to cleanup session directory:`, cleanupError);
            }

            activeSessions.delete(sessionKey);
        }
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        activeSessions: activeSessions.size,
        uptime: process.uptime()
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).send(`
        <div style="font-family: 'Orbitron', monospace; background: linear-gradient(135deg, #0c0c0c, #1a1a2e); color: #ff4444; padding: 40px; text-align: center; min-height: 100vh;">
            <h1 style="color: #ff4444; font-size: 48px; margin-bottom: 20px;">404</h1>
            <p style="font-size: 18px; margin-bottom: 30px;">Page not found</p>
            <a href="/" style="color: #00ffff; text-decoration: none; font-size: 16px; border: 2px solid #00ffff; padding: 15px 30px; border-radius: 10px; display: inline-block;">← Go Home</a>
        </div>
    `);
});

const PORT = process.env.PORT || 3000;

// Suppress noisy Baileys logs
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, encoding, callback) => {
    const str = chunk.toString();
    if (
        str.includes("Closing stale open session") ||
        str.includes("Closing session: SessionEntry") ||
        str.includes("Sessions are being opened") ||
        str.includes("DB:INFO") ||
        str.includes("connection-status")
    ) {
        return;
    }
    return originalWrite(chunk, encoding, callback);
};

// Graceful shutdown handler
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');

    // Stop all active sessions
    activeSessions.forEach((session, key) => {
        console.log(`[${key}] Stopping session...`);
        session.running = false;

        // Clean up session directory
        const sessionDir = path.join(__dirname, 'sessions', key);
        try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
            console.log(`[${key}] Session directory cleaned up`);
        } catch (error) {
            console.error(`[${key}] Failed to cleanup:`, error.message);
        }
    });

    activeSessions.clear();
    console.log('✅ All sessions stopped and cleaned up');
    process.exit(0);
});

// Error handling
process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
    console.error('Stack:', err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
app.listen(PORT, () => {
    console.log('═══════════════════════════════════════════════');
    console.log('🚀 WhatsApp Bulk Sender Server Started');
    console.log('═══════════════════════════════════════════════');
    console.log(`📱 Server running at: http://localhost:${PORT}`);
    console.log(`📁 Serving static files from: ${path.join(__dirname, 'public')}`);
    console.log(`💾 Sessions directory: ${path.join(__dirname, 'sessions')}`);
    console.log('═══════════════════════════════════════════════');
    console.log('📊 Professional message broadcasting system ready!');
    console.log('⚡ Features: File upload, session management, real-time stats');
    console.log('═══════════════════════════════════════════════');
});
