const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Connection (Optional)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp_tool';

// WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "whatsapp-marketing-tool"
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-first-run',
            '--no-zygote',
            '--single-process'
        ]
    }
});

let qrCode = null;
let isConnected = false;
let currentProgress = 0;

// WhatsApp Events
client.on('qr', async (qr) => {
    console.log('QR Code received');
    qrCode = await qrcode.toDataURL(qr);
    console.log('QR Code generated');
});

client.on('ready', () => {
    console.log('WhatsApp client is ready!');
    isConnected = true;
    qrCode = null;
});

client.on('disconnected', () => {
    console.log('WhatsApp client disconnected');
    isConnected = false;
});

client.initialize();

// API Routes
app.get('/api/status', (req, res) => {
    res.json({ 
        connected: isConnected,
        qr_available: !!qrCode,
        message: isConnected ? 'WhatsApp Connected' : 'WhatsApp Disconnected'
    });
});

app.get('/api/qr', (req, res) => {
    if (qrCode) {
        res.json({ success: true, qr: qrCode });
    } else if (isConnected) {
        res.json({ success: true, connected: true, message: 'WhatsApp is connected' });
    } else {
        res.json({ success: false, message: 'QR code not available' });
    }
});

// Number Detection API
app.post('/api/detect-numbers', async (req, res) => {
    const { keyword, location, limit = 50 } = req.body;
    
    try {
        // Simulate number detection from various sources
        const numbers = await simulateNumberDetection(keyword, location, limit);
        
        res.json({
            success: true,
            numbers: numbers,
            count: numbers.length,
            message: `Found ${numbers.length} numbers for ${keyword} in ${location}`
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Group Extraction API
app.post('/api/extract-groups', async (req, res) => {
    const { keywords, limit = 10 } = req.body;
    
    try {
        if (!isConnected) {
            return res.json({ success: false, error: 'WhatsApp not connected' });
        }

        const groups = await simulateGroupExtraction(keywords, limit);
        
        res.json({
            success: true,
            groups: groups,
            message: `Extracted ${groups.length} groups`
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Bulk Messaging API
app.post('/api/send-bulk', async (req, res) => {
    const { contacts, message, delay = 5000 } = req.body;
    
    if (!isConnected) {
        return res.json({ success: false, error: 'WhatsApp not connected' });
    }

    try {
        const results = [];
        let successCount = 0;
        
        for (let i = 0; i < contacts.length; i++) {
            const number = contacts[i];
            
            try {
                const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
                await client.sendMessage(chatId, message);
                results.push({ number, status: 'success' });
                successCount++;
            } catch (error) {
                results.push({ number, status: 'error', error: error.message });
            }
            
            // Update progress
            currentProgress = ((i + 1) / contacts.length) * 100;
            
            // Delay between messages
            if (i < contacts.length - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        res.json({ 
            success: true, 
            results: results,
            sent: successCount,
            failed: contacts.length - successCount
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Campaign Management
app.post('/api/create-campaign', async (req, res) => {
    const { name, message, contacts, schedule } = req.body;
    
    try {
        // Save campaign to database or file
        const campaign = {
            id: Date.now().toString(),
            name,
            message,
            contacts,
            schedule,
            status: 'scheduled',
            created: new Date()
        };
        
        res.json({ success: true, campaign: campaign });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Export Numbers
app.post('/api/export-numbers', async (req, res) => {
    const { numbers, format = 'txt' } = req.body;
    
    try {
        let exportData = '';
        
        if (format === 'txt') {
            exportData = numbers.join('\n');
        } else if (format === 'csv') {
            exportData = 'Number,Name,Location\n' + 
                numbers.map(num => `${num.number},${num.name},${num.location}`).join('\n');
        }
        
        res.json({
            success: true,
            data: exportData,
            format: format,
            count: numbers.length
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Utility Functions
async function simulateNumberDetection(keyword, location, limit) {
    const numbers = [];
    const prefixes = ['77', '76', '75', '74', '71', '70'];
    
    for (let i = 0; i < limit; i++) {
        const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
        const randomNum = Math.floor(1000000 + Math.random() * 9000000);
        const number = `94${prefix}${randomNum}`.substring(0, 11);
        
        numbers.push({
            number: number,
            name: `${keyword} Business ${i+1}`,
            location: location,
            type: keyword,
            hasWhatsApp: Math.random() > 0.2
        });
    }
    
    return numbers;
}

async function simulateGroupExtraction(keywords, limit) {
    const groups = [];
    
    for (let i = 0; i < limit; i++) {
        groups.push({
            id: `group_${i}`,
            name: `${keywords} Group ${i+1}`,
            members: Math.floor(50 + Math.random() * 200),
            active: Math.random() > 0.3
        });
    }
    
    return groups;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 WhatsApp Marketing Tool Server running on port ${PORT}`);
});
