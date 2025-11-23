const express = require("express");
const mongoose = require('mongoose');
const { delay } = require("@whiskeysockets/baileys");

let router = express.Router();

// Session Schema (same as in pair.js)
const sessionSchema = new mongoose.Schema({
    sessionId: String,
    phoneNumber: String,
    connected: { type: Boolean, default: false },
    pairingCode: String,
    lastActivity: { type: Date, default: Date.now },
    userData: Object
});

const Session = mongoose.model('Session', sessionSchema);

// Format phone number
function formatPhoneNumber(number) {
    try {
        const cleaned = number.toString().replace(/\D/g, '');
        if (cleaned.startsWith('0')) {
            return '94' + cleaned.substring(1);
        }
        if (cleaned.length === 9) {
            return '94' + cleaned;
        }
        return cleaned;
    } catch (error) {
        return number;
    }
}

// Send Single Message
router.post("/send-message", async (req, res) => {
    try {
        const { number, message } = req.body;
        
        if (!number || !message) {
            return res.json({ 
                success: false, 
                error: 'Number and message are required' 
            });
        }

        // Get WhatsApp client from pair.js (you might need to export it)
        const whatsappClient = require('./pair').whatsappClient;
        
        if (!whatsappClient || !whatsappClient.user) {
            return res.json({ 
                success: false, 
                error: 'WhatsApp not connected. Please connect first using pairing code.' 
            });
        }

        const formattedNumber = formatPhoneNumber(number) + '@s.whatsapp.net';
        
        await whatsappClient.sendMessage(formattedNumber, { text: message });
        
        // Update last activity
        await Session.findOneAndUpdate(
            {},
            { lastActivity: new Date() },
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            message: 'Message sent successfully'
        });

    } catch (error) {
        console.error('Send message error:', error);
        res.json({ 
            success: false, 
            error: 'Failed to send message: ' + error.message 
        });
    }
});

// Bulk Messaging
router.post("/send-bulk", async (req, res) => {
    try {
        const { contacts, message, delayMs = 2000 } = req.body;
        
        if (!contacts || !message) {
            return res.json({ 
                success: false, 
                error: 'Contacts and message are required' 
            });
        }

        const whatsappClient = require('./pair').whatsappClient;
        
        if (!whatsappClient || !whatsappClient.user) {
            return res.json({ 
                success: false, 
                error: 'WhatsApp not connected' 
            });
        }

        const results = [];
        let successCount = 0;

        for (let i = 0; i < contacts.length; i++) {
            const number = contacts[i];
            try {
                const formattedNumber = formatPhoneNumber(number) + '@s.whatsapp.net';
                await whatsappClient.sendMessage(formattedNumber, { text: message });
                results.push({ number, status: 'success' });
                successCount++;
                
                // Add delay between messages
                if (i < contacts.length - 1) {
                    await delay(delayMs);
                }
            } catch (error) {
                results.push({ number, status: 'error', error: error.message });
            }
        }

        // Update last activity
        await Session.findOneAndUpdate(
            {},
            { lastActivity: new Date() },
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            results: results,
            sent: successCount,
            failed: contacts.length - successCount,
            message: 'Sent ' + successCount + '/' + contacts.length + ' messages successfully'
        });

    } catch (error) {
        console.error('Bulk send error:', error);
        res.json({ 
            success: false, 
            error: 'Bulk send failed: ' + error.message 
        });
    }
});

// Get Statistics
router.get("/stats", async (req, res) => {
    try {
        const session = await Session.findOne({});
        const whatsappClient = require('./pair').whatsappClient;
        
        res.json({
            connected: whatsappClient && whatsappClient.user,
            phoneNumber: session?.phoneNumber,
            lastActivity: session?.lastActivity,
            totalMessages: session?.messageCount || 0
        });
    } catch (error) {
        res.json({ error: error.message });
    }
});

module.exports = router;
