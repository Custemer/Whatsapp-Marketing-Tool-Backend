const express = require("express");
const { delay } = require("@whiskeysockets/baileys");
const multer = require('multer');

const Session = require("../models/Session");
const Contact = require("../models/Contact");
const { getWhatsAppClient } = require("./pair");

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

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

// Send Single Message - FIXED VERSION
router.post("/send", upload.single('image'), async (req, res) => {
    try {
        console.log('📨 Send message request received:', req.body);
        
        // Check if request body exists
        if (!req.body) {
            return res.json({ 
                success: false, 
                error: 'Request body is missing' 
            });
        }

        const { number, message } = req.body;
        
        console.log('📞 Number:', number);
        console.log('💬 Message:', message);
        
        if (!number || !message) {
            return res.json({ 
                success: false, 
                error: 'Number and message are required' 
            });
        }

        const client = getWhatsAppClient();
        
        if (!client || !client.user) {
            return res.json({ 
                success: false, 
                error: 'WhatsApp not connected. Please connect first using pairing code.' 
            });
        }

        const formattedNumber = formatPhoneNumber(number) + '@s.whatsapp.net';
        
        console.log('🔢 Formatted number:', formattedNumber);
        
        let messageOptions = { text: message };
        
        // Handle image if provided
        if (req.file) {
            console.log('🖼️ Image attached:', req.file.originalname);
            messageOptions = {
                image: req.file.buffer,
                caption: message,
                mimetype: req.file.mimetype
            };
        }
        
        // Send message
        await client.sendMessage(formattedNumber, messageOptions);
        
        // Update contact in database
        await Contact.findOneAndUpdate(
            { phoneNumber: number },
            {
                phoneNumber: number,
                lastContacted: new Date(),
                $inc: { messageCount: 1 }
            },
            { upsert: true, new: true }
        );
        
        // Update session stats
        await Session.findOneAndUpdate(
            {},
            { 
                lastActivity: new Date(),
                $inc: { 'stats.totalMessages': 1 }
            },
            { upsert: true, new: true }
        );

        console.log('✅ Message sent successfully to', number);
        
        res.json({
            success: true,
            message: 'Message sent successfully',
            number: number
        });

    } catch (error) {
        console.error('❌ Send message error:', error);
        res.json({ 
            success: false, 
            error: 'Failed to send message: ' + error.message 
        });
    }
});

// Bulk Messaging - FIXED VERSION
router.post("/bulk", upload.array('images', 5), async (req, res) => {
    try {
        console.log('📨 Bulk message request received');
        
        // Check if request body exists
        if (!req.body) {
            return res.json({ 
                success: false, 
                error: 'Request body is missing' 
            });
        }

        const { contacts, message, delayMs = 2000 } = req.body;
        
        console.log('📞 Contacts:', contacts);
        console.log('💬 Message:', message);
        console.log('⏰ Delay:', delayMs);
        
        if (!contacts || !message) {
            return res.json({ 
                success: false, 
                error: 'Contacts and message are required' 
            });
        }

        const client = getWhatsAppClient();
        
        if (!client || !client.user) {
            return res.json({ 
                success: false, 
                error: 'WhatsApp not connected' 
            });
        }

        const contactList = Array.isArray(contacts) ? contacts : contacts.split('\n').filter(num => num.trim() !== '');
        const results = [];
        let successCount = 0;

        console.log('📋 Processing', contactList.length, 'contacts');

        for (let i = 0; i < contactList.length; i++) {
            const number = contactList[i].trim();
            console.log(`📨 Sending to ${i+1}/${contactList.length}: ${number}`);
            
            try {
                const formattedNumber = formatPhoneNumber(number) + '@s.whatsapp.net';
                
                let messageOptions = { text: message };
                
                // Add image if available
                if (req.files && req.files.length > 0) {
                    const image = req.files[0]; // Use first image for all messages
                    messageOptions = {
                        image: image.buffer,
                        caption: message,
                        mimetype: image.mimetype
                    };
                }
                
                await client.sendMessage(formattedNumber, messageOptions);
                results.push({ number, status: 'success' });
                successCount++;
                
                // Update contact in database
                await Contact.findOneAndUpdate(
                    { phoneNumber: number },
                    {
                        phoneNumber: number,
                        lastContacted: new Date(),
                        $inc: { messageCount: 1 }
                    },
                    { upsert: true, new: true }
                );
                
                // Add delay between messages
                if (i < contactList.length - 1) {
                    await delay(parseInt(delayMs));
                }
            } catch (error) {
                console.error(`❌ Failed to send to ${number}:`, error.message);
                results.push({ number, status: 'error', error: error.message });
            }
        }

        // Update session stats
        await Session.findOneAndUpdate(
            {},
            { 
                lastActivity: new Date(),
                $inc: { 'stats.totalMessages': successCount }
            },
            { upsert: true, new: true }
        );

        console.log('✅ Bulk send completed:', successCount, 'successful');

        res.json({
            success: true,
            results: results,
            sent: successCount,
            failed: contactList.length - successCount,
            message: 'Sent ' + successCount + '/' + contactList.length + ' messages successfully'
        });

    } catch (error) {
        console.error('❌ Bulk send error:', error);
        res.json({ 
            success: false, 
            error: 'Bulk send failed: ' + error.message 
        });
    }
});

// Test endpoint to check if route is working
router.get("/test", (req, res) => {
    res.json({ 
        success: true, 
        message: "Message route is working",
        timestamp: new Date().toISOString()
    });
});

// Health check for message route
router.get("/health", (req, res) => {
    const client = getWhatsAppClient();
    res.json({
        success: true,
        whatsappConnected: !!(client && client.user),
        route: "message",
        status: "active"
    });
});

module.exports = router;
