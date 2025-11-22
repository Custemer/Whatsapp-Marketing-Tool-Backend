const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');
const path = require('path');

const app = express();

// CORS
app.use(cors());
app.use(express.json());

// Store QR code and status
let currentQR = null;
let isConnected = false;
let client = null;

// Basic API routes
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        service: 'WhatsApp Marketing Backend',
        whatsapp: isConnected ? 'connected' : 'disconnected',
        qr_available: !!currentQR,
        timestamp: new Date().toISOString()
    });
});

app.get('/api/test', (req, res) => {
    res.json({ 
        success: true,
        message: 'Backend is working perfectly!',
        version: '1.0'
    });
});

app.get('/api/qr', (req, res) => {
    if (currentQR) {
        res.json({ success: true, qr: currentQR });
    } else {
        res.json({ success: false, qr: null, message: 'QR code not available yet. Please wait...' });
    }
});

app.get('/api/status', (req, res) => {
    res.json({ 
        success: true,
        connected: isConnected,
        qr_available: !!currentQR,
        message: isConnected ? 'WhatsApp Connected' : 'WhatsApp Disconnected'
    });
});

app.post('/api/init-whatsapp', (req, res) => {
    try {
        if (!client) {
            initializeWhatsApp();
            res.json({ success: true, message: 'WhatsApp client initialization started' });
        } else {
            res.json({ success: true, message: 'WhatsApp client already initialized' });
        }
    } catch (error) {
        res.json({ success: false, message: 'Initialization failed: ' + error.message });
    }
});

// WhatsApp Client Initialization with better error handling
function initializeWhatsApp() {
    console.log('🚀 Initializing WhatsApp client...');
    
    client = new Client({
        authStrategy: new LocalAuth({
            clientId: "whatsapp-marketing-client",
            dataPath: path.join(__dirname, 'sessions')
        }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu',
                '--remote-debugging-port=9222'
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null
        },
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
        }
    });

    client.on('qr', async (qr) => {
        console.log('📱 QR Code received - Generating...');
        try {
            currentQR = await qrcode.toDataURL(qr);
            console.log('✅ QR Code generated and stored');
        } catch (error) {
            console.error('❌ QR Code generation failed:', error);
        }
    });

    client.on('ready', () => {
        console.log('✅ WhatsApp client is ready!');
        isConnected = true;
        currentQR = null;
    });

    client.on('authenticated', () => {
        console.log('✅ WhatsApp authenticated successfully');
        currentQR = null;
    });

    client.on('auth_failure', (msg) => {
        console.error('❌ WhatsApp authentication failed:', msg);
        isConnected = false;
        currentQR = null;
    });

    client.on('disconnected', (reason) => {
        console.log('❌ WhatsApp disconnected:', reason);
        isConnected = false;
        currentQR = null;
        
        // Reinitialize after disconnect
        setTimeout(() => {
            console.log('🔄 Reinitializing WhatsApp client...');
            client.initialize();
        }, 5000);
    });

    client.on('loading_screen', (percent, message) => {
        console.log(`🔄 Loading Screen: ${percent}% - ${message}`);
    });

    // Initialize the client
    client.initialize().catch(error => {
        console.error('❌ WhatsApp initialization error:', error);
    });
}

// Auto-initialize WhatsApp when server starts
console.log('🔄 Auto-initializing WhatsApp client...');
setTimeout(() => {
    initializeWhatsApp();
}, 2000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🔗 Health: https://whatsapp-marketing-backend.onrender.com/api/health`);
    console.log(`🔗 Test: https://whatsapp-marketing-backend.onrender.com/api/test`);
    console.log(`🔗 QR: https://whatsapp-marketing-backend.onrender.com/api/qr`);
});
