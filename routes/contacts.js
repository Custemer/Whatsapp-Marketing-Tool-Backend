const express = require("express");
const Contact = require("../models/Contact");

const router = express.Router();

// Get all contacts
router.get("/", async (req, res) => {
    try {
        const contacts = await Contact.find().sort({ lastContacted: -1 }).limit(100);
        res.json({ success: true, contacts });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add new contact
router.post("/", async (req, res) => {
    try {
        const { phoneNumber, name, businessType, location, tags, notes } = req.body;
        
        const contact = new Contact({
            phoneNumber,
            name,
            businessType,
            location,
            tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
            notes
        });

        await contact.save();
        res.json({ success: true, contact });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get contact statistics
router.get("/stats", async (req, res) => {
    try {
        const totalContacts = await Contact.countDocuments();
        const activeContacts = await Contact.countDocuments({ status: 'active' });
        const contactsByLocation = await Contact.aggregate([
            { $group: { _id: '$location', count: { $sum: 1 } } }
        ]);

        res.json({
            totalContacts,
            activeContacts,
            inactiveContacts: totalContacts - activeContacts,
            contactsByLocation
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
